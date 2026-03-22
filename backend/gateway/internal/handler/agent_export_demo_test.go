package handler

import (
	"archive/zip"
	"bytes"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func TestBuildReactDemoArchiveIncludesArtifactViewer(t *testing.T) {
	t.Parallel()

	archive, err := buildReactDemoArchive(
		"demo-agent",
		"http://localhost:8001",
		"demo-token",
		time.Unix(1, 0).UTC(),
		gin.H{"agent": "demo-agent"},
	)
	if err != nil {
		t.Fatalf("buildReactDemoArchive: %v", err)
	}

	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("zip.NewReader: %v", err)
	}

	var appJSX string
	for _, file := range reader.File {
		if file.Name != "src/App.jsx" {
			continue
		}
		rc, openErr := file.Open()
		if openErr != nil {
			t.Fatalf("open App.jsx: %v", openErr)
		}
		defer rc.Close()

		content, readErr := io.ReadAll(rc)
		if readErr != nil {
			t.Fatalf("read App.jsx: %v", readErr)
		}
		appJSX = string(content)
		break
	}

	if appJSX == "" {
		t.Fatalf("expected src/App.jsx in archive")
	}
	if !strings.Contains(appJSX, "Preview And Download") {
		t.Fatalf("expected artifact preview UI in App.jsx")
	}
	if !strings.Contains(appJSX, "/open/v1/agents/") {
		t.Fatalf("expected open api artifact route in App.jsx")
	}
	if !strings.Contains(appJSX, "Office preview is unavailable on this gateway") {
		t.Fatalf("expected office preview fallback copy in App.jsx")
	}
}
