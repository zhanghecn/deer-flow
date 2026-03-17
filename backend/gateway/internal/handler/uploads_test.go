package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
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
	handler := NewUploadsHandler(fsStore)

	request := multipartUploadRequest(t, "contract.pdf", []byte("%PDF-1.4"))
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = request
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

	if _, err := os.Stat(filepath.Join(fsStore.ThreadUserDataDir("thread-1"), "uploads", "contract.md")); err != nil {
		t.Fatalf("expected markdown companion to exist: %v", err)
	}
}

func TestUploadsHandlerListCollapsesGeneratedMarkdownCompanions(t *testing.T) {
	gin.SetMode(gin.TestMode)

	fsStore := storage.NewFS(filepath.Join(t.TempDir(), ".openagents"))
	uploadsDir := filepath.Join(fsStore.ThreadUserDataDir("thread-1"), "uploads")
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
	uploadsDir := filepath.Join(fsStore.ThreadUserDataDir("thread-1"), "uploads")
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
