package middleware

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/jwt"
	"github.com/openagents/gateway/pkg/storage"
)

type contextKey string

type jwtUserRepository interface {
	FindByID(ctx context.Context, userID uuid.UUID) (*model.User, error)
}

type apiTokenVerifier interface {
	FindByHash(ctx context.Context, hash string) (*model.APIToken, error)
	UpdateLastUsed(ctx context.Context, id uuid.UUID) error
}

type trustedExternalTokenRepository interface {
	apiTokenVerifier
	Create(ctx context.Context, token *model.APIToken) error
	FindTrustedExternalManaged(ctx context.Context, userID uuid.UUID, agentName string) (*model.APIToken, error)
}

type publicAPIResponseAgentRepository interface {
	FindAgentNameByResponseID(ctx context.Context, responseID string) (string, error)
}

type publicAPIArtifactAgentRepository interface {
	FindAgentNameByArtifactFileID(ctx context.Context, fileID string) (string, error)
}

const (
	UserIDKey         contextKey = "user_id"
	RoleKey           contextKey = "role"
	APITokenIDKey     contextKey = "api_token_id"
	APITokenScopesKey contextKey = "api_token_scopes"
	APITokenAgentsKey contextKey = "api_token_allowed_agents"
	// AuthCookieName stores JWT for browser-initiated requests (iframe/download).
	AuthCookieName = "openagents_token"
)

func GetUserID(c *gin.Context) uuid.UUID {
	if v, ok := c.Get(string(UserIDKey)); ok {
		return v.(uuid.UUID)
	}
	return uuid.Nil
}

func GetRole(c *gin.Context) string {
	if v, ok := c.Get(string(RoleKey)); ok {
		return v.(string)
	}
	return ""
}

func GetAPITokenID(c *gin.Context) uuid.UUID {
	if v, ok := c.Get(string(APITokenIDKey)); ok {
		return v.(uuid.UUID)
	}
	return uuid.Nil
}

func GetAPITokenScopes(c *gin.Context) []string {
	if v, ok := c.Get(string(APITokenScopesKey)); ok {
		return slices.Clone(v.([]string))
	}
	return []string{}
}

func GetAPITokenAllowedAgents(c *gin.Context) []string {
	if v, ok := c.Get(string(APITokenAgentsKey)); ok {
		return slices.Clone(v.([]string))
	}
	return []string{}
}

func HasAPITokenScopes(c *gin.Context, required ...string) bool {
	if len(required) == 0 {
		return true
	}

	granted := make(map[string]struct{}, len(GetAPITokenScopes(c)))
	for _, scope := range GetAPITokenScopes(c) {
		granted[strings.ToLower(strings.TrimSpace(scope))] = struct{}{}
	}

	for _, scope := range required {
		if _, ok := granted[strings.ToLower(strings.TrimSpace(scope))]; !ok {
			return false
		}
	}
	return true
}

// APITokenAllowsAgent enforces the per-key allowlist on the explicit public
// `model` field. An empty allowlist means the key can invoke any published
// agent owned by the same user.
func APITokenAllowsAgent(c *gin.Context, agentName string) bool {
	allowedAgents := GetAPITokenAllowedAgents(c)
	if len(allowedAgents) == 0 {
		return true
	}

	normalizedAgentName := strings.ToLower(strings.TrimSpace(agentName))
	for _, allowed := range allowedAgents {
		if normalizedAgentName == strings.ToLower(strings.TrimSpace(allowed)) {
			return true
		}
	}
	return false
}

// JWTAuth middleware validates JWT tokens from Authorization header.
func JWTAuth(jwtMgr *jwt.Manager, userRepo jwtUserRepository) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := ExtractBearerToken(c.Request)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization token"})
			return
		}

		claims, err := jwtMgr.Validate(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		// A valid signature is not enough after a database reset or user delete:
		// the runtime persists foreign-keyed rows with this user id, so reject
		// stale sessions at the gateway before they can reach LangGraph.
		user, err := userRepo.FindByID(c.Request.Context(), claims.UserID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "failed to validate session"})
			return
		}
		if user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session user no longer exists"})
			return
		}

		c.Set(string(UserIDKey), claims.UserID)
		c.Set(string(RoleKey), user.Role)
		c.Next()
	}
}

// APITokenAuth middleware validates API tokens (for open API endpoints).
func APITokenAuth(tokenRepo apiTokenVerifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, credential := extractAPIBearerToken(c.Request)
		if token == "" {
			logAPITokenAuthFailure(c, http.StatusUnauthorized, "missing", credential, "")
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing api token"})
			return
		}

		if !authenticateAPIToken(c, tokenRepo, token, credential) {
			return
		}
		c.Next()
	}
}

