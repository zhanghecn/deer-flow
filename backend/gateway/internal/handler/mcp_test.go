package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMCPHandlerGetReturnsNormalizedShapeWhenConfigMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	configPath := filepath.Join(t.TempDir(), "extensions_config.json")
	handler := NewMCPHandler(configPath)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/mcp/config", nil)

	handler.Get(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("Get() status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	servers, ok := response["mcp_servers"].(map[string]any)
	if !ok {
		t.Fatalf("response missing mcp_servers map: %#v", response)
	}
	if len(servers) != 0 {
		t.Fatalf("len(mcp_servers) = %d, want 0", len(servers))
	}
}

func TestMCPHandlerUpdatePreservesSkillsAndNormalizesResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	configPath := filepath.Join(t.TempDir(), "extensions_config.json")
	initial := extensionsConfigJSON{
		MCPServers: map[string]any{},
		Skills: map[string]skillStateJSON{
			"contract-review": {Enabled: true},
		},
	}
	if err := writeExtensionsConfig(configPath, initial); err != nil {
		t.Fatalf("write initial config: %v", err)
	}

	handler := NewMCPHandler(configPath)
	body := []byte(`{"mcp_servers":{"github":{"enabled":true,"description":"GitHub"}}}`)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/mcp/config", bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", "application/json")

	handler.Update(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("Update() status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if _, ok := response["mcp_servers"].(map[string]any); !ok {
		t.Fatalf("response missing mcp_servers map: %#v", response)
	}

	written, err := readExtensionsConfig(configPath)
	if err != nil {
		t.Fatalf("read written config: %v", err)
	}
	if len(written.Skills) != 1 || !written.Skills["contract-review"].Enabled {
		t.Fatalf("skills config was not preserved: %#v", written.Skills)
	}
	if _, ok := written.MCPServers["github"].(map[string]any); !ok {
		t.Fatalf("expected github MCP server in written config: %#v", written.MCPServers)
	}
}
