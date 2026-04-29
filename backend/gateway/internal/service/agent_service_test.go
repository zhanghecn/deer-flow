package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

func TestNormalizeAgentMemoryConfigRequiresModelWhenEnabled(t *testing.T) {
	t.Parallel()

	_, err := normalizeAgentMemoryConfig(&model.AgentMemoryConfig{Enabled: true})
	if err == nil {
		t.Fatal("expected error for enabled memory without model_name")
	}
}

func TestAgentServiceCreateCopiesResolvedSkillIntoAgentDir(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	if err := os.MkdirAll(filepath.Join(baseDir, "skills", "store", "dev", "bootstrap"), 0755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	skillMD := "---\nname: bootstrap\ndescription: dev bootstrap\n---\n\nbody"
	if err := os.WriteFile(filepath.Join(baseDir, "skills", "store", "dev", "bootstrap", "SKILL.md"), []byte(skillMD), 0644); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	svc := NewAgentService(storage.NewFS(baseDir))
	agent, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:     "contract-review",
		Skills:   []string{"bootstrap"},
		AgentsMD: "# Agent",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if len(agent.Skills) != 1 {
		t.Fatalf("len(agent.Skills) = %d, want 1", len(agent.Skills))
	}
	if agent.Skills[0].Category != "store/dev" {
		t.Fatalf("agent.Skills[0].Category = %q, want %q", agent.Skills[0].Category, "store/dev")
	}

	copiedSkill := filepath.Join(baseDir, "custom", "agents", "dev", "contract-review", "skills", "bootstrap", "SKILL.md")
	if _, err := os.Stat(copiedSkill); err != nil {
		t.Fatalf("expected copied skill at %s: %v", copiedSkill, err)
	}
}

func TestAgentServiceCreateAcceptsCanonicalMCPProfileRefs(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	profileFile := filepath.Join(baseDir, "mcp-profiles", "customer-docs.json")
	if err := os.MkdirAll(filepath.Dir(profileFile), 0o755); err != nil {
		t.Fatalf("mkdir profile dir: %v", err)
	}
	if err := os.WriteFile(profileFile, []byte(`{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}`), 0o644); err != nil {
		t.Fatalf("write profile file: %v", err)
	}

	svc := NewAgentService(storage.NewFS(baseDir))
	agent, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:       "support-agent",
		McpServers: []string{"mcp-profiles/customer-docs.json"},
		AgentsMD:   "# Agent",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(agent.McpServers) != 1 || agent.McpServers[0] != "mcp-profiles/customer-docs.json" {
		t.Fatalf("agent.McpServers = %#v, want canonical profile ref", agent.McpServers)
	}
}

func TestAgentServiceCreateRejectsMissingCanonicalMCPProfileRefs(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewAgentService(storage.NewFS(baseDir))
	_, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:       "support-agent",
		McpServers: []string{"mcp-profiles/missing.json"},
		AgentsMD:   "# Agent",
	}, uuid.Nil)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("Create() error = %v, want missing MCP profile failure", err)
	}
}

func TestAgentServiceCreateNormalizesBareMCPProfileNames(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	profileFile := filepath.Join(baseDir, "mcp-profiles", "customer-docs.json")
	if err := os.MkdirAll(filepath.Dir(profileFile), 0o755); err != nil {
		t.Fatalf("mkdir profile dir: %v", err)
	}
	if err := os.WriteFile(profileFile, []byte(`{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}`), 0o644); err != nil {
		t.Fatalf("write profile file: %v", err)
	}

	svc := NewAgentService(storage.NewFS(baseDir))
	agent, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:       "support-agent",
		McpServers: []string{"customer-docs.json"},
		AgentsMD:   "# Agent",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(agent.McpServers) != 1 || agent.McpServers[0] != "mcp-profiles/customer-docs.json" {
		t.Fatalf("agent.McpServers = %#v, want canonical profile ref", agent.McpServers)
	}
}