type PublicAPIAgentResolver func(c *gin.Context) (string, error)

func PublicAPIAgentAuth(
	tokenRepo trustedExternalTokenRepository,
	fsStore *storage.FS,
	resolveAgent PublicAPIAgentResolver,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, credential := extractAPIBearerToken(c.Request)
		agentName, err := resolveAgent(c)
		if err != nil {
			statusCode := http.StatusBadRequest
			message := err.Error()
			var resolveErr *publicAPIAgentResolveError
			if errors.As(err, &resolveErr) {
				statusCode = resolveErr.statusCode
				message = resolveErr.message
			}
			c.AbortWithStatusJSON(statusCode, gin.H{"error": message})
			return
		}

		apiToken, trustedExternal, ok := resolveTrustedExternalManagedTokenIfEnabled(c, tokenRepo, fsStore, agentName)
		if !ok {
			return
		}
		if trustedExternal {
			// Trusted-external means the deployer trusts an upstream boundary, so
			// request-supplied API keys are ignored to keep history under the
			// agent-owned managed key even when SDK samples still send a key.
			setAPITokenContext(c, apiToken)
			_ = tokenRepo.UpdateLastUsed(c.Request.Context(), apiToken.ID)
			c.Next()
			return
		}

		if token != "" {
			if !authenticateAPIToken(c, tokenRepo, token, credential) {
				return
			}
			c.Next()
			return
		}

		logAPITokenAuthFailure(c, http.StatusUnauthorized, "missing", credential, "")
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing api token"})
	}
}

func PublicAPIBodyAgentField(field string) PublicAPIAgentResolver {
	return func(c *gin.Context) (string, error) {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			return "", fmt.Errorf("failed to read request body")
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		if len(bytes.TrimSpace(body)) == 0 {
			return "", nil
		}

		var payload map[string]json.RawMessage
		if err := json.Unmarshal(body, &payload); err != nil {
			return "", nil
		}
		var agentName string
		if err := json.Unmarshal(payload[field], &agentName); err != nil {
			return "", nil
		}
		return strings.TrimSpace(agentName), nil
	}
}

func PublicAPIQueryAgent(param string) PublicAPIAgentResolver {
	return func(c *gin.Context) (string, error) {
		return strings.TrimSpace(c.Query(param)), nil
	}
}

// PublicAPIFormAgentField resolves the target agent from an explicit form field
// without buffering the upload body. Multipart parsing stores file handles on
// the request so the downstream CreateFile handler can still call FormFile.
func PublicAPIFormAgentField(field string) PublicAPIAgentResolver {
	fieldName := strings.TrimSpace(field)
	return func(c *gin.Context) (string, error) {
		if fieldName == "" {
			return "", nil
		}

		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil {
			return "", nil
		}

		switch strings.ToLower(mediaType) {
		case "multipart/form-data":
			if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
				return "", newPublicAPIAgentResolveError(http.StatusBadRequest, "failed to parse multipart form")
			}
		case "application/x-www-form-urlencoded":
			if err := c.Request.ParseForm(); err != nil {
				return "", newPublicAPIAgentResolveError(http.StatusBadRequest, "failed to parse form")
			}
		default:
			return "", nil
		}

		return strings.TrimSpace(c.Request.FormValue(fieldName)), nil
	}
}

// PublicAPIResponseIDAgent lets trusted-external follow-up requests authorize
// against the original invocation's agent without exposing a public API key.
func PublicAPIResponseIDAgent(repo publicAPIResponseAgentRepository, param string) PublicAPIAgentResolver {
	return func(c *gin.Context) (string, error) {
		responseID := strings.TrimSpace(c.Param(param))
		if responseID == "" || repo == nil {
			return "", nil
		}
		agentName, err := repo.FindAgentNameByResponseID(c.Request.Context(), responseID)
		if err != nil {
			return "", newPublicAPIAgentResolveError(http.StatusInternalServerError, "failed to resolve response agent")
		}
		return strings.TrimSpace(agentName), nil
	}
}

// PublicAPIArtifactFileAgent keeps generated artifact downloads in the same
// agent-owned auth boundary as the response that produced the artifact.
func PublicAPIArtifactFileAgent(repo publicAPIArtifactAgentRepository, param string) PublicAPIAgentResolver {
	return func(c *gin.Context) (string, error) {
		fileID := strings.TrimSpace(c.Param(param))
		if fileID == "" || repo == nil {
			return "", nil
		}
		agentName, err := repo.FindAgentNameByArtifactFileID(c.Request.Context(), fileID)
		if err != nil {
			return "", newPublicAPIAgentResolveError(http.StatusInternalServerError, "failed to resolve artifact agent")
		}
		return strings.TrimSpace(agentName), nil
	}
}

