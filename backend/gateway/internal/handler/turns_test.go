package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

func TestTurnsHandlerStreamsStructuredPrepareRunFailure(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	handler := NewTurnsHandler(service.NewPublicAPIService(
		nil,
		nil,
		nil,
		nil,
		nil,
		"",
		storage.NewFS(t.TempDir()),
		90*time.Minute,
	))
	router.POST("/v1/turns", handler.Create)

	requestBody := []byte(`{
		"agent":"missing-agent",
		"input":{"text":"hello"},
		"stream":true
	}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/turns", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	body := recorder.Body.String()
	if !strings.Contains(body, "event: turn.failed") {
		t.Fatalf("expected failed SSE event, got %q", body)
	}
	if !strings.Contains(body, `"status":"failed"`) {
		t.Fatalf("expected structured failed status, got %q", body)
	}
	if !strings.Contains(body, `"stage":"prepare_run"`) {
		t.Fatalf("expected prepare_run stage, got %q", body)
	}
	if !strings.Contains(body, `"retryable":false`) {
		t.Fatalf("expected retryable=false, got %q", body)
	}
}

func TestStreamSSEWithHeartbeatWritesCommentsDuringQuietRun(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/stream", func(c *gin.Context) {
		err := streamSSEWithHeartbeat(c, 10*time.Millisecond, func(_ context.Context, emit func(string, any) error) error {
			time.Sleep(35 * time.Millisecond)
			return emit("done", gin.H{"ok": true})
		})
		if err != nil {
			t.Errorf("streamSSEWithHeartbeat: %v", err)
		}
	})

	request := httptest.NewRequest(http.MethodGet, "/stream", nil)
	request.Header.Set("Accept", "text/event-stream")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	body := recorder.Body.String()
	if !strings.Contains(body, ": ping\n\n") {
		t.Fatalf("expected heartbeat comment in SSE body, got %q", body)
	}
	if !strings.Contains(body, "event: done") {
		t.Fatalf("expected final event after heartbeat, got %q", body)
	}
}