func TestAgentServiceCreateRejectsMissingBareJSONMCPProfileNames(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewAgentService(storage.NewFS(baseDir))
	_, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:       "support-agent",
		McpServers: []string{"missing.json"},
		AgentsMD:   "# Agent",
	}, uuid.Nil)
	if err == nil || !strings.Contains(err.Error(), `mcp profile "missing.json" not found`) {
		t.Fatalf("Create() error = %v, want missing bare MCP profile failure", err)
	}
}

func TestAgentServiceCreateAllowsMCPToolNamesWhenProfileBound(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	profileFile := filepath.Join(baseDir, "mcp-profiles", "customer-docs.json")
	if err := os.MkdirAll(filepath.Dir(profileFile), 0o755); err != nil {
		t.Fatalf("mkdir profile dir: %v", err)
	}
	profileJSON := `{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}`
	if err := os.WriteFile(profileFile, []byte(profileJSON), 0o644); err != nil {
		t.Fatalf("write profile file: %v", err)
	}

	svc := NewAgentService(storage.NewFS(baseDir))
	agent, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:       "support-agent",
		McpServers: []string{"mcp-profiles/customer-docs.json"},
		ToolNames:  []string{"document_list", "present_files"},
		SubagentDefaults: &model.AgentSubagentDefaults{
			GeneralPurposeEnabled: true,
			ToolNames:             []string{"document_read"},
		},
		Subagents: []model.AgentSubagent{
			{
				Name:         "researcher",
				Description:  "Search the customer MCP profile.",
				SystemPrompt: "Use customer evidence.",
				ToolNames:    []string{"document_search"},
				Enabled:      true,
			},
		},
		AgentsMD: "# Agent",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if got := agent.ToolNames; len(got) != 2 || got[0] != "document_list" || got[1] != "present_files" {
		t.Fatalf("agent.ToolNames = %#v, want MCP tool plus builtin", got)
	}
	if agent.SubagentDefaults == nil || len(agent.SubagentDefaults.ToolNames) != 1 || agent.SubagentDefaults.ToolNames[0] != "document_read" {
		t.Fatalf("agent.SubagentDefaults = %#v, want MCP default tool", agent.SubagentDefaults)
	}
	if len(agent.Subagents) != 1 || len(agent.Subagents[0].ToolNames) != 1 || agent.Subagents[0].ToolNames[0] != "document_search" {
		t.Fatalf("agent.Subagents = %#v, want MCP subagent tool", agent.Subagents)
	}
}

func TestAgentServiceCreateRejectsUnknownToolWithoutMCPBinding(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewAgentService(storage.NewFS(baseDir))
	_, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:      "support-agent",
		ToolNames: []string{"document_list"},
		AgentsMD:  "# Agent",
	}, uuid.Nil)
	if err == nil || !strings.Contains(err.Error(), `unknown tool "document_list"`) {
		t.Fatalf("Create() error = %v, want unknown tool rejection", err)
	}
}

func TestAgentServiceRejectsMiddlewareToolAsArchiveToolName(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewAgentService(storage.NewFS(baseDir))
	_, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:      "support-agent",
		ToolNames: []string{"read_file"},
		AgentsMD:  "# Agent",
	}, uuid.Nil)
	if err == nil || !strings.Contains(err.Error(), `tool "read_file" is not configurable`) {
		t.Fatalf("Create() error = %v, want middleware tool rejection", err)
	}
}

