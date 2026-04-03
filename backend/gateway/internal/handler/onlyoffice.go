package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	jwtv5 "github.com/golang-jwt/jwt/v5"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

type OnlyOfficeConfig struct {
	ServerURL    string
	PublicAppURL string
	JWTSecret    string
}

type OnlyOfficeHandler struct {
	fs     *storage.FS
	config OnlyOfficeConfig
	client *http.Client
	now    func() time.Time
}

type onlyOfficeCallbackRequest struct {
	Status int    `json:"status"`
	URL    string `json:"url"`
	Token  string `json:"token"`
}

func NewOnlyOfficeHandler(fs *storage.FS, cfg OnlyOfficeConfig) *OnlyOfficeHandler {
	return &OnlyOfficeHandler{
		fs: fs,
		config: OnlyOfficeConfig{
			ServerURL:    strings.TrimRight(strings.TrimSpace(cfg.ServerURL), "/"),
			PublicAppURL: strings.TrimRight(strings.TrimSpace(cfg.PublicAppURL), "/"),
			JWTSecret:    strings.TrimSpace(cfg.JWTSecret),
		},
		client: &http.Client{Timeout: 30 * time.Second},
		now:    time.Now,
	}
}

func (h *OnlyOfficeHandler) Config(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusServiceUnavailable, model.ErrorResponse{Error: "onlyoffice integration is not configured"})
		return
	}

	mode := strings.ToLower(strings.TrimSpace(c.DefaultQuery("mode", "view")))
	if mode != "view" && mode != "edit" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid onlyoffice mode"})
		return
	}

	threadID := c.Param("id")
	artifactPath := artifactPathFromContext(c)
	if artifactPath == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing artifact path"})
		return
	}

	relativePath, preferredScope, err := decodeArtifactRequestPath(artifactPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	resolvedPath, info, err := resolveArtifactFile(h.fs, threadID, relativePath, preferredScope)
	if err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "artifact not found"})
		return
	}
	descriptor, ok := officeDocumentDescriptorForPath(resolvedPath)
	if !ok {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "onlyoffice preview only supports office files"})
		return
	}
	if mode == "edit" && !descriptor.Editable {
		mode = "view"
	}

	userID := middleware.GetUserID(c)
	role := strings.TrimSpace(middleware.GetRole(c))
	userName := "OpenAgents User"
	if role != "" {
		userName = role
	}

	fileRoutePath := encodeArtifactPath(relativePathForUserData(h.fs, threadID, resolvedPath))
	baseURL := h.publicBaseURL(c)
	fileURL := fmt.Sprintf("%s/api/office/threads/%s/files/%s", baseURL, url.PathEscape(threadID), fileRoutePath)
	callbackURL := fmt.Sprintf("%s/api/office/threads/%s/callback/%s", baseURL, url.PathEscape(threadID), fileRoutePath)
	documentKey := buildOnlyOfficeDocumentKey(threadID, resolvedPath, info)

	payload := map[string]any{
		"documentType": descriptor.DocumentType,
		"type":         "desktop",
		"width":        "100%",
		"height":       "100%",
		"document": map[string]any{
			"title":    filepath.Base(resolvedPath),
			"url":      fileURL,
			"fileType": strings.TrimPrefix(strings.ToLower(filepath.Ext(resolvedPath)), "."),
			"key":      documentKey,
			"permissions": map[string]any{
				"edit":     mode == "edit",
				"download": true,
				"print":    true,
				"copy":     true,
			},
		},
		"editorConfig": map[string]any{
			"mode":        mode,
			"lang":        preferredOnlyOfficeLanguage(c.GetHeader("Accept-Language")),
			"callbackUrl": callbackURL,
			"user": map[string]any{
				"id":   userID.String(),
				"name": userName,
			},
			"customization": map[string]any{
				"forcesave":      mode == "edit",
				"autosave":       mode == "edit",
				"compactToolbar": false,
				"compactHeader":  false,
			},
		},
	}

	token, err := h.signPayload(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to sign onlyoffice config"})
		return
	}
	payload["token"] = token

	c.JSON(http.StatusOK, gin.H{
		// Browser-visible ONLYOFFICE assets may be served through a same-origin
		// reverse-proxy path such as `/onlyoffice`, so keep this value exactly as
		// configured instead of forcing an absolute URL shape in the gateway.
		"documentServerUrl": h.config.ServerURL,
		"config":            payload,
	})
}