type publicAPIAgentResolveError struct {
	statusCode int
	message    string
}

func newPublicAPIAgentResolveError(statusCode int, message string) *publicAPIAgentResolveError {
	return &publicAPIAgentResolveError{statusCode: statusCode, message: message}
}

func (e *publicAPIAgentResolveError) Error() string {
	return e.message
}

func authenticateAPIToken(
	c *gin.Context,
	tokenRepo apiTokenVerifier,
	token string,
	credential apiBearerCredential,
) bool {
	hash := hashToken(token)
	apiToken, err := tokenRepo.FindByHash(c.Request.Context(), hash)
	if err != nil || apiToken == nil {
		logAPITokenAuthFailure(c, http.StatusUnauthorized, "invalid", credential, token)
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid api token"})
		return false
	}

	if !strings.EqualFold(strings.TrimSpace(apiToken.Status), model.APITokenStatusActive) {
		logAPITokenAuthFailure(c, http.StatusUnauthorized, "disabled", credential, token)
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "api token is disabled"})
		return false
	}
	if apiToken.RevokedAt != nil {
		logAPITokenAuthFailure(c, http.StatusUnauthorized, "revoked", credential, token)
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "api token is revoked"})
		return false
	}
	if apiToken.ExpiresAt != nil && apiToken.ExpiresAt.Before(time.Now().UTC()) {
		logAPITokenAuthFailure(c, http.StatusUnauthorized, "expired", credential, token)
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "api token is expired"})
		return false
	}

	setAPITokenContext(c, apiToken)
	// `last_used` is an audit hint, not part of the auth decision, so request
	// handling should continue even if the best-effort update fails.
	_ = tokenRepo.UpdateLastUsed(c.Request.Context(), apiToken.ID)
	return true
}

func setAPITokenContext(c *gin.Context, apiToken *model.APIToken) {
	c.Set(string(UserIDKey), apiToken.UserID)
	c.Set(string(RoleKey), "api")
	c.Set(string(APITokenIDKey), apiToken.ID)
	c.Set(string(APITokenScopesKey), slices.Clone(apiToken.Scopes))
	c.Set(string(APITokenAgentsKey), slices.Clone(apiToken.AllowedAgents))
}

func resolveTrustedExternalManagedTokenIfEnabled(
	c *gin.Context,
	tokenRepo trustedExternalTokenRepository,
	fsStore *storage.FS,
	agentName string,
) (*model.APIToken, bool, bool) {
	normalizedAgentName := strings.ToLower(strings.TrimSpace(agentName))
	if normalizedAgentName == "" {
		return nil, false, true
	}

	agent, err := agentfs.LoadAgent(fsStore, normalizedAgentName, "prod", false)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "failed to load agent auth mode"})
		return nil, false, false
	}
	if agent == nil || agent.PublicAPIAuthMode != model.PublicAPIAuthModeTrustedExternal {
		return nil, false, true
	}

	ownerUserID, err := uuid.Parse(strings.TrimSpace(agent.OwnerUserID))
	if err != nil || ownerUserID == uuid.Nil {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "trusted external auth requires an agent owner"})
		return nil, false, false
	}

	// Trusted-external mode still materializes a real API token row so existing
	// invocation history, file ownership, and audit joins keep their API-token
	// isolation contract without exposing a reusable key to the caller.
	apiToken, err := tokenRepo.FindTrustedExternalManaged(c.Request.Context(), ownerUserID, normalizedAgentName)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "failed to load trusted external key"})
		return nil, false, false
	}
	if apiToken != nil {
		return apiToken, true, true
	}

	apiToken, err = newTrustedExternalManagedToken(ownerUserID, normalizedAgentName)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "failed to create trusted external key"})
		return nil, false, false
	}
	if err := tokenRepo.Create(c.Request.Context(), apiToken); err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "failed to create trusted external key"})
		return nil, false, false
	}
	log.Printf(
		"trusted_external_managed_key_created agent=%s user_id=%s token_id=%s",
		normalizedAgentName,
		ownerUserID,
		apiToken.ID,
	)
	return apiToken, true, true
}