func TestAgentServiceUpdateAllowsMCPToolNamesFromExistingBinding(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	profileFile := filepath.Join(baseDir, "mcp-profiles", "customer-docs.json")
	if err := os.MkdirAll(filepath.Dir(profileFile), 0o755); err != nil {
		t.Fatalf("mkdir profile dir: %v", err)
	}
	profileJSON := `{"mcpServers":{"customer-docs":{"type":"http","url":"https://customer.example.com/mcp"}}}`
	if err := os.WriteFile(profileFile, []byte(profileJSON), 0o644); err != nil {
		t.Fatalf("write profile file: %v", err)
	}

	fsStore := storage.NewFS(baseDir)
	if err := fsStore.WriteAgentFiles("support-agent", "dev", "# Agent", map[string]interface{}{
		"name":           "support-agent",
		"description":    "Support agent",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
		"mcp_servers":    []string{"mcp-profiles/customer-docs.json"},
		"memory": map[string]interface{}{
			"enabled":                   false,
			"debounce_seconds":          30,
			"max_facts":                 100,
			"fact_confidence_threshold": 0.7,
			"injection_enabled":         true,
			"max_injection_tokens":      2000,
		},
	}); err != nil {
		t.Fatalf("seed agent files: %v", err)
	}

	svc := NewAgentService(fsStore)
	agent, err := svc.Update(context.Background(), "support-agent", "dev", model.UpdateAgentRequest{
		ToolNames: []string{"document_list", "document_read", "present_files"},
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if got := strings.Join(agent.ToolNames, ","); got != "document_list,document_read,present_files" {
		t.Fatalf("agent.ToolNames = %#v, want MCP tools preserved", agent.ToolNames)
	}
}

func TestAgentServiceCreatePersistsOwnerUserID(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewAgentService(storage.NewFS(baseDir))
	ownerUserID := uuid.New()

	agent, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:     "owned-agent",
		AgentsMD: "# Agent",
	}, ownerUserID)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if agent.OwnerUserID != ownerUserID.String() {
		t.Fatalf("agent.OwnerUserID = %q, want %q", agent.OwnerUserID, ownerUserID.String())
	}

	configBytes, err := os.ReadFile(filepath.Join(baseDir, "custom", "agents", "dev", "owned-agent", "config.yaml"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if !strings.Contains(string(configBytes), "owner_user_id: "+ownerUserID.String()) {
		t.Fatalf("config.yaml missing owner_user_id: %s", string(configBytes))
	}
}

func TestAgentServiceCreateRejectsAmbiguousSkillNames(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	for _, scope := range []string{filepath.Join("store", "dev"), filepath.Join("store", "prod")} {
		skillDir := filepath.Join(baseDir, "skills", scope, "research")
		if err := os.MkdirAll(skillDir, 0755); err != nil {
			t.Fatalf("mkdir skill dir: %v", err)
		}
		skillMD := "---\nname: research\ndescription: duplicated skill\n---\n\nbody"
		if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(skillMD), 0644); err != nil {
			t.Fatalf("write skill file: %v", err)
		}
	}

	svc := NewAgentService(storage.NewFS(baseDir))
	_, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:     "analyst",
		Skills:   []string{"research"},
		AgentsMD: "# Agent",
	}, uuid.Nil)
	if err == nil {
		t.Fatal("expected duplicate-name skill error")
	}
	if !strings.Contains(err.Error(), "explicit source_path") {
		t.Fatalf("Create() error = %v, want duplicate-name rejection", err)
	}
}

