package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestResolvePublicGatewayBaseURLRewritesFrontendPorts(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest("GET", "http://localhost:3000/api/agents/demo/export", nil)
	request.Host = "localhost:3000"
	context.Request = request

	if got := resolvePublicGatewayBaseURL(context); got != "http://localhost:8001" {
		t.Fatalf("expected rewritten gateway base URL, got %q", got)
	}
}

func TestSanitizeDemoNameFallsBackForEmptyInput(t *testing.T) {
	t.Parallel()

	if got := sanitizeDemoName("  "); got != "openagents-agent" {
		t.Fatalf("expected fallback demo name, got %q", got)
	}
}
