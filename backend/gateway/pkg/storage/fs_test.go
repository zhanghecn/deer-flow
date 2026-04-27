package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveRefKeepsAgentRefsUnderBaseDir(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	fs := NewFS(baseDir)

	got := fs.ResolveRef("custom/agents/dev/analyst/AGENTS.md")
	want := filepath.Join(baseDir, "custom", "agents", "dev", "analyst", "AGENTS.md")
	if got != want {
		t.Fatalf("ResolveRef() = %q, want %q", got, want)
	}
}

func TestResolveRefRoutesSkillRefsToOpenAgentsSkillsRoot(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	skillsDir := filepath.Join(baseDir, "skills", "store", "prod", "research")
	if err := os.MkdirAll(skillsDir, 0755); err != nil {
		t.Fatalf("mkdir skills dir: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.ResolveRef("skills/store/prod/research/SKILL.md")
	want := filepath.Join(baseDir, "skills", "store", "prod", "research", "SKILL.md")
	if got != want {
		t.Fatalf("ResolveRef() = %q, want %q", got, want)
	}
}

func TestResolveRefRoutesCanonicalStoreSkillRefsToOpenAgentsSkillsRoot(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	skillsDir := filepath.Join(baseDir, "skills", "store", "dev", "research")
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		t.Fatalf("mkdir skills dir: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.ResolveRef("store/dev/research/SKILL.md")
	want := filepath.Join(baseDir, "skills", "store", "dev", "research", "SKILL.md")
	if got != want {
		t.Fatalf("ResolveRef() = %q, want %q", got, want)
	}
}

func TestGlobalSkillDirUsesOpenAgentsSkillsArchive(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	if err := os.MkdirAll(filepath.Join(baseDir, "skills"), 0755); err != nil {
		t.Fatalf("mkdir skills root: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.GlobalSkillDir("store/dev", "data-analysis")
	want := filepath.Join(baseDir, "skills", "store", "dev", "data-analysis")
	if got != want {
		t.Fatalf("GlobalSkillDir() = %q, want %q", got, want)
	}
}

func TestStoreProdSkillsDirUsesOpenAgentsStoreProdScope(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	if err := os.MkdirAll(filepath.Join(baseDir, "skills", "store", "prod"), 0755); err != nil {
		t.Fatalf("mkdir store/prod skills root: %v", err)
	}

	fs := NewFS(baseDir)

	got := fs.StoreProdSkillsDir()
	want := filepath.Join(baseDir, "skills", "store", "prod")
	if got != want {
		t.Fatalf("StoreProdSkillsDir() = %q, want %q", got, want)
	}
}

func TestMCPProfileFileUsesSingleGlobalRoot(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	fs := NewFS(baseDir)

	got, err := fs.MCPProfileFile("customer-docs.json")
	if err != nil {
		t.Fatalf("MCPProfileFile() error = %v", err)
	}
	want := filepath.Join(baseDir, "mcp-profiles", "customer-docs.json")
	if got != want {
		t.Fatalf("MCPProfileFile() = %q, want %q", got, want)
	}
}

func TestMCPProfileFileRejectsTraversal(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	fs := NewFS(baseDir)

	if _, err := fs.MCPProfileFile("../agents/dev/lead_agent/config.yaml"); err == nil {
		t.Fatal("expected traversal error")
	}
}

func TestMigrateLegacyMCPProfileLayoutCopiesProfilesAndRewritesAgentRefs(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	baseDir := filepath.Join(projectDir, ".openagents")
	fs := NewFS(baseDir)
	legacyProfile := filepath.Join(baseDir, "custom", "mcp-profiles", "customer-docs.json")
	if err := os.MkdirAll(filepath.Dir(legacyProfile), 0o755); err != nil {
		t.Fatalf("mkdir legacy profile dir: %v", err)
	}
	if err := os.WriteFile(legacyProfile, []byte(`{"mcpServers":{"customer-docs":{"type":"http","url":"https://example.com/mcp"}}}`), 0o644); err != nil {
		t.Fatalf("write legacy profile: %v", err)
	}
	agentConfig := filepath.Join(baseDir, "custom", "agents", "prod", "support-agent", "config.yaml")
	if err := os.MkdirAll(filepath.Dir(agentConfig), 0o755); err != nil {
		t.Fatalf("mkdir agent config dir: %v", err)
	}
	if err := os.WriteFile(agentConfig, []byte("name: support-agent\nmcp_servers:\n  - custom/mcp-profiles/customer-docs.json\n"), 0o644); err != nil {
		t.Fatalf("write agent config: %v", err)
	}

	if err := fs.MigrateLegacyMCPProfileLayout(); err != nil {
		t.Fatalf("MigrateLegacyMCPProfileLayout() error = %v", err)
	}

	globalProfile := filepath.Join(baseDir, "mcp-profiles", "customer-docs.json")
	if _, err := os.Stat(globalProfile); err != nil {
		t.Fatalf("expected migrated profile at %s: %v", globalProfile, err)
	}
	configBytes, err := os.ReadFile(agentConfig)
	if err != nil {
		t.Fatalf("read migrated agent config: %v", err)
	}
	if strings.Contains(string(configBytes), "custom/mcp-profiles/") {
		t.Fatalf("agent config still contains legacy MCP ref: %s", configBytes)
	}
	if !strings.Contains(string(configBytes), "mcp-profiles/customer-docs.json") {
		t.Fatalf("agent config missing global MCP ref: %s", configBytes)
	}
}

func TestResolveBaseDirUsesProjectRootForRelativePaths(t *testing.T) {
	projectDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(projectDir, ".openagents", "skills"), 0755); err != nil {
		t.Fatalf("mkdir .openagents/skills: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectDir, "backend", "agents"), 0755); err != nil {
		t.Fatalf("mkdir backend/agents: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectDir, "backend", "gateway"), 0755); err != nil {
		t.Fatalf("mkdir backend/gateway: %v", err)
	}

	t.Chdir(filepath.Join(projectDir, "backend", "gateway"))

	got := ResolveBaseDir(".openagents")
	want := filepath.Join(projectDir, ".openagents")
	if got != want {
		t.Fatalf("ResolveBaseDir() = %q, want %q", got, want)
	}
}
