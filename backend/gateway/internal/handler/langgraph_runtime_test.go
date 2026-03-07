package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
)

func TestLangGraphRuntimeInjectsUserID(t *testing.T) {
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
		var payload map[string]interface{}
		_ = json.Unmarshal(raw, &payload)
		c.JSON(http.StatusOK, gin.H{
			"payload":          payload,
			"header_user_id":   c.GetHeader(headerUserID),
			"header_thread_id": c.GetHeader(headerThreadID),
		})
	})

	reqBody := `{"input":{"messages":[]},"context":{"model_name":"kimi-k2.5-1"},"config":{"recursion_limit":1000}}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs/stream", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if got := response["header_user_id"]; got != testUserID.String() {
		t.Fatalf("expected header x-user-id %s, got %v", testUserID, got)
	}
	if got := response["header_thread_id"]; got != "t1" {
		t.Fatalf("expected header x-thread-id t1, got %v", got)
	}

	payload := response["payload"].(map[string]interface{})
	if configPayload, ok := payload["config"].(map[string]interface{}); ok {
		if _, hasConfigurable := configPayload["configurable"]; hasConfigurable {
			t.Fatalf("did not expect config.configurable to be injected")
		}
	}

	contextPayload := payload["context"].(map[string]interface{})
	if got := contextPayload["user_id"]; got != testUserID.String() {
		t.Fatalf("expected context.user_id %s, got %v", testUserID, got)
	}
	if got := contextPayload["thread_id"]; got != "t1" {
		t.Fatalf("expected context.thread_id t1, got %v", got)
	}
}

func TestLangGraphRuntimeHistoryNoModelValidation(t *testing.T) {
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
		var payload map[string]interface{}
		_ = json.Unmarshal(raw, &payload)
		c.JSON(http.StatusOK, gin.H{
			"payload":          payload,
			"header_user_id":   c.GetHeader(headerUserID),
			"header_thread_id": c.GetHeader(headerThreadID),
		})
	})

	reqBody := `{"limit":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/history", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got := response["header_user_id"]; got != testUserID.String() {
		t.Fatalf("expected header x-user-id %s, got %v", testUserID, got)
	}
	if got := response["header_thread_id"]; got != "t1" {
		t.Fatalf("expected header x-thread-id t1, got %v", got)
	}
}

func TestLangGraphRuntimePassesThroughInvalidJSON(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := NewLangGraphRuntimeHandler()
	router := gin.New()
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
		c.Data(http.StatusOK, "application/json", raw)
	})

	reqBody := `{invalid json}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if rec.Body.String() != reqBody {
		t.Fatalf("expected body passthrough %q, got %q", reqBody, rec.Body.String())
	}
}

func TestLangGraphRuntimeSkipsNonJSONRequests(t *testing.T) {
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
		c.Data(http.StatusOK, "text/plain", raw)
	})

	reqBody := `raw-body`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if rec.Body.String() != reqBody {
		t.Fatalf("expected body passthrough %q, got %q", reqBody, rec.Body.String())
	}
	if got := rec.Header().Get("x-seen-user"); got != testUserID.String() {
		t.Fatalf("expected x-seen-user %s, got %s", testUserID, got)
	}
	if got := rec.Header().Get("x-seen-thread"); got != "t1" {
		t.Fatalf("expected x-seen-thread t1, got %s", got)
	}
}

func TestLangGraphRuntimeRejectsNonObjectContext(t *testing.T) {
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
		c.Status(http.StatusOK)
	})

	reqBody := `{"context":"invalid"}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs/stream", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
