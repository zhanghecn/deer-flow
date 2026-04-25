package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
		"",
		storage.NewFS(t.TempDir()),
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
