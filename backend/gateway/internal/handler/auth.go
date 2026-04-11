package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/jwt"
	"github.com/openagents/gateway/pkg/storage"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	userRepo  *repository.UserRepo
	tokenRepo *repository.APITokenRepo
	jwtMgr    *jwt.Manager
	// tokenCipher protects the owner-visible copy of API keys that powers the
	// management UI. Hashes remain the canonical auth check.
	tokenCipher *APITokenCipher
	fs          *storage.FS
}

const authCookieMaxAgeSeconds = 7 * 24 * 60 * 60

func NewAuthHandler(
	userRepo *repository.UserRepo,
	tokenRepo *repository.APITokenRepo,
	jwtMgr *jwt.Manager,
	tokenCipher *APITokenCipher,
	fs *storage.FS,
) *AuthHandler {
	return &AuthHandler{
		userRepo:    userRepo,
		tokenRepo:   tokenRepo,
		jwtMgr:      jwtMgr,
		tokenCipher: tokenCipher,
		fs:          fs,
	}
}

func setAuthCookie(c *gin.Context, token string) {
	secure := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(middleware.AuthCookieName, token, authCookieMaxAgeSeconds, "/", "", secure, true)
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req model.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	existing, _ := h.userRepo.FindByEmail(c.Request.Context(), req.Email)
	if existing != nil {
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: "email already registered"})
		return
	}
	existing, _ = h.userRepo.FindByName(c.Request.Context(), req.Name)
	if existing != nil {
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: "account already registered"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "internal error"})
		return
	}

	role := "user"
	userCount, err := h.userRepo.Count(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to initialize user role"})
		return
	}
	if userCount == 0 {
		role = "admin"
	}

	user := &model.User{
		ID:           uuid.New(),
		Email:        req.Email,
		Name:         req.Name,
		PasswordHash: string(hash),
		Role:         role,
	}

	if err := h.userRepo.Create(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to create user"})
		return
	}

	// Create user directory
	_ = h.fs.EnsureUserDir(user.ID.String())

	token, err := h.jwtMgr.Generate(user.ID, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to generate token"})
		return
	}

	setAuthCookie(c, token)
	c.JSON(http.StatusCreated, model.AuthResponse{Token: token, User: *user})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	user, err := h.userRepo.FindByName(c.Request.Context(), req.Account)
	if err != nil || user == nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "invalid credentials"})
		return
	}

	token, err := h.jwtMgr.Generate(user.ID, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to generate token"})
		return
	}

	setAuthCookie(c, token)
	c.JSON(http.StatusOK, model.AuthResponse{Token: token, User: *user})
}

func (h *AuthHandler) ListTokens(c *gin.Context) {
	if h.tokenCipher == nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "api token cipher is not configured"})
		return
	}

	userID := middleware.GetUserID(c)
	tokens, err := h.tokenRepo.ListByUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list tokens"})
		return
	}
	if tokens == nil {
		tokens = []model.APIToken{}
	}
	for index := range tokens {
		// Tokens created before the displayable-key contract only have hashes, so
		// they cannot be reconstructed here and must be rotated by the operator.
		if len(tokens[index].TokenCiphertext) == 0 {
			continue
		}

		plainToken, err := h.tokenCipher.DecryptToken(tokens[index].TokenCiphertext)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to decrypt token"})
			return
		}
		tokens[index].Token = plainToken
	}
	c.JSON(http.StatusOK, tokens)
}

func (h *AuthHandler) CreateToken(c *gin.Context) {
	if h.tokenCipher == nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "api token cipher is not configured"})
		return
	}

	var req model.CreateAPITokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	userID := middleware.GetUserID(c)
	metadata, err := model.ValidateAPITokenMetadata(req.Metadata)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	if req.ExpiresAt != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "expires_at is no longer supported"})
		return
	}

	allowedAgents, err := h.validateOwnedPublishedTokenAgents(userID, req.AllowedAgents)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	plainToken := generateRandomToken()
	tokenCiphertext, err := h.tokenCipher.EncryptToken(plainToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to encrypt token"})
		return
	}
	apiToken := &model.APIToken{
		ID:              uuid.New(),
		UserID:          userID,
		TokenHash:       hashTokenStr(plainToken),
		TokenCiphertext: tokenCiphertext,
		TokenPrefix:     tokenPrefixFromToken(plainToken),
		Token:           plainToken,
		Name:            strings.TrimSpace(req.Name),
		Scopes:          model.NormalizeAPITokenScopes(req.Scopes),
		Status:          model.APITokenStatusActive,
		AllowedAgents:   allowedAgents,
		Metadata:        metadata,
		// The create response reuses this in-memory row immediately, so stamp the
		// timestamp here instead of returning the zero time and forcing callers to
		// refetch before they can display creation metadata.
		CreatedAt: time.Now().UTC(),
	}

	if err := h.tokenRepo.Create(c.Request.Context(), apiToken); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to create token"})
		return
	}

	c.JSON(http.StatusCreated, apiToken)
}

func (h *AuthHandler) validateOwnedPublishedTokenAgents(
	userID uuid.UUID,
	requestedAgents []string,
) ([]string, error) {
	normalizedAgents := model.NormalizeAPITokenAllowedAgents(requestedAgents)
	if len(normalizedAgents) != 1 {
		return nil, fmt.Errorf("allowed_agents must contain exactly one published agent")
	}

	agentName := normalizedAgents[0]
	// Public API keys now bind to one creator-owned prod agent so inventory,
	// audit logs, and downstream support work can reason about one credential ->
	// one agent without legacy broad-access ambiguity.
	agent, err := agentfs.LoadAgent(h.fs, agentName, "prod", false)
	if err != nil {
		return nil, fmt.Errorf("failed to load agent %q: %w", agentName, err)
	}
	if agent == nil {
		return nil, fmt.Errorf("published agent %q not found", agentName)
	}

	if strings.TrimSpace(agent.OwnerUserID) != userID.String() {
		return nil, fmt.Errorf("you can only create keys for prod agents you own")
	}

	return normalizedAgents, nil
}

func (h *AuthHandler) DeleteToken(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid token id"})
		return
	}

	userID := middleware.GetUserID(c)
	// Keep token rows for audit and invocation joins even though the northbound
	// UI presents this action as deletion to the end user.
	if err := h.tokenRepo.Revoke(c.Request.Context(), id, userID); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "token not found"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "token revoked"})
}

func generateRandomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "df_" + hex.EncodeToString(b)
}

func tokenPrefixFromToken(token string) string {
	trimmed := strings.TrimSpace(token)
	if len(trimmed) <= 15 {
		return trimmed
	}
	// The prefix is a non-secret operator hint for logs and key rotation UX.
	return fmt.Sprintf("%s...", trimmed[:15])
}

func hashTokenStr(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
