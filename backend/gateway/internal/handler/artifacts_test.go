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
		{
			name: "url encoded path",
			url:  "/api/threads/thread-1/artifacts/mnt/user-data/outputs/A%E8%82%A1%E6%8A%A5%E5%91%8A.txt",
			want: "cn-ok",
		},
	}

	encodedFile := filepath.Join(userDataDir, "outputs", "A股报告.txt")
	if err := os.WriteFile(encodedFile, []byte("cn-ok"), 0o644); err != nil {
		t.Fatalf("write encoded output file: %v", err)
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
			if rec.Body.String() != tc.want {
				t.Fatalf("expected body %q, got %q", tc.want, rec.Body.String())
			}
		})
	}
}

func TestArtifactsHandlerServesOfficePreviewPDF(t *testing.T) {
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-preview"
	userDataDir := filepath.Join(baseDir, "threads", threadID, "user-data")
	deckPath := filepath.Join(userDataDir, "outputs", "deck.docx")
	previewPath := filepath.Join(userDataDir, "outputs", "deck.docx.preview.pdf")

	if err := os.MkdirAll(filepath.Dir(deckPath), 0o755); err != nil {
		t.Fatalf("mkdir outputs: %v", err)
	}
	if err := os.WriteFile(deckPath, []byte("pptx"), 0o644); err != nil {
		t.Fatalf("write deck: %v", err)
	}
	if err := os.WriteFile(previewPath, []byte("%PDF-1.7 preview"), 0o644); err != nil {
		t.Fatalf("write preview pdf: %v", err)
	}

	originalConverter := officePreviewConverter
	officePreviewConverter = func(filePath string) (string, error) {
		if filePath != deckPath {
			t.Fatalf("unexpected converter path %q", filePath)
		}
		return previewPath, nil
	}
	t.Cleanup(func() {
		officePreviewConverter = originalConverter
	})

	handler := NewArtifactsHandler(storage.NewFS(baseDir))

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/threads/thread-preview/artifacts/mnt/user-data/outputs/deck.docx?preview=pdf",
		nil,
	)
	c.Params = gin.Params{
		{Key: "id", Value: threadID},
		{Key: "path", Value: "/mnt/user-data/outputs/deck.docx"},
	}

	handler.Serve(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/pdf") {
		t.Fatalf("expected pdf content-type, got %q", got)
	}
	if rec.Body.String() != "%PDF-1.7 preview" {
		t.Fatalf("unexpected body: %q", rec.Body.String())
	}
}

func TestArtifactsHandlerListReturnsThreadOutputFiles(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	threadID := "thread-list"
	userDataDir := filepath.Join(baseDir, "threads", threadID, "user-data")
	outputsDir := filepath.Join(userDataDir, "outputs")

	files := map[string]string{
		"bundle/index.html":               "<html></html>",
		"bundle/dragon-constellation.jpg": "jpg",
		"bundle/notes.md":                 "# Notes",
		"bundle/deck.docx.preview.pdf":    "%PDF",
		".hidden/secret.txt":              "skip",
	}
	for relativePath, content := range files {
		fullPath := filepath.Join(outputsDir, relativePath)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatalf("mkdir output file dir: %v", err)
		}
		if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
			t.Fatalf("write output file: %v", err)
		}
	}

	handler := NewArtifactsHandler(storage.NewFS(baseDir))

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/threads/thread-list/artifacts/list",
		nil,
	)
	c.Params = gin.Params{{Key: "id", Value: threadID}}

	handler.List(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	expected := `{"artifacts":["/mnt/user-data/outputs/bundle/dragon-constellation.jpg","/mnt/user-data/outputs/bundle/index.html","/mnt/user-data/outputs/bundle/notes.md"]}`
	if strings.TrimSpace(rec.Body.String()) != expected {
		t.Fatalf("unexpected body: %s", rec.Body.String())
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

func TestOfficePreviewPath(t *testing.T) {
	t.Parallel()

	got := officePreviewPath("/tmp/demo.docx")
	if got != "/tmp/demo.docx.preview.pdf" {
		t.Fatalf("unexpected preview path: %q", got)
	}
}