func (h *OnlyOfficeHandler) File(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "onlyoffice integration is not configured"})
		return
	}

	if !h.authorizeOnlyOfficeRequest(c, "") {
		return
	}

	threadID := c.Param("id")
	artifactPath := artifactPathFromContext(c)
	if artifactPath == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing artifact path"})
		return
	}

	relativePath, preferredScope, err := decodeArtifactRequestPath(artifactPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	resolvedPath, info, err := resolveArtifactFile(h.fs, threadID, relativePath, preferredScope)
	if err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "artifact not found"})
		return
	}
	if !isOfficeDocumentFile(resolvedPath) {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "onlyoffice preview only supports office files"})
		return
	}

	serveArtifactFile(c, resolvedPath, info)
}

func (h *OnlyOfficeHandler) Callback(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusNotFound, gin.H{"error": 1})
		return
	}

	threadID := c.Param("id")
	artifactPath := artifactPathFromContext(c)
	if artifactPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": 1})
		return
	}

	relativePath, preferredScope, err := decodeArtifactRequestPath(artifactPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": 1})
		return
	}

	resolvedPath, info, err := resolveArtifactFile(h.fs, threadID, relativePath, preferredScope)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": 1})
		return
	}
	if !isOfficeDocumentFile(resolvedPath) {
		c.JSON(http.StatusBadRequest, gin.H{"error": 1})
		return
	}

	var request onlyOfficeCallbackRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": 1})
		return
	}

	if !h.authorizeOnlyOfficeRequest(c, request.Token) {
		return
	}

	switch request.Status {
	case 2, 6:
		if strings.TrimSpace(request.URL) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": 1})
			return
		}
		if err := h.downloadAndReplace(c.Request.Context(), request.URL, resolvedPath, info.Mode()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": 1})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"error": 0})
}

func (h *OnlyOfficeHandler) enabled() bool {
	return h.config.ServerURL != "" && h.config.JWTSecret != ""
}

func (h *OnlyOfficeHandler) authorizeOnlyOfficeRequest(c *gin.Context, bodyToken string) bool {
	token := strings.TrimSpace(bodyToken)
	if token == "" {
		token = strings.TrimSpace(c.GetHeader("Authorization"))
		token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer"))
	}
	if token == "" {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "missing onlyoffice authorization token"})
		return false
	}

	if _, err := jwtv5.Parse(token, func(t *jwtv5.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwtv5.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(h.config.JWTSecret), nil
	}); err != nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "invalid onlyoffice authorization token"})
		return false
	}

	return true
}

func (h *OnlyOfficeHandler) signPayload(payload map[string]any) (string, error) {
	token := jwtv5.NewWithClaims(jwtv5.SigningMethodHS256, jwtv5.MapClaims(payload))
	return token.SignedString([]byte(h.config.JWTSecret))
}

func (h *OnlyOfficeHandler) publicBaseURL(c *gin.Context) string {
	if h.config.PublicAppURL != "" {
		return h.config.PublicAppURL
	}

	scheme := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}

	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}

	return fmt.Sprintf("%s://%s", scheme, host)
}

func (h *OnlyOfficeHandler) downloadAndReplace(
	ctx context.Context,
	sourceURL string,
	targetPath string,
	mode os.FileMode,
) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected onlyoffice download status: %d", resp.StatusCode)
	}

	tmpFile, err := os.CreateTemp(filepath.Dir(targetPath), filepath.Base(targetPath)+".onlyoffice-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, mode); err != nil {
		return err
	}

	return os.Rename(tmpPath, targetPath)
}

func buildOnlyOfficeDocumentKey(threadID string, resolvedPath string, info os.FileInfo) string {
	fingerprint := fmt.Sprintf(
		"%s|%s|%d|%d",
		threadID,
		resolvedPath,
		info.Size(),
		info.ModTime().UTC().UnixNano(),
	)
	sum := sha256.Sum256([]byte(fingerprint))
	return hex.EncodeToString(sum[:16])
}

func relativePathForUserData(fs *storage.FS, threadID string, resolvedPath string) string {
	rel, err := filepath.Rel(fs.ThreadUserDataDir(threadID), resolvedPath)
	if err != nil {
		return filepath.Base(resolvedPath)
	}
	return filepath.ToSlash(rel)
}

func preferredOnlyOfficeLanguage(acceptLanguage string) string {
	lower := strings.ToLower(strings.TrimSpace(acceptLanguage))
	if strings.HasPrefix(lower, "zh") {
		return "zh-CN"
	}
	return "en-US"
}
