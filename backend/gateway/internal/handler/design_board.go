package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	jwtv5 "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/internal/service"
)

const (
	defaultDesignBoardEditorPath = "/openpencil/editor"
	designBoardSessionTTL        = 30 * time.Minute
)

type designBoardRepository interface {
	GetRuntimeByUser(
		ctx context.Context,
		userID uuid.UUID,
		threadID string,
	) (*repository.ThreadRuntimeRecord, error)
	GetOwnerByThreadID(
		ctx context.Context,
		threadID string,
	) (uuid.UUID, error)
}

type DesignBoardHandler struct {
	repo           designBoardRepository
	service        *service.DesignBoardService
	sessionSecret  []byte
	editorBasePath string
}

type designBoardSessionClaims struct {
	UserID            string `json:"user_id"`
	ThreadID          string `json:"thread_id"`
	SessionID         string `json:"session_id"`
	SessionGeneration int64  `json:"session_generation"`
	TargetPath        string `json:"target_path"`
	jwtv5.RegisteredClaims
}

type openDesignBoardResponse struct {
	AccessToken       string `json:"access_token"`
	ThreadID          string `json:"thread_id"`
	SessionID         string `json:"session_id"`
	SessionGeneration int64  `json:"session_generation"`
	TargetPath        string `json:"target_path"`
	Revision          string `json:"revision"`
	RelativeURL       string `json:"relative_url"`
	ExpiresAt         string `json:"expires_at"`
}

type writeDesignDocumentRequest struct {
	Document json.RawMessage `json:"document" binding:"required"`
	Revision string          `json:"revision"`
}

func NewDesignBoardHandler(
	repo designBoardRepository,
	service *service.DesignBoardService,
	sessionSecret string,
	editorBasePath string,
) *DesignBoardHandler {
	normalizedEditorBasePath := strings.TrimSpace(editorBasePath)
	if normalizedEditorBasePath == "" {
		normalizedEditorBasePath = defaultDesignBoardEditorPath
	}
	return &DesignBoardHandler{
		repo:           repo,
		service:        service,
		sessionSecret:  []byte(sessionSecret),
		editorBasePath: normalizedEditorBasePath,
	}
}

func (h *DesignBoardHandler) Open(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Param("id"))
	if threadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id is required"})
		return
	}

	effectiveUserID, err := resolveEffectiveThreadUserID(c.Request.Context(), c, h.repo, threadID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "thread not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to resolve thread owner"})
		return
	}

	if _, err := h.repo.GetRuntimeByUser(c.Request.Context(), effectiveUserID, threadID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "thread not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load thread runtime"})
		return
	}

	targetPath := strings.TrimSpace(c.Query("target_path"))
	_, revision, normalizedTargetPath, err := h.service.ReadDocument(effectiveUserID.String(), threadID, targetPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	now := time.Now().UTC()
	expiresAt := now.Add(designBoardSessionTTL)
	sessionID := uuid.NewString()
	// Session generation uses gateway issue order so OpenPencil can reject stale
	// broadcast tuples without needing a separate persisted counter in v1.
	sessionGeneration := now.UnixNano()
	token, err := h.issueSessionToken(
		effectiveUserID,
		threadID,
		sessionID,
		sessionGeneration,
		normalizedTargetPath,
		now,
		expiresAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to issue design board token"})
		return
	}

	values := url.Values{}
	// Mirror the authoritative identity tuple into the launch URL because the
	// editor bootstraps bridge mode from query params before its first API fetch.
	values.Set("design_token", token)
	values.Set("design_thread_id", threadID)
	values.Set("design_session_id", sessionID)
	values.Set("design_session_generation", fmt.Sprintf("%d", sessionGeneration))
	values.Set("design_target_path", normalizedTargetPath)
	values.Set("design_revision", revision)
	relativeURL := h.editorBasePath + "?" + values.Encode()

	c.JSON(http.StatusOK, openDesignBoardResponse{
		AccessToken:       token,
		ThreadID:          threadID,
		SessionID:         sessionID,
		SessionGeneration: sessionGeneration,
		TargetPath:        normalizedTargetPath,
		Revision:          revision,
		RelativeURL:       relativeURL,
		ExpiresAt:         expiresAt.Format(time.RFC3339),
	})
}

func (h *DesignBoardHandler) ReadDocument(c *gin.Context) {
	claims, ok := h.requireSessionClaims(c)
	if !ok {
		return
	}

	document, revision, targetPath, err := h.service.ReadDocument(claims.UserID, claims.ThreadID, claims.TargetPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"target_path": targetPath,
		"revision":    revision,
		"document":    document,
	})
}

func (h *DesignBoardHandler) WriteDocument(c *gin.Context) {
	claims, ok := h.requireSessionClaims(c)
	if !ok {
		return
	}

	var request writeDesignDocumentRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	targetPath, revision, err := h.service.WriteDocument(
		claims.UserID,
		claims.ThreadID,
		claims.TargetPath,
		request.Document,
		request.Revision,
	)
	if err != nil {
		statusCode := http.StatusBadRequest
		if strings.Contains(err.Error(), "revision conflict") {
			statusCode = http.StatusConflict
		}
		c.JSON(statusCode, model.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"target_path": targetPath,
		"revision":    revision,
		"saved":       true,
	})
}

func (h *DesignBoardHandler) requireSessionClaims(c *gin.Context) (*designBoardSessionClaims, bool) {
	token := strings.TrimSpace(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer"))
	if token == "" {
		token = strings.TrimSpace(c.Query("design_token"))
	}
	if token == "" {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "missing design board authorization token"})
		return nil, false
	}

	claims, err := h.parseSessionToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "invalid design board authorization token"})
		return nil, false
	}
	return claims, true
}

func (h *DesignBoardHandler) issueSessionToken(
	userID uuid.UUID,
	threadID string,
	sessionID string,
	sessionGeneration int64,
	targetPath string,
	issuedAt time.Time,
	expiresAt time.Time,
) (string, error) {
	token := jwtv5.NewWithClaims(jwtv5.SigningMethodHS256, designBoardSessionClaims{
		UserID:            userID.String(),
		ThreadID:          threadID,
		SessionID:         sessionID,
		SessionGeneration: sessionGeneration,
		TargetPath:        targetPath,
		RegisteredClaims: jwtv5.RegisteredClaims{
			Issuer:    "openagents-design-board",
			IssuedAt:  jwtv5.NewNumericDate(issuedAt),
			ExpiresAt: jwtv5.NewNumericDate(expiresAt),
		},
	})
	return token.SignedString(h.sessionSecret)
}

func (h *DesignBoardHandler) parseSessionToken(token string) (*designBoardSessionClaims, error) {
	parsed, err := jwtv5.ParseWithClaims(token, &designBoardSessionClaims{}, func(t *jwtv5.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwtv5.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return h.sessionSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*designBoardSessionClaims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	if strings.TrimSpace(claims.ThreadID) == "" ||
		strings.TrimSpace(claims.TargetPath) == "" ||
		strings.TrimSpace(claims.UserID) == "" ||
		strings.TrimSpace(claims.SessionID) == "" ||
		claims.SessionGeneration <= 0 {
		return nil, errors.New("incomplete token claims")
	}
	return claims, nil
}
