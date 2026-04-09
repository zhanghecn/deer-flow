package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/jwt"
)

type contextKey string

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
func JWTAuth(jwtMgr *jwt.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearerToken(c.Request)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization token"})
			return
		}

		claims, err := jwtMgr.Validate(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		c.Set(string(UserIDKey), claims.UserID)
		c.Set(string(RoleKey), claims.Role)
		c.Next()
	}
}

// APITokenAuth middleware validates API tokens (for open API endpoints).
func APITokenAuth(tokenRepo *repository.APITokenRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearerToken(c.Request)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing api token"})
			return
		}

		hash := hashToken(token)
		apiToken, err := tokenRepo.FindByHash(c.Request.Context(), hash)
		if err != nil || apiToken == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid api token"})
			return
		}

		if !strings.EqualFold(strings.TrimSpace(apiToken.Status), model.APITokenStatusActive) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "api token is disabled"})
			return
		}
		if apiToken.RevokedAt != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "api token is revoked"})
			return
		}
		if apiToken.ExpiresAt != nil && apiToken.ExpiresAt.Before(time.Now().UTC()) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "api token is expired"})
			return
		}

		// `last_used` is an audit hint, not part of the auth decision, so request
		// handling should continue even if the best-effort update fails.
		_ = tokenRepo.UpdateLastUsed(c.Request.Context(), apiToken.ID)

		c.Set(string(UserIDKey), apiToken.UserID)
		c.Set(string(RoleKey), "api")
		c.Set(string(APITokenIDKey), apiToken.ID)
		c.Set(string(APITokenScopesKey), slices.Clone(apiToken.Scopes))
		c.Set(string(APITokenAgentsKey), slices.Clone(apiToken.AllowedAgents))
		c.Next()
	}
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

func extractBearerToken(r *http.Request) string {
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
