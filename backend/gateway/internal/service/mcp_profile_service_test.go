package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

func TestMCPProfileServiceCreateWritesCanonicalJSONToCustomLibrary(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewMCPProfileService(storage.NewFS(baseDir))

	profile, err := svc.Create(context.Background(), model.CreateMCPProfileRequest{
		Name:       "customer-docs",
		ConfigJSON: []byte(`{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}`),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if profile.Category != "custom" {
		t.Fatalf("profile.Category = %q, want %q", profile.Category, "custom")
	}
	if profile.SourcePath != "custom/mcp-profiles/customer-docs.json" {
		t.Fatalf("profile.SourcePath = %q, want %q", profile.SourcePath, "custom/mcp-profiles/customer-docs.json")
	}
	if profile.ServerName != "customer-docs" {
		t.Fatalf("profile.ServerName = %q, want %q", profile.ServerName, "customer-docs")
	}

	target := filepath.Join(baseDir, "custom", "mcp-profiles", "customer-docs.json")
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("expected profile file at %s: %v", target, err)
	}
}

func TestMCPProfileServiceCreateRejectsMultipleServers(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewMCPProfileService(storage.NewFS(baseDir))

	_, err := svc.Create(context.Background(), model.CreateMCPProfileRequest{
		Name:       "too-many",
		ConfigJSON: []byte(`{"mcpServers":{"one":{"type":"stdio","command":"echo"},"two":{"type":"stdio","command":"printf"}}}`),
	})
	if err == nil || !strings.Contains(err.Error(), "exactly one mcpServers entry") {
		t.Fatalf("Create() error = %v, want single-entry validation failure", err)
	}
}

func TestMCPProfileServiceCreateRejectsInvalidTransportConfig(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewMCPProfileService(storage.NewFS(baseDir))

	_, err := svc.Create(context.Background(), model.CreateMCPProfileRequest{
		Name:       "broken-stdio",
		ConfigJSON: []byte(`{"mcpServers":{"broken-stdio":{"type":"stdio","url":"http://127.0.0.1:8084/mcp"}}}`),
	})
	if err == nil || !strings.Contains(err.Error(), `type "stdio" requires command`) {
		t.Fatalf("Create() error = %v, want stdio command validation failure", err)
	}

	_, err = svc.Create(context.Background(), model.CreateMCPProfileRequest{
		Name:       "broken-http",
		ConfigJSON: []byte(`{"mcpServers":{"broken-http":{"type":"http","command":"node"}}}`),
	})
	if err == nil || !strings.Contains(err.Error(), `type "http" requires url`) {
		t.Fatalf("Create() error = %v, want http url validation failure", err)
	}
}

func TestMCPProfileServiceUpdateRejectsReadOnlySystemProfile(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	target := filepath.Join(baseDir, "system", "mcp-profiles", "github.json")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir profile dir: %v", err)
	}
	if err := os.WriteFile(target, []byte(`{"mcpServers":{"github":{"type":"stdio","command":"npx"}}}`), 0o644); err != nil {
		t.Fatalf("write profile: %v", err)
	}

	svc := NewMCPProfileService(storage.NewFS(baseDir))
	_, err := svc.Update(context.Background(), "github", model.UpdateMCPProfileRequest{
		ConfigJSON: []byte(`{"mcpServers":{"github":{"type":"stdio","command":"printf"}}}`),
	})
	if err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Fatalf("Update() error = %v, want read-only failure", err)
	}
}

func TestMCPProfileServiceDeleteRejectsProfileBoundByAgent(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	profileFile := filepath.Join(baseDir, "custom", "mcp-profiles", "customer-docs.json")
	if err := os.MkdirAll(filepath.Dir(profileFile), 0o755); err != nil {
		t.Fatalf("mkdir profile dir: %v", err)
	}
	if err := os.WriteFile(profileFile, []byte(`{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}`), 0o644); err != nil {
		t.Fatalf("write profile file: %v", err)
	}

	fsStore := storage.NewFS(baseDir)
	if err := fsStore.WriteAgentFiles("support-agent", "prod", "# Agent", map[string]interface{}{
		"name":           "support-agent",
		"description":    "Support agent",
		"status":         "prod",
		"agents_md_path": "AGENTS.md",
		"mcp_servers":    []string{"custom/mcp-profiles/customer-docs.json"},
	}); err != nil {
		t.Fatalf("seed agent files: %v", err)
	}

	svc := NewMCPProfileService(fsStore)
	err := svc.Delete(context.Background(), "customer-docs")
	if err == nil || !strings.Contains(err.Error(), "in use") {
		t.Fatalf("Delete() error = %v, want in-use failure", err)
	}
	if _, statErr := os.Stat(profileFile); statErr != nil {
		t.Fatalf("profile file should remain after rejected delete: %v", statErr)
	}
}

func TestMCPProfileServiceListIncludesSystemAndCustomProfiles(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	systemTarget := filepath.Join(baseDir, "system", "mcp-profiles", "github.json")
	customTarget := filepath.Join(baseDir, "custom", "mcp-profiles", "customer-docs.json")
	if err := os.MkdirAll(filepath.Dir(systemTarget), 0o755); err != nil {
		t.Fatalf("mkdir system dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(customTarget), 0o755); err != nil {
		t.Fatalf("mkdir custom dir: %v", err)
	}
	if err := os.WriteFile(systemTarget, []byte(`{"mcpServers":{"github":{"type":"stdio","command":"npx"}}}`), 0o644); err != nil {
		t.Fatalf("write system profile: %v", err)
	}
	if err := os.WriteFile(customTarget, []byte(`{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}`), 0o644); err != nil {
		t.Fatalf("write custom profile: %v", err)
	}

	svc := NewMCPProfileService(storage.NewFS(baseDir))
	profiles, err := svc.List(context.Background())
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(profiles) != 2 {
		t.Fatalf("len(profiles) = %d, want 2", len(profiles))
	}
}

func TestMCPProfileServiceRejectsTraversalProfileNames(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewMCPProfileService(storage.NewFS(baseDir))

	_, err := svc.Create(context.Background(), model.CreateMCPProfileRequest{
		Name:       "../agents/dev/lead_agent/config.yaml",
		ConfigJSON: []byte(`{"mcpServers":{"escape":{"type":"stdio","command":"echo"}}}`),
	})
	if err == nil || !strings.Contains(err.Error(), "must stay inside the MCP profile library") {
		t.Fatalf("Create() error = %v, want traversal rejection", err)
	}
}

func TestParseMCPProfileSourcePathRejectsTraversal(t *testing.T) {
	t.Parallel()

	_, err := parseMCPProfileSourcePath("custom/mcp-profiles/../agents/dev/lead_agent/config.yaml")
	if err == nil || !strings.Contains(err.Error(), "must stay inside the MCP profile library") {
		t.Fatalf("parseMCPProfileSourcePath() error = %v, want traversal rejection", err)
	}
}
