package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/jwt"
)

type stubJWTUserRepo struct {
	users map[uuid.UUID]*model.User
}

func (s stubJWTUserRepo) FindByID(_ context.Context, userID uuid.UUID) (*model.User, error) {
	return s.users[userID], nil
}

func TestExtractBearerTokenPrefersAuthorizationHeader(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("Authorization", "Bearer header-token")
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got := ExtractBearerToken(req)
	if got != "header-token" {
		t.Fatalf("expected header token, got %q", got)
	}
}

func TestExtractBearerTokenFallsBackToCookie(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got := ExtractBearerToken(req)
	if got != "cookie-token" {
		t.Fatalf("expected cookie token, got %q", got)
	}
}

func TestExtractBearerTokenHandlesMissingCredentials(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	got := ExtractBearerToken(req)
	if got != "" {
		t.Fatalf("expected empty token, got %q", got)
	}
}

func TestJWTAuthRejectsTokenForMissingUser(t *testing.T) {
	gin.SetMode(gin.TestMode)

	userID := uuid.New()
	jwtMgr := jwt.NewManager("test-secret", 1)
	token, err := jwtMgr.Generate(userID, "admin")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	router := gin.New()
	router.GET("/protected", JWTAuth(jwtMgr, stubJWTUserRepo{users: map[uuid.UUID]*model.User{}}), func(c *gin.Context) {
		t.Fatal("handler should not run for a stale user token")
	})

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing token user, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestJWTAuthUsesCurrentUserRoleFromDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)

	userID := uuid.New()
	jwtMgr := jwt.NewManager("test-secret", 1)
	token, err := jwtMgr.Generate(userID, "user")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	router := gin.New()
	router.GET(
		"/protected",
		JWTAuth(jwtMgr, stubJWTUserRepo{users: map[uuid.UUID]*model.User{
			userID: {ID: userID, Role: "admin"},
		}}),
		func(c *gin.Context) {
			if got := GetRole(c); got != "admin" {
				t.Fatalf("expected current database role, got %q", got)
			}
			c.Status(http.StatusNoContent)
		},
	)

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rec.Code, rec.Body.String())
	}
}