func newTrustedExternalManagedToken(userID uuid.UUID, agentName string) (*model.APIToken, error) {
	plainToken, err := generateManagedAPIToken()
	if err != nil {
		return nil, err
	}
	metadata, err := json.Marshal(map[string]any{
		"source":     "trusted_external_managed_key",
		"agent_name": agentName,
		"managed":    true,
		"auth_mode":  model.PublicAPIAuthModeTrustedExternal,
	})
	if err != nil {
		return nil, err
	}

	return &model.APIToken{
		ID:            uuid.New(),
		UserID:        userID,
		TokenHash:     hashToken(plainToken),
		TokenPrefix:   tokenPrefixFromToken(plainToken),
		Name:          fmt.Sprintf("Managed trusted external key for %s", agentName),
		Scopes:        model.DefaultPublicAPIScopes(),
		Status:        model.APITokenStatusActive,
		AllowedAgents: []string{agentName},
		Metadata:      metadata,
		CreatedAt:     time.Now().UTC(),
	}, nil
}

func generateManagedAPIToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "df_" + hex.EncodeToString(b), nil
}

func tokenPrefixFromToken(token string) string {
	trimmed := strings.TrimSpace(token)
	if len(trimmed) <= 15 {
		return trimmed
	}
	// The prefix is safe to store because it gives operators a non-secret handle
	// while the gateway never exposes the managed key plaintext.
	return fmt.Sprintf("%s...", trimmed[:15])
}

func RequireAPITokenScopes(required ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if HasAPITokenScopes(c, required...) {
			c.Next()
			return
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error":   "insufficient_scope",
			"details": "api token is missing one or more required scopes",
		})
	}
}

type apiBearerCredential struct {
	AuthorizationHeader bool
	BearerScheme        bool
	CookiePresent       bool
}

// extractAPIBearerToken keeps the external `/v1` contract strict: SDK callers
// must send Authorization: Bearer <api-token>. Browser session cookies remain
// valid for JWT middleware only, so a missing SDK header is diagnosable as
// `missing api token` instead of being misread as an invalid API key.
func extractAPIBearerToken(r *http.Request) (string, apiBearerCredential) {
	credential := apiBearerCredential{}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth != "" {
		credential.AuthorizationHeader = true
		fields := strings.Fields(auth)
		if len(fields) >= 1 && strings.EqualFold(fields[0], "Bearer") {
			credential.BearerScheme = true
			if len(fields) == 2 {
				return strings.TrimSpace(fields[1]), credential
			}
		}
	}

	if cookie, err := r.Cookie(AuthCookieName); err == nil && strings.TrimSpace(cookie.Value) != "" {
		credential.CookiePresent = true
	}
	return "", credential
}

// ExtractBearerToken preserves one auth contract for both browser and API
// callers: prefer the explicit Authorization header, then fall back to the
// browser session cookie when the request is initiated by the UI.
func ExtractBearerToken(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if token != "" {
			return token
		}
	}

	if cookie, err := r.Cookie(AuthCookieName); err == nil {
		token := strings.TrimSpace(cookie.Value)
		if token != "" {
			return token
		}
	}
	return ""
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func logAPITokenAuthFailure(
	c *gin.Context,
	status int,
	reason string,
	credential apiBearerCredential,
	token string,
) {
	route := c.FullPath()
	if route == "" {
		// Preserve the path-only contract here; query strings often carry secrets
		// from broken client integrations and must not be persisted to logs.
		route = c.Request.URL.Path
	}

	if token != "" {
		tokenHashPrefix := hashToken(token)
		if len(tokenHashPrefix) > 12 {
			tokenHashPrefix = tokenHashPrefix[:12]
		}
		// The preview gives operators enough visual context for customer support
		// while keeping retained logs from becoming directly reusable credentials.
		tokenPreview := maskAPITokenForLog(token)
		log.Printf(
			"public_api_auth_failure reason=%s method=%s route=%s status=%d client_ip=%s auth_header=%v bearer=%v cookie_present=%v token_len=%d token_preview=%s token_hash_prefix=%s user_agent=%q",
			reason,
			c.Request.Method,
			route,
			status,
			c.ClientIP(),
			credential.AuthorizationHeader,
			credential.BearerScheme,
			credential.CookiePresent,
			len(token),
			tokenPreview,
			tokenHashPrefix,
			c.Request.UserAgent(),
		)
		return
	}

	log.Printf(
		"public_api_auth_failure reason=%s method=%s route=%s status=%d client_ip=%s auth_header=%v bearer=%v cookie_present=%v user_agent=%q",
		reason,
		c.Request.Method,
		route,
		status,
		c.ClientIP(),
		credential.AuthorizationHeader,
		credential.BearerScheme,
		credential.CookiePresent,
		c.Request.UserAgent(),
	)
}

func maskAPITokenForLog(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	if len(token) <= 8 {
		return strings.Repeat("*", len(token))
	}
	if len(token) <= 16 {
		return token[:3] + "..." + token[len(token)-3:]
	}
	return token[:6] + "..." + token[len(token)-4:]
}
