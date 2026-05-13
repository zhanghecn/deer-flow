package middleware

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestExtractAPIBearerTokenIgnoresBrowserCookie(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got, credential := extractAPIBearerToken(req)
	if got != "" {
		t.Fatalf("expected API token parser to ignore cookie token, got %q", got)
	}
	if !credential.CookiePresent || credential.AuthorizationHeader || credential.BearerScheme {
		t.Fatalf("unexpected credential flags: %#v", credential)
	}
}

func TestExtractAPIBearerTokenRequiresBearerHeader(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("Authorization", "Basic header-token")
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got, credential := extractAPIBearerToken(req)
	if got != "" {
		t.Fatalf("expected empty API token for non-bearer header, got %q", got)
	}
	if !credential.AuthorizationHeader || credential.BearerScheme || !credential.CookiePresent {
		t.Fatalf("unexpected credential flags: %#v", credential)
	}
}

func TestExtractAPIBearerTokenAcceptsCaseInsensitiveBearer(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("Authorization", "bearer header-token")

	got, credential := extractAPIBearerToken(req)
	if got != "header-token" {
		t.Fatalf("expected header token, got %q", got)
	}
	if !credential.AuthorizationHeader || !credential.BearerScheme || credential.CookiePresent {
		t.Fatalf("unexpected credential flags: %#v", credential)
	}
}

func TestAPITokenAuthLogsMissingHeaderWithoutLeakingSecrets(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	originalOutput := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(originalOutput)

	router := gin.New()
	router.GET("/v1/models", APITokenAuth(nil), func(c *gin.Context) {
		t.Fatal("handler should not run without an API token header")
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/models?api_key=secret-token", nil)
	req.Header.Set("User-Agent", "sdk-test")
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "missing api token") {
		t.Fatalf("expected missing-token response, got %s", rec.Body.String())
	}

	output := logs.String()
	for _, want := range []string{
		"public_api_auth_failure",
		"reason=missing",
		"route=/v1/models",
		"auth_header=false",
		"bearer=false",
		"cookie_present=true",
		`user_agent="sdk-test"`,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected log to contain %q, got %q", want, output)
		}
	}
	if strings.Contains(output, "secret-token") || strings.Contains(output, "api_key") || strings.Contains(output, "cookie-token") {
		t.Fatalf("auth failure log leaked a secret: %q", output)
	}
}

func TestAPITokenAuthFailureLogUsesTokenHashPrefix(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	originalOutput := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(originalOutput)

	router := gin.New()
	router.GET("/v1/models", func(c *gin.Context) {
		logAPITokenAuthFailure(
			c,
			http.StatusUnauthorized,
			"invalid",
			apiBearerCredential{AuthorizationHeader: true, BearerScheme: true},
			"secret-token",
		)
		c.Status(http.StatusUnauthorized)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	req.Header.Set("User-Agent", "sdk-test")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	hashPrefix := hashToken("secret-token")[:12]
	output := logs.String()
	for _, want := range []string{
		"reason=invalid",
		"auth_header=true",
		"bearer=true",
		"token_len=12",
		"token_preview=sec...ken",
		"token_hash_prefix=" + hashPrefix,
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected log to contain %q, got %q", want, output)
		}
	}
	if strings.Contains(output, "secret-token") {
		t.Fatalf("auth failure log leaked raw token: %q", output)
	}
}

func TestMaskAPITokenForLogNeverReturnsRawLongToken(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		token string
		want  string
	}{
		{name: "short", token: "abc123", want: "******"},
		{name: "medium", token: "secret-token", want: "sec...ken"},
		{name: "long", token: "customer-debug-token-001", want: "custom...-001"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := maskAPITokenForLog(tc.token)
			if got != tc.want {
				t.Fatalf("maskAPITokenForLog(%q) = %q, want %q", tc.token, got, tc.want)
			}
			if got == tc.token {
				t.Fatalf("maskAPITokenForLog returned raw token %q", got)
			}
		})
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
