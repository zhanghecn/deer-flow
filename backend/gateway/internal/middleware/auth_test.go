package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExtractBearerTokenPrefersAuthorizationHeader(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("Authorization", "Bearer header-token")
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got := extractBearerToken(req)
	if got != "header-token" {
		t.Fatalf("expected header token, got %q", got)
	}
}

func TestExtractBearerTokenFallsBackToCookie(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.AddCookie(&http.Cookie{Name: AuthCookieName, Value: "cookie-token"})

	got := extractBearerToken(req)
	if got != "cookie-token" {
		t.Fatalf("expected cookie token, got %q", got)
	}
}

func TestExtractBearerTokenHandlesMissingCredentials(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "http://example.com", nil)
	got := extractBearerToken(req)
	if got != "" {
		t.Fatalf("expected empty token, got %q", got)
	}
}
