package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/httpx"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

type runtimeWorkspaceRepository interface {
	GetRuntimeByUser(
		ctx context.Context,
		userID uuid.UUID,
		threadID string,
	) (*repository.ThreadRuntimeRecord, error)
}

type RuntimeWorkspaceHandler struct {
	repo         runtimeWorkspaceRepository
	langGraphURL string
	httpClient   *http.Client
}

type runtimeWorkspaceOpenPayload struct {
	ThreadID   string  `json:"thread_id"`
	Mode       string  `json:"mode"`
	TargetPath *string `json:"target_path,omitempty"`
}

type runtimeWorkspaceOpenResponse struct {
	SessionID      string `json:"session_id"`
	AccessToken    string `json:"access_token"`
	Mode           string `json:"mode"`
	TargetPath     string `json:"target_path"`
	RelativeURL    string `json:"relative_url"`
	PublicBasePath string `json:"public_base_path"`
	ExpiresAt      string `json:"expires_at"`
}

type runtimeWorkspaceProxyTarget struct {
	SessionID          string `json:"session_id"`
	AccessToken        string `json:"access_token"`
	UpstreamBaseURL    string `json:"upstream_base_url"`
	UpstreamPathPrefix string `json:"upstream_path_prefix"`
	ExpiresAt          string `json:"expires_at"`
}

func NewRuntimeWorkspaceHandler(
	repo runtimeWorkspaceRepository,
	langGraphURL string,
) *RuntimeWorkspaceHandler {
	return &RuntimeWorkspaceHandler{
		repo:         repo,
		langGraphURL: strings.TrimRight(langGraphURL, "/"),
		httpClient:   httpx.NewInternalHTTPClient(30 * time.Second),
	}
}

func (h *RuntimeWorkspaceHandler) Open(c *gin.Context) {
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

	runtimeRecord, err := h.repo.GetRuntimeByUser(c.Request.Context(), userID, threadID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "thread not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load thread runtime"})
		return
	}
	if runtimeRecord.ExecutionBackend != nil && strings.EqualFold(strings.TrimSpace(*runtimeRecord.ExecutionBackend), "remote") {
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: "remote execution threads do not support runtime workspace inspection"})
		return
	}

	payload := runtimeWorkspaceOpenPayload{
		ThreadID: threadID,
		Mode:     "runtime",
	}
	if targetPath := strings.TrimSpace(c.Query("target_path")); targetPath != "" {
		payload.TargetPath = &targetPath
	}

	response, statusCode, err := h.openRuntimeWorkspace(c.Request.Context(), userID, payload)
	if err != nil {
		c.JSON(statusCode, model.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

func (h *RuntimeWorkspaceHandler) Proxy() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		if userID == uuid.Nil {
			c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
			return
		}

		sessionID := strings.TrimSpace(c.Param("session_id"))
		accessToken := strings.TrimSpace(c.Param("access_token"))
		if sessionID == "" || accessToken == "" {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "sandbox ide session and token are required"})
			return
		}

		target, statusCode, err := h.resolveRuntimeWorkspaceProxy(c.Request.Context(), userID, sessionID, accessToken)
		if err != nil {
			c.JSON(statusCode, model.ErrorResponse{Error: err.Error()})
			return
		}

		upstreamURL, err := url.Parse(target.UpstreamBaseURL)
		if err != nil {
			c.JSON(http.StatusBadGateway, model.ErrorResponse{Error: "invalid sandbox ide upstream url"})
			return
		}

		proxy := httputil.NewSingleHostReverseProxy(upstreamURL)
		// Sandbox IDE upstreams are runtime-internal capability URLs returned by
		// LangGraph, so they must bypass host proxy settings for the same reason
		// as direct LangGraph calls.
		proxy.Transport = httpx.NewInternalTransport()
		proxy.FlushInterval = -1
		originalDirector := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalDirector(req)
			req.URL.Path = joinProxyPath(target.UpstreamPathPrefix, runtimeWorkspaceProxyPath(c))
			req.URL.RawPath = req.URL.Path
			req.Host = upstreamURL.Host
			if internalAuthority := sandboxProxyAuthority(target.UpstreamPathPrefix); internalAuthority != "" && req.Header.Get("Origin") != "" {
				req.Host = internalAuthority
			}
			if internalOrigin := sandboxProxyOrigin(target.UpstreamPathPrefix); internalOrigin != "" && req.Header.Get("Origin") != "" {
				// code-server validates WebSocket origins against its own bind
				// address. The gateway capability path stays same-origin for the
				// browser, then we rewrite Origin only on the trusted hop into the
				// sandbox so the upstream IDE accepts the proxied socket upgrade.
				req.Header.Set("Origin", internalOrigin)
			}
		}
		proxy.ErrorHandler = func(w http.ResponseWriter, req *http.Request, proxyErr error) {
			http.Error(w, fmt.Sprintf("{\"error\":%q}", proxyErr.Error()), http.StatusBadGateway)
		}

		proxy.ServeHTTP(c.Writer, c.Request)
	}
}

