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
		c.Data(http.StatusOK, "application/json", raw)
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

	configurable := response["configurable"].(map[string]interface{})
	if got := configurable["user_id"]; got != testUserID.String() {
		t.Fatalf("expected configurable.user_id %s, got %v", testUserID, got)
	}
	if got := configurable["thread_id"]; got != "t1" {
		t.Fatalf("expected configurable.thread_id t1, got %v", got)
	}

	config := response["config"].(map[string]interface{})
	nestedConfigurable := config["configurable"].(map[string]interface{})
	if got := nestedConfigurable["user_id"]; got != testUserID.String() {
		t.Fatalf("expected config.configurable.user_id %s, got %v", testUserID, got)
	}
	if got := nestedConfigurable["thread_id"]; got != "t1" {
		t.Fatalf("expected config.configurable.thread_id t1, got %v", got)
	}

	contextPayload := response["context"].(map[string]interface{})
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
	router := gin.New()
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	reqBody := `{"limit":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/history", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
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
	router := gin.New()
	router.POST("/api/langgraph/*path", handler.InjectRuntimeConfig(), func(c *gin.Context) {
		raw, _ := c.GetRawData()
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
}

func TestLangGraphRuntimeRejectsNonObjectConfigurable(t *testing.T) {
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

	reqBody := `{"configurable":"invalid"}`
	req := httptest.NewRequest(http.MethodPost, "/api/langgraph/threads/t1/runs/stream", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
