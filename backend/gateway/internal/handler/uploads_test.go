package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/pkg/storage"
)

type uploadsResponse struct {
	Success bool              `json:"success"`
	Files   []uploadedFileDTO `json:"files"`
	Message string            `json:"message"`
}

type uploadsListResponse struct {
	Files []uploadedFileDTO `json:"files"`
	Count int               `json:"count"`
}

type uploadedFileDTO struct {
	Filename            string `json:"filename"`
	MarkdownFile        string `json:"markdown_file"`
	VirtualPath         string `json:"virtual_path"`
	MarkdownVirtualPath string `json:"markdown_virtual_path"`
}

func writeFakeMarkItDown(t *testing.T) string {
	t.Helper()

	scriptPath := filepath.Join(t.TempDir(), "markitdown")
	script := `#!/bin/sh
input="$1"
flag="$2"
output="$3"
if [ ! -f "$input" ]; then
  echo "missing input" >&2
  exit 1
fi
if [ "$flag" != "-o" ] || [ -z "$output" ]; then
  echo "missing output" >&2
  exit 1
fi
printf '# converted\n' > "$output"
`
	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		t.Fatalf("write fake markitdown: %v", err)
	}
	return scriptPath
}

func writeFailingMarkItDown(t *testing.T) string {
	t.Helper()

	scriptPath := filepath.Join(t.TempDir(), "markitdown")
	script := `#!/bin/sh
echo "markitdown failed" >&2
exit 1
`
	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		t.Fatalf("write failing markitdown: %v", err)
	}
	return scriptPath
}

func writeFakeAntiword(t *testing.T, body string) string {
	t.Helper()

	scriptPath := filepath.Join(t.TempDir(), "antiword")
	script := "#!/bin/sh\nprintf '%s\\n'" + " '" + strings.ReplaceAll(body, "'", "'\"'\"'") + "'\n"
	if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		t.Fatalf("write fake antiword: %v", err)
	}
	return scriptPath
}