func (h *RuntimeWorkspaceHandler) openRuntimeWorkspace(
	ctx context.Context,
	userID uuid.UUID,
	payload runtimeWorkspaceOpenPayload,
) (*runtimeWorkspaceOpenResponse, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("failed to encode runtime workspace request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		h.langGraphURL+"/api/sandbox-ide/sessions",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to build runtime workspace request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(headerUserID, userID.String())

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to open runtime workspace: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, mapProxyStatus(resp.StatusCode), readUpstreamError(resp.Body, "failed to open runtime workspace")
	}

	var payloadResponse runtimeWorkspaceOpenResponse
	if err := json.NewDecoder(resp.Body).Decode(&payloadResponse); err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to decode runtime workspace response: %w", err)
	}
	return &payloadResponse, http.StatusOK, nil
}

func (h *RuntimeWorkspaceHandler) resolveRuntimeWorkspaceProxy(
	ctx context.Context,
	userID uuid.UUID,
	sessionID string,
	accessToken string,
) (*runtimeWorkspaceProxyTarget, int, error) {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		fmt.Sprintf("%s/api/sandbox-ide/sessions/%s/%s", h.langGraphURL, url.PathEscape(sessionID), url.PathEscape(accessToken)),
		nil,
	)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to build sandbox ide proxy request: %w", err)
	}
	req.Header.Set(headerUserID, userID.String())

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to resolve sandbox ide proxy target: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, mapProxyStatus(resp.StatusCode), readUpstreamError(resp.Body, "failed to resolve sandbox ide proxy target")
	}

	var target runtimeWorkspaceProxyTarget
	if err := json.NewDecoder(resp.Body).Decode(&target); err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to decode sandbox ide proxy target: %w", err)
	}
	return &target, http.StatusOK, nil
}

func readUpstreamError(body io.Reader, fallback string) error {
	payload, err := io.ReadAll(body)
	if err != nil || len(payload) == 0 {
		return errors.New(fallback)
	}

	var detail struct {
		Detail string `json:"detail"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(payload, &detail); err == nil {
		if strings.TrimSpace(detail.Detail) != "" {
			return errors.New(strings.TrimSpace(detail.Detail))
		}
		if strings.TrimSpace(detail.Error) != "" {
			return errors.New(strings.TrimSpace(detail.Error))
		}
	}

	return errors.New(fallback)
}

func mapProxyStatus(statusCode int) int {
	switch statusCode {
	case http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusGone:
		return statusCode
	default:
		return http.StatusBadGateway
	}
}

func joinProxyPath(prefix string, requestPath string) string {
	left := "/" + strings.TrimLeft(strings.TrimRight(prefix, "/"), "/")
	right := "/" + strings.TrimLeft(requestPath, "/")
	if left == "/" {
		return right
	}
	return left + right
}

func runtimeWorkspaceProxyPath(c *gin.Context) string {
	// The browser-visible `/sandbox-ide/{session}/{token}` prefix is only a
	// gateway capability path. Strip it before proxying so code-server still
	// sees its normal root-relative routes (`/`, `/healthz`, `/proxy/{port}`, ...).
	path := c.Param("path")
	if strings.TrimSpace(path) == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		return "/" + path
	}
	return path
}

func sandboxProxyOrigin(prefix string) string {
	if authority := sandboxProxyAuthority(prefix); authority != "" {
		return "http://" + authority
	}
	return ""
}

func sandboxProxyAuthority(prefix string) string {
	trimmed := strings.Trim(strings.TrimSpace(prefix), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || parts[0] != "proxy" || strings.TrimSpace(parts[1]) == "" {
		return ""
	}
	return "127.0.0.1:" + parts[1]
}