func TestAgentServiceUpdatePreservesAliasedSkillSourcePath(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	skillDir := filepath.Join(baseDir, "skills", "store", "prod", "vercel-deploy-claimable")
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		t.Fatalf("mkdir aliased skill dir: %v", err)
	}
	skillMD := "---\nname: vercel-deploy\ndescription: aliased skill\n---\n\nbody"
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(skillMD), 0644); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	fsStore := storage.NewFS(baseDir)
	if err := fsStore.WriteAgentFiles("lead_agent", "prod", "# Lead Agent", map[string]interface{}{
		"name":           "lead_agent",
		"description":    "Default system lead agent.",
		"status":         "prod",
		"agents_md_path": "AGENTS.md",
		"skill_refs": []model.SkillRef{
			{
				Name:       "vercel-deploy",
				Category:   "store/prod",
				SourcePath: "store/prod/vercel-deploy-claimable",
			},
		},
		"memory": map[string]interface{}{
			"enabled":                   false,
			"debounce_seconds":          30,
			"max_facts":                 100,
			"fact_confidence_threshold": 0.7,
			"injection_enabled":         true,
			"max_injection_tokens":      2000,
		},
	}); err != nil {
		t.Fatalf("seed lead agent files: %v", err)
	}

	svc := NewAgentService(fsStore)
	description := "Updated lead agent"
	agent, err := svc.Update(context.Background(), "lead_agent", "prod", model.UpdateAgentRequest{
		Description: &description,
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	if len(agent.Skills) != 1 {
		t.Fatalf("len(agent.Skills) = %d, want 1", len(agent.Skills))
	}
	if got := agent.Skills[0].Category; got != "store/prod" {
		t.Fatalf("agent.Skills[0].Category = %q, want %q", got, "store/prod")
	}
	if got := agent.Skills[0].SourcePath; got != "store/prod/vercel-deploy-claimable" {
		t.Fatalf("agent.Skills[0].SourcePath = %q, want %q", got, "store/prod/vercel-deploy-claimable")
	}
	if got := agent.Skills[0].MaterializedPath; got != "skills/vercel-deploy-claimable" {
		t.Fatalf("agent.Skills[0].MaterializedPath = %q, want %q", got, "skills/vercel-deploy-claimable")
	}

	copiedSkill := filepath.Join(baseDir, "system", "agents", "prod", "lead_agent", "skills", "vercel-deploy-claimable", "SKILL.md")
	if _, err := os.Stat(copiedSkill); err != nil {
		t.Fatalf("expected copied aliased skill at %s: %v", copiedSkill, err)
	}
}

func TestAgentServiceUpdateAcceptsScopedSkillRefs(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	for _, scope := range []string{filepath.Join("store", "prod"), filepath.Join("store", "dev")} {
		skillDir := filepath.Join(baseDir, "skills", scope, "research")
		if err := os.MkdirAll(skillDir, 0755); err != nil {
			t.Fatalf("mkdir skill dir: %v", err)
		}
		skillMD := "---\nname: research\ndescription: duplicated skill\n---\n\nbody"
		if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(skillMD), 0644); err != nil {
			t.Fatalf("write skill file: %v", err)
		}
	}

	fsStore := storage.NewFS(baseDir)
	if err := fsStore.WriteAgentFiles("lead_agent", "dev", "# Lead Agent", map[string]interface{}{
		"name":           "lead_agent",
		"description":    "Default system lead agent.",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
		"skill_refs":     []model.SkillRef{},
		"memory": map[string]interface{}{
			"enabled":                   false,
			"debounce_seconds":          30,
			"max_facts":                 100,
			"fact_confidence_threshold": 0.7,
			"injection_enabled":         true,
			"max_injection_tokens":      2000,
		},
	}); err != nil {
		t.Fatalf("seed lead agent files: %v", err)
	}

	svc := NewAgentService(fsStore)
	agent, err := svc.Update(context.Background(), "lead_agent", "dev", model.UpdateAgentRequest{
		SkillRefs: []model.SkillRef{
			{
				Name:       "research",
				Category:   "store/dev",
				SourcePath: "store/dev/research",
			},
		},
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	if len(agent.Skills) != 1 {
		t.Fatalf("len(agent.Skills) = %d, want 1", len(agent.Skills))
	}
	if got := agent.Skills[0].SourcePath; got != "store/dev/research" {
		t.Fatalf("agent.Skills[0].SourcePath = %q, want %q", got, "store/dev/research")
	}
}

func TestAgentServiceCreatePersistsToolNamesAndSubagents(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewAgentService(storage.NewFS(baseDir))

	agent, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name:      "research-agent",
		ToolNames: []string{"present_files", "question"},
		SubagentDefaults: &model.AgentSubagentDefaults{
			GeneralPurposeEnabled: true,
			ToolNames:             []string{"present_files"},
		},
		Subagents: []model.AgentSubagent{
			{
				Name:         "reviewer",
				Description:  "Review drafts",
				SystemPrompt: "Review carefully.",
				ToolNames:    []string{"present_files"},
				Enabled:      true,
			},
		},
		AgentsMD: "# Agent",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if got := agent.ToolNames; len(got) != 2 || got[0] != "present_files" || got[1] != "question" {
		t.Fatalf("agent.ToolNames = %#v, want explicit main tool_names", got)
	}
	if agent.SubagentDefaults == nil || !agent.SubagentDefaults.GeneralPurposeEnabled {
		t.Fatalf("agent.SubagentDefaults = %#v, want enabled defaults", agent.SubagentDefaults)
	}
	if len(agent.Subagents) != 1 || agent.Subagents[0].Name != "reviewer" {
		t.Fatalf("agent.Subagents = %#v, want persisted custom subagent", agent.Subagents)
	}

	configBytes, err := os.ReadFile(filepath.Join(baseDir, "custom", "agents", "dev", "research-agent", "config.yaml"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if !strings.Contains(string(configBytes), "tool_names:") {
		t.Fatalf("config.yaml missing tool_names: %s", string(configBytes))
	}

	subagentsBytes, err := os.ReadFile(filepath.Join(baseDir, "custom", "agents", "dev", "research-agent", "subagents.yaml"))
	if err != nil {
		t.Fatalf("read subagents: %v", err)
	}
	if !strings.Contains(string(subagentsBytes), "reviewer:") {
		t.Fatalf("subagents.yaml missing reviewer entry: %s", string(subagentsBytes))
	}
}

func TestAgentServicePersistsRuntimeMiddlewares(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewAgentService(storage.NewFS(baseDir))

	agent, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name: "research-agent",
		RuntimeMiddlewares: &model.AgentRuntimeMiddlewares{
			Disabled: []string{"filesystem"},
		},
		AgentsMD: "# Agent",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if agent.RuntimeMiddlewares == nil || agent.RuntimeMiddlewares.MiddlewareEnabled("filesystem") {
		t.Fatalf("agent.RuntimeMiddlewares = %#v, want filesystem disabled", agent.RuntimeMiddlewares)
	}

	configPath := filepath.Join(baseDir, "custom", "agents", "dev", "research-agent", "config.yaml")
	configBytes, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if !strings.Contains(string(configBytes), "runtime_middlewares:") ||
		!strings.Contains(string(configBytes), "disabled:") ||
		!strings.Contains(string(configBytes), "- filesystem") {
		t.Fatalf("config.yaml missing disabled runtime middleware: %s", string(configBytes))
	}

	description := "Updated without touching middleware"
	updated, err := svc.Update(context.Background(), "research-agent", "dev", model.UpdateAgentRequest{
		Description: &description,
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.RuntimeMiddlewares == nil || updated.RuntimeMiddlewares.MiddlewareEnabled("filesystem") {
		t.Fatalf("updated.RuntimeMiddlewares = %#v, want disabled middleware preserved", updated.RuntimeMiddlewares)
	}

	enabled, err := svc.Update(context.Background(), "research-agent", "dev", model.UpdateAgentRequest{
		RuntimeMiddlewares: &model.AgentRuntimeMiddlewares{
			Disabled: []string{},
		},
	})
	if err != nil {
		t.Fatalf("Update(enable) error = %v", err)
	}
	if enabled.RuntimeMiddlewares == nil || !enabled.RuntimeMiddlewares.MiddlewareEnabled("filesystem") {
		t.Fatalf("enabled.RuntimeMiddlewares = %#v, want filesystem enabled", enabled.RuntimeMiddlewares)
	}
}

func TestAgentServiceRejectsMainAgentOnlyToolForSubagent(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	svc := NewAgentService(storage.NewFS(baseDir))

	_, err := svc.Create(context.Background(), model.CreateAgentRequest{
		Name: "research-agent",
		Subagents: []model.AgentSubagent{
			{
				Name:         "reviewer",
				Description:  "Review drafts",
				SystemPrompt: "Review carefully.",
				ToolNames:    []string{"question"},
				Enabled:      true,
			},
		},
		AgentsMD: "# Agent",
	}, uuid.Nil)
	if err == nil {
		t.Fatal("expected subagent tool validation error")
	}
	if !strings.Contains(err.Error(), "not allowed for subagents") {
		t.Fatalf("Create() error = %v, want subagent tool rejection", err)
	}
}

func TestAgentServiceUpdateDerivesSkillMetadataFromSourcePath(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	skillDir := filepath.Join(baseDir, "skills", "store", "prod", "vercel-deploy-claimable")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("mkdir aliased skill dir: %v", err)
	}
	skillMD := "---\nname: vercel-deploy\ndescription: aliased skill\n---\n\nbody"
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(skillMD), 0o644); err != nil {
		t.Fatalf("write skill file: %v", err)
	}

	fsStore := storage.NewFS(baseDir)
	if err := fsStore.WriteAgentFiles("lead_agent", "dev", "# Lead Agent", map[string]interface{}{
		"name":           "lead_agent",
		"description":    "Default system lead agent.",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
		"skill_refs":     []model.SkillRef{},
		"memory": map[string]interface{}{
			"enabled":                   false,
			"debounce_seconds":          30,
			"max_facts":                 100,
			"fact_confidence_threshold": 0.7,
			"injection_enabled":         true,
			"max_injection_tokens":      2000,
		},
	}); err != nil {
		t.Fatalf("seed lead agent files: %v", err)
	}

	svc := NewAgentService(fsStore)
	agent, err := svc.Update(context.Background(), "lead_agent", "dev", model.UpdateAgentRequest{
		SkillRefs: []model.SkillRef{
			{
				Name:             "vercel-deploy",
				Category:         "store/prod",
				SourcePath:       "store/prod/vercel-deploy-claimable",
				MaterializedPath: "skills/vercel-deploy",
			},
		},
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	if len(agent.Skills) != 1 {
		t.Fatalf("len(agent.Skills) = %d, want 1", len(agent.Skills))
	}
	if got := agent.Skills[0].Category; got != "store/prod" {
		t.Fatalf("agent.Skills[0].Category = %q, want %q", got, "store/prod")
	}
	if got := agent.Skills[0].SourcePath; got != "store/prod/vercel-deploy-claimable" {
		t.Fatalf("agent.Skills[0].SourcePath = %q, want %q", got, "store/prod/vercel-deploy-claimable")
	}
	if got := agent.Skills[0].MaterializedPath; got != "skills/vercel-deploy-claimable" {
		t.Fatalf("agent.Skills[0].MaterializedPath = %q, want %q", got, "skills/vercel-deploy-claimable")
	}
}

func TestAgentServiceUpdatePreservesAgentOwnedSkillRefs(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	agentSkillsDir := filepath.Join(baseDir, "custom", "agents", "dev", "contract-agent", "skills", "contract-review")
	if err := os.MkdirAll(agentSkillsDir, 0755); err != nil {
		t.Fatalf("mkdir private skill dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentSkillsDir, "SKILL.md"), []byte("---\nname: contract-review\ndescription: private\n---\n"), 0644); err != nil {
		t.Fatalf("write private skill file: %v", err)
	}

	fsStore := storage.NewFS(baseDir)
	if err := fsStore.WriteAgentFiles("contract-agent", "dev", "# Contract Agent", map[string]interface{}{
		"name":           "contract-agent",
		"description":    "Private skill agent",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
		"skill_refs": []model.SkillRef{
			{
				Name:             "contract-review",
				MaterializedPath: "skills/contract-review",
			},
		},
		"memory": map[string]interface{}{
			"enabled":                   false,
			"debounce_seconds":          30,
			"max_facts":                 100,
			"fact_confidence_threshold": 0.7,
			"injection_enabled":         true,
			"max_injection_tokens":      2000,
		},
	}); err != nil {
		t.Fatalf("seed agent files: %v", err)
	}

	svc := NewAgentService(fsStore)
	description := "Updated private skill agent"
	agent, err := svc.Update(context.Background(), "contract-agent", "dev", model.UpdateAgentRequest{
		Description: &description,
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	if len(agent.Skills) != 1 {
		t.Fatalf("len(agent.Skills) = %d, want 1", len(agent.Skills))
	}
	if got := agent.Skills[0].MaterializedPath; got != "skills/contract-review" {
		t.Fatalf("agent.Skills[0].MaterializedPath = %q, want %q", got, "skills/contract-review")
	}
	if _, err := os.Stat(filepath.Join(agentSkillsDir, "SKILL.md")); err != nil {
		t.Fatalf("expected private skill to survive update: %v", err)
	}
}
