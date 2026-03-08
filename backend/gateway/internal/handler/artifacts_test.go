package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/pkg/storage"
)

func TestArtifactsHandlerSupportsMntUserDataPrefixes(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-1"
	userDataDir := filepath.Join(baseDir, "threads", threadID, "user-data")
	outputFile := filepath.Join(userDataDir, "outputs", "index.html")
	workspaceFile := filepath.Join(userDataDir, "workspace", "report.html")

	if err := os.MkdirAll(filepath.Dir(outputFile), 0o755); err != nil {
		t.Fatalf("mkdir outputs: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(workspaceFile), 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}
	if err := os.WriteFile(outputFile, []byte("output-ok"), 0o644); err != nil {
		t.Fatalf("write output file: %v", err)
	}
	if err := os.WriteFile(workspaceFile, []byte("workspace-ok"), 0o644); err != nil {
		t.Fatalf("write workspace file: %v", err)
	}

	handler := NewArtifactsHandler(storage.NewFS(baseDir))

	tests := []struct {
		name string
		url  string
		want string
	}{
		{
			name: "outputs prefix",
			url:  "/api/threads/thread-1/artifacts/mnt/user-data/outputs/index.html",
			want: "output-ok",
		},
		{
			name: "workspace prefix",
			url:  "/api/threads/thread-1/artifacts/mnt/user-data/workspace/report.html",
			want: "workspace-ok",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodGet, tc.url, nil)
			c.Params = gin.Params{
				{Key: "id", Value: threadID},
				{Key: "path", Value: strings.TrimPrefix(tc.url, "/api/threads/"+threadID+"/artifacts")},
			}
			handler.Serve(c)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestNormalizeArtifactPath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input string
		path  string
		scope string
	}{
		{
			input: "mnt/user-data/outputs/index.html",
			path:  "index.html",
			scope: "outputs",
		},
		{
			input: "mnt/user-data/workspace/report.html",
			path:  "report.html",
			scope: "workspace",
		},
		{
			input: "outputs/index.html",
			path:  "index.html",
			scope: "outputs",
		},
		{
			input: "workspace/report.html",
			path:  "report.html",
			scope: "workspace",
		},
		{
			input: "raw/path/file.txt",
			path:  "raw/path/file.txt",
			scope: "",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.input, func(t *testing.T) {
			t.Parallel()
			gotPath, gotScope := normalizeArtifactPath(tc.input)
			if gotPath != tc.path || gotScope != tc.scope {
				t.Fatalf("normalizeArtifactPath(%q) => (%q,%q), want (%q,%q)", tc.input, gotPath, gotScope, tc.path, tc.scope)
			}
		})
	}
}
