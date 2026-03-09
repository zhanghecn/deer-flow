package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
)

func TestLangGraphRuntimeInjectsHeadersWithoutMutatingBody(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := NewLangGraphRuntimeHandler()
	testUserID := uuid.MustParse("11111111-1111-1111-1111-111111111111")

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
		c.Header("x-seen-user", c.GetHeader(headerUserID))
		c.Header("x-seen-thread", c.GetHeader(headerThreadID))
		c.Data(http.StatusOK, "application/json", raw)
	})

	reqBody := `{"input":{"messages":[]},"config":{"configurable":{"model_name":"kimi-k2.5-1"}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs/stream", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("x-seen-user"); got != testUserID.String() {
		t.Fatalf("expected header x-user-id %s, got %s", testUserID, got)
	}
	if got := rec.Header().Get("x-seen-thread"); got != "t1" {
		t.Fatalf("expected header x-thread-id t1, got %s", got)
	}
	if rec.Body.String() != reqBody {
		t.Fatalf("expected request body passthrough %q, got %q", reqBody, rec.Body.String())
	}
}

func TestLangGraphRuntimeHistoryInjectsHeaders(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := NewLangGraphRuntimeHandler()
	testUserID := uuid.MustParse("11111111-1111-1111-1111-111111111111")

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		c.Header("x-seen-user", c.GetHeader(headerUserID))
		c.Header("x-seen-thread", c.GetHeader(headerThreadID))
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/history", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("x-seen-user"); got != testUserID.String() {
		t.Fatalf("expected header x-user-id %s, got %s", testUserID, got)
	}
	if got := rec.Header().Get("x-seen-thread"); got != "t1" {
		t.Fatalf("expected header x-thread-id t1, got %s", got)
	}
}

func TestLangGraphRuntimeSkipsThreadHeaderWhenPathHasNoThread(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := NewLangGraphRuntimeHandler()
	testUserID := uuid.MustParse("11111111-1111-1111-1111-111111111111")

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), testUserID)
		c.Next()
	})
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		c.Header("x-seen-user", c.GetHeader(headerUserID))
		c.Header("x-seen-thread", c.GetHeader(headerThreadID))
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/runs/stream", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if got := rec.Header().Get("x-seen-user"); got != testUserID.String() {
		t.Fatalf("expected header x-user-id %s, got %s", testUserID, got)
	}
	if got := rec.Header().Get("x-seen-thread"); got != "" {
		t.Fatalf("expected empty x-thread-id header, got %s", got)
	}
}
