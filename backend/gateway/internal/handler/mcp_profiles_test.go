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

func TestMCPProfileHandlerUpdateMissingProfileReturnsNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	baseDir := filepath.Join(t.TempDir(), ".openagents")

	handler := NewMCPProfileHandler(service.NewMCPProfileService(storage.NewFS(baseDir)))
	updateBody := []byte(`{"config_json":{"mcpServers":{"github":{"type":"stdio","command":"printf"}}}}`)
	updateRecorder := httptest.NewRecorder()
	updateContext, _ := gin.CreateTestContext(updateRecorder)
	updateContext.Params = gin.Params{{Key: "name", Value: "github"}}
	updateContext.Request = httptest.NewRequest(http.MethodPut, "/api/mcp/profiles/github", bytes.NewReader(updateBody))
	updateContext.Request.Header.Set("Content-Type", "application/json")

	handler.Update(updateContext)

	if updateRecorder.Code != http.StatusNotFound {
		t.Fatalf("Update() status = %d, want %d", updateRecorder.Code, http.StatusNotFound)
	}
}

func TestMCPProfileHandlerDeleteBoundProfileReturnsConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	baseDir := filepath.Join(t.TempDir(), ".openagents")
	profileFile := filepath.Join(baseDir, "mcp-profiles", "customer-docs.json")
	if err := os.MkdirAll(filepath.Dir(profileFile), 0o755); err != nil {
		t.Fatalf("mkdir global profile dir: %v", err)
	}
	if err := os.WriteFile(profileFile, []byte(`{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}`), 0o644); err != nil {
		t.Fatalf("write global profile: %v", err)
	}

	fsStore := storage.NewFS(baseDir)
	if err := fsStore.WriteAgentFiles("support-agent", "prod", "# Agent", map[string]interface{}{
		"name":           "support-agent",
		"description":    "Support agent",
		"status":         "prod",
		"agents_md_path": "AGENTS.md",
		"mcp_servers":    []string{"mcp-profiles/customer-docs.json"},
	}); err != nil {
		t.Fatalf("seed agent files: %v", err)
	}

	handler := NewMCPProfileHandler(service.NewMCPProfileService(fsStore))
	deleteRecorder := httptest.NewRecorder()
	deleteContext, _ := gin.CreateTestContext(deleteRecorder)
	deleteContext.Params = gin.Params{{Key: "name", Value: "customer-docs"}}
	deleteContext.Request = httptest.NewRequest(http.MethodDelete, "/api/mcp/profiles/customer-docs", nil)

	handler.Delete(deleteContext)

	if deleteRecorder.Code != http.StatusConflict {
		t.Fatalf("Delete() status = %d, want %d", deleteRecorder.Code, http.StatusConflict)
	}
}

func TestMCPProfileHandlerCreateInvalidConfigReturnsBadRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	baseDir := filepath.Join(t.TempDir(), ".openagents")
	handler := NewMCPProfileHandler(service.NewMCPProfileService(storage.NewFS(baseDir)))

	createBody := []byte(`{"name":"broken","config_json":{"mcpServers":{"broken":{"type":"http"}}}}`)
	createRecorder := httptest.NewRecorder()
	createContext, _ := gin.CreateTestContext(createRecorder)
	createContext.Request = httptest.NewRequest(http.MethodPost, "/api/mcp/profiles", bytes.NewReader(createBody))
	createContext.Request.Header.Set("Content-Type", "application/json")

	handler.Create(createContext)

	if createRecorder.Code != http.StatusBadRequest {
		t.Fatalf("Create() status = %d, want %d", createRecorder.Code, http.StatusBadRequest)
	}
}
