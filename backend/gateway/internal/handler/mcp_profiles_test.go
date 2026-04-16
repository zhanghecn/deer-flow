package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

func TestMCPProfileHandlerCreateAndList(t *testing.T) {
	gin.SetMode(gin.TestMode)
	baseDir := filepath.Join(t.TempDir(), ".openagents")
	handler := NewMCPProfileHandler(service.NewMCPProfileService(storage.NewFS(baseDir)))

	createBody := []byte(`{"name":"customer-docs","config_json":{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}}`)
	createRecorder := httptest.NewRecorder()
	createContext, _ := gin.CreateTestContext(createRecorder)
	createContext.Request = httptest.NewRequest(http.MethodPost, "/api/mcp/profiles", bytes.NewReader(createBody))
	createContext.Request.Header.Set("Content-Type", "application/json")

	handler.Create(createContext)

	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("Create() status = %d, want %d", createRecorder.Code, http.StatusCreated)
	}

	listRecorder := httptest.NewRecorder()
	listContext, _ := gin.CreateTestContext(listRecorder)
	listContext.Request = httptest.NewRequest(http.MethodGet, "/api/mcp/profiles", nil)

	handler.List(listContext)

	if listRecorder.Code != http.StatusOK {
		t.Fatalf("List() status = %d, want %d", listRecorder.Code, http.StatusOK)
	}

	var response map[string]any
	if err := json.Unmarshal(listRecorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	items, ok := response["profiles"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("profiles = %#v, want one profile", response["profiles"])
	}
}

func TestMCPProfileHandlerUpdateReadOnlyProfileReturnsForbidden(t *testing.T) {
	gin.SetMode(gin.TestMode)
	baseDir := filepath.Join(t.TempDir(), ".openagents")
	systemProfile := filepath.Join(baseDir, "system", "mcp-profiles", "github.json")
	if err := os.MkdirAll(filepath.Dir(systemProfile), 0o755); err != nil {
		t.Fatalf("mkdir system profile dir: %v", err)
	}
	if err := os.WriteFile(systemProfile, []byte(`{"mcpServers":{"github":{"type":"stdio","command":"npx"}}}`), 0o644); err != nil {
		t.Fatalf("write system profile: %v", err)
	}

	handler := NewMCPProfileHandler(service.NewMCPProfileService(storage.NewFS(baseDir)))
	updateBody := []byte(`{"config_json":{"mcpServers":{"github":{"type":"stdio","command":"printf"}}}}`)
	updateRecorder := httptest.NewRecorder()
	updateContext, _ := gin.CreateTestContext(updateRecorder)
	updateContext.Params = gin.Params{{Key: "name", Value: "github"}}
	updateContext.Request = httptest.NewRequest(http.MethodPut, "/api/mcp/profiles/github", bytes.NewReader(updateBody))
	updateContext.Request.Header.Set("Content-Type", "application/json")

	handler.Update(updateContext)

	if updateRecorder.Code != http.StatusForbidden {
		t.Fatalf("Update() status = %d, want %d", updateRecorder.Code, http.StatusForbidden)
	}
}
