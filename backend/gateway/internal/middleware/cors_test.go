package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSPreflightAllowsRequestedHeaders(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(CORS())
	router.OPTIONS("/api/langgraph/*path", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodOptions, "/api/langgraph/threads/t1/runs/r1/stream", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "authorization,last-event-id,x-custom-header")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected status 204, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("expected Access-Control-Allow-Origin to echo request origin, got %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("expected Access-Control-Allow-Credentials=true, got %q", got)
	}

	allowHeaders := strings.ToLower(rec.Header().Get("Access-Control-Allow-Headers"))
	for _, want := range []string{"authorization", "last-event-id", "x-custom-header"} {
		if !strings.Contains(allowHeaders, want) {
			t.Fatalf("expected Access-Control-Allow-Headers to include %q, got %q", want, allowHeaders)
		}
	}

	exposeHeaders := strings.ToLower(rec.Header().Get("Access-Control-Expose-Headers"))
	for _, want := range []string{
		"x-pagination-total",
		"x-pagination-next",
		"content-location",
		"x-thread-id",
	} {
		if !strings.Contains(exposeHeaders, want) {
			t.Fatalf("expected Access-Control-Expose-Headers to include %q, got %q", want, exposeHeaders)
		}
	}
}