func multipartUploadRequest(t *testing.T, filename string, content []byte) *http.Request {
	t.Helper()

	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	fileWriter, err := writer.CreateFormFile("files", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fileWriter.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/threads/thread-1/uploads", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestUploadsHandlerUploadCreatesMarkdownCompanionForConvertibleDocs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("OPENAGENTS_MARKITDOWN_BIN", writeFakeMarkItDown(t))

	fsStore := storage.NewFS(filepath.Join(t.TempDir(), ".openagents"))
	userID := uuid.New()
	handler := NewUploadsHandler(fsStore)

	request := multipartUploadRequest(t, "contract.pdf", []byte("%PDF-1.4"))
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = request
	context.Set(string(middleware.UserIDKey), userID)
	context.Params = gin.Params{{Key: "id", Value: "thread-1"}}

	handler.Upload(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("Upload() status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var response uploadsResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(response.Files) != 1 {
		t.Fatalf("len(response.Files) = %d, want 1", len(response.Files))
	}
	if response.Files[0].Filename != "contract.pdf" {
		t.Fatalf("response.Files[0].Filename = %q, want %q", response.Files[0].Filename, "contract.pdf")
	}
	if response.Files[0].MarkdownFile != "contract.md" {
		t.Fatalf("response.Files[0].MarkdownFile = %q, want %q", response.Files[0].MarkdownFile, "contract.md")
	}
	if response.Files[0].MarkdownVirtualPath != "/mnt/user-data/uploads/contract.md" {
		t.Fatalf("response.Files[0].MarkdownVirtualPath = %q, want %q", response.Files[0].MarkdownVirtualPath, "/mnt/user-data/uploads/contract.md")
	}

	if _, err := os.Stat(filepath.Join(fsStore.ThreadUserDataDirForUser(userID.String(), "thread-1"), "uploads", "contract.md")); err != nil {
		t.Fatalf("expected markdown companion to exist: %v", err)
	}
}

func TestUploadsHandlerListCollapsesGeneratedMarkdownCompanions(t *testing.T) {
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(filepath.Join(t.TempDir(), ".openagents"))
	userID := uuid.New()
	uploadsDir := filepath.Join(fsStore.ThreadUserDataDirForUser(userID.String(), "thread-1"), "uploads")
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		t.Fatalf("mkdir uploads: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadsDir, "contract.pdf"), []byte("%PDF-1.4"), 0644); err != nil {
		t.Fatalf("write contract.pdf: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadsDir, "contract.md"), []byte("# contract"), 0644); err != nil {
		t.Fatalf("write contract.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadsDir, "notes.txt"), []byte("notes"), 0644); err != nil {
		t.Fatalf("write notes.txt: %v", err)
	}

	handler := NewUploadsHandler(fsStore)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/threads/thread-1/uploads/list", nil)
	context.Set(string(middleware.UserIDKey), userID)
	context.Params = gin.Params{{Key: "id", Value: "thread-1"}}

	handler.List(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("List() status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var response uploadsListResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if response.Count != 2 {
		t.Fatalf("response.Count = %d, want 2", response.Count)
	}
	if len(response.Files) != 2 {
		t.Fatalf("len(response.Files) = %d, want 2", len(response.Files))
	}
	if response.Files[0].Filename != "contract.pdf" {
		t.Fatalf("response.Files[0].Filename = %q, want %q", response.Files[0].Filename, "contract.pdf")
	}
	if response.Files[0].MarkdownFile != "contract.md" {
		t.Fatalf("response.Files[0].MarkdownFile = %q, want %q", response.Files[0].MarkdownFile, "contract.md")
	}
	if response.Files[1].Filename != "notes.txt" {
		t.Fatalf("response.Files[1].Filename = %q, want %q", response.Files[1].Filename, "notes.txt")
	}
}

func TestUploadsHandlerDeleteRemovesMarkdownCompanion(t *testing.T) {
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(filepath.Join(t.TempDir(), ".openagents"))
	userID := uuid.New()
	uploadsDir := filepath.Join(fsStore.ThreadUserDataDirForUser(userID.String(), "thread-1"), "uploads")
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		t.Fatalf("mkdir uploads: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadsDir, "contract.pdf"), []byte("%PDF-1.4"), 0644); err != nil {
		t.Fatalf("write contract.pdf: %v", err)
	}
	if err := os.WriteFile(filepath.Join(uploadsDir, "contract.md"), []byte("# contract"), 0644); err != nil {
		t.Fatalf("write contract.md: %v", err)
	}

	handler := NewUploadsHandler(fsStore)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/threads/thread-1/uploads/contract.pdf", nil)
	context.Set(string(middleware.UserIDKey), userID)
	context.Params = gin.Params{
		{Key: "id", Value: "thread-1"},
		{Key: "filename", Value: "contract.pdf"},
	}

	handler.Delete(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("Delete() status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(uploadsDir, "contract.pdf")); !os.IsNotExist(err) {
		t.Fatalf("expected contract.pdf to be removed, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(uploadsDir, "contract.md")); !os.IsNotExist(err) {
		t.Fatalf("expected contract.md to be removed, stat err=%v", err)
	}
}

func TestMarkitdownBinaryFallsBackToRepoVirtualenv(t *testing.T) {
	root := t.TempDir()
	expected := filepath.Join(root, "backend", ".venv", "bin", "markitdown")
	if err := os.MkdirAll(filepath.Dir(expected), 0755); err != nil {
		t.Fatalf("mkdir bundled markitdown dir: %v", err)
	}
	if err := os.WriteFile(expected, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatalf("write bundled markitdown: %v", err)
	}

	workingDir := filepath.Join(root, "backend", "gateway")
	if err := os.MkdirAll(workingDir, 0755); err != nil {
		t.Fatalf("mkdir working dir: %v", err)
	}
	previousDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousDir)
	})
	if err := os.Chdir(workingDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	t.Setenv("PATH", "")
	got, err := markitdownBinary()
	if err != nil {
		t.Fatalf("markitdownBinary() error = %v", err)
	}
	if got != expected {
		t.Fatalf("markitdownBinary() = %q, want %q", got, expected)
	}
}

func TestConvertFileToMarkdownFallsBackToAntiwordForDoc(t *testing.T) {
	t.Setenv("OPENAGENTS_MARKITDOWN_BIN", writeFailingMarkItDown(t))
	t.Setenv("OPENAGENTS_ANTIWORD_BIN", writeFakeAntiword(t, "命理讲义\n第一章\n1、正文小节\n正文内容"))

	sourcePath := filepath.Join(t.TempDir(), "sample.doc")
	if err := os.WriteFile(sourcePath, []byte("doc"), 0644); err != nil {
		t.Fatalf("write source doc: %v", err)
	}

	markdownPath, err := convertFileToMarkdown(sourcePath)
	if err != nil {
		t.Fatalf("convertFileToMarkdown() error = %v", err)
	}
	if markdownPath != strings.TrimSuffix(sourcePath, ".doc")+".md" {
		t.Fatalf("markdownPath = %q", markdownPath)
	}
	content, err := os.ReadFile(markdownPath)
	if err != nil {
		t.Fatalf("read markdown companion: %v", err)
	}
	if got := string(content); got != "# 命理讲义\n\n## 第一章\n\n### 1、正文小节\n\n正文内容\n" {
		t.Fatalf("markdown companion = %q", got)
	}
}
