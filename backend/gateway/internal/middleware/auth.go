package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/jwt"
)

type contextKey string

const (
	UserIDKey contextKey = "user_id"
	RoleKey   contextKey = "role"
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
		apiToken, err := tokenRepo.FindByHash(context.Background(), hash)
		if err != nil || apiToken == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid api token"})
			return
		}

		// Update last_used
		_ = tokenRepo.UpdateLastUsed(context.Background(), apiToken.ID)

		c.Set(string(UserIDKey), apiToken.UserID)
		c.Set(string(RoleKey), "api")
		c.Next()
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
