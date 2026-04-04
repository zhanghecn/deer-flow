package handler

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/pkg/storage"
)

func TestListFilesystemAgentsIncludesBuiltinLeadAgent(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	writeAgent := func(status string, name string) {
		agentDir := filepath.Join(baseDir, "custom", "agents", status, name)
		if name == "lead_agent" {
			agentDir = filepath.Join(baseDir, "system", "agents", status, name)
		}
		if err := os.MkdirAll(agentDir, 0755); err != nil {
			t.Fatalf("mkdir %s: %v", agentDir, err)
		}
		config := "name: " + name + "\nstatus: " + status + "\nagents_md_path: AGENTS.md\n"
		if err := os.WriteFile(filepath.Join(agentDir, "config.yaml"), []byte(config), 0644); err != nil {
			t.Fatalf("write config: %v", err)
		}
		if err := os.WriteFile(filepath.Join(agentDir, "AGENTS.md"), []byte("# "+name), 0644); err != nil {
			t.Fatalf("write AGENTS.md: %v", err)
		}
	}

	writeAgent("dev", "lead_agent")
	writeAgent("dev", "contract-review-agent")

	agents, err := agentfs.ListAgents(storage.NewFS(baseDir), "")
	if err != nil {
		t.Fatalf("agentfs.ListAgents() error = %v", err)
	}
	if len(agents) != 2 {
		t.Fatalf("len(agents) = %d, want 2", len(agents))
	}
	if agents[0].Name != "lead_agent" {
		t.Fatalf("agents[0].Name = %q, want %q", agents[0].Name, "lead_agent")
	}
	if agents[1].Name != "contract-review-agent" {
		t.Fatalf("agents[1].Name = %q, want %q", agents[1].Name, "contract-review-agent")
	}
}

func TestDeleteBuiltinLeadAgentIsRejected(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	fsStore := storage.NewFS(baseDir)

	err := agentfs.DeleteAgent(fsStore, "lead_agent", "")
	if err == nil {
		t.Fatal("expected deleting lead_agent to fail")
	}
}

func TestLoadFilesystemAgentPreservesMemoryConfig(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	agentDir := filepath.Join(baseDir, "custom", "agents", "dev", "memory-agent")
	if err := os.MkdirAll(agentDir, 0755); err != nil {
		t.Fatalf("mkdir %s: %v", agentDir, err)
	}

	config := `name: memory-agent
status: dev
agents_md_path: AGENTS.md
memory:
  enabled: false
  debounce_seconds: 45
  max_facts: 150
  fact_confidence_threshold: 0.9
  injection_enabled: true
  max_injection_tokens: 4096
`
	if err := os.WriteFile(filepath.Join(agentDir, "config.yaml"), []byte(config), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "AGENTS.md"), []byte("# memory-agent"), 0644); err != nil {
		t.Fatalf("write AGENTS.md: %v", err)
	}

	agent, err := agentfs.LoadAgent(storage.NewFS(baseDir), "memory-agent", "dev", false)
	if err != nil {
		t.Fatalf("agentfs.LoadAgent() error = %v", err)
	}
	if agent == nil || agent.Memory == nil {
		t.Fatal("expected agent memory config to be loaded")
	}
	if agent.Memory.DebounceSeconds != 45 {
		t.Fatalf("agent.Memory.DebounceSeconds = %d, want 45", agent.Memory.DebounceSeconds)
	}
	if agent.Memory.MaxFacts != 150 {
		t.Fatalf("agent.Memory.MaxFacts = %d, want 150", agent.Memory.MaxFacts)
	}
	if agent.Memory.FactConfidenceThreshold != 0.9 {
		t.Fatalf("agent.Memory.FactConfidenceThreshold = %v, want 0.9", agent.Memory.FactConfidenceThreshold)
	}
	if !agent.Memory.InjectionEnabled {
		t.Fatal("agent.Memory.InjectionEnabled = false, want true")
	}
	if agent.Memory.MaxInjectionTokens != 4096 {
		t.Fatalf("agent.Memory.MaxInjectionTokens = %d, want 4096", agent.Memory.MaxInjectionTokens)
	}
}

func TestListFilesystemSkillsPreservesAliasedSourcePath(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	skillDir := filepath.Join(baseDir, "skills", "store", "prod", "vercel-deploy-claimable")
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}

	skillMD := "---\nname: vercel-deploy\ndescription: aliased skill\n---\n\nbody"
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(skillMD), 0644); err != nil {
		t.Fatalf("write skill file: %v", err)
	}
	skillI18n := `{
  "version": 1,
  "default_locale": "en-US",
  "description": {
    "en-US": "Aliased skill",
    "zh-CN": "别名技能"
  }
}`
	if err := os.WriteFile(filepath.Join(skillDir, "skill.i18n.json"), []byte(skillI18n), 0644); err != nil {
		t.Fatalf("write skill i18n file: %v", err)
	}

	skills, err := listFilesystemSkills(
		storage.NewFS(baseDir),
		filepath.Join(baseDir, "extensions_config.json"),
		"",
	)
	if err != nil {
		t.Fatalf("listFilesystemSkills() error = %v", err)
	}
	if len(skills) != 1 {
		t.Fatalf("len(skills) = %d, want 1", len(skills))
	}
	if got := skills[0].Name; got != "vercel-deploy" {
		t.Fatalf("skills[0].Name = %q, want %q", got, "vercel-deploy")
	}
	if got := skills[0].Category; got != "store/prod" {
		t.Fatalf("skills[0].Category = %q, want %q", got, "store/prod")
	}
	if got := skills[0].SourcePath; got != "store/prod/vercel-deploy-claimable" {
		t.Fatalf("skills[0].SourcePath = %q, want %q", got, "store/prod/vercel-deploy-claimable")
	}
	if got := skills[0].DescriptionI18n["en-US"]; got != "Aliased skill" {
		t.Fatalf("skills[0].DescriptionI18n[en-US] = %q, want %q", got, "Aliased skill")
	}
	if got := skills[0].DescriptionI18n["zh-CN"]; got != "别名技能" {
		t.Fatalf("skills[0].DescriptionI18n[zh-CN] = %q, want %q", got, "别名技能")
	}
}

func TestListFilesystemSkillsIncludesCanonicalSystemAndCustomScopes(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	systemDir := filepath.Join(baseDir, "system", "skills", "bootstrap")
	customDir := filepath.Join(baseDir, "custom", "skills", "contract-review")
	prodDir := filepath.Join(baseDir, "skills", "store", "prod", "vercel-deploy")
	for _, dir := range []string{systemDir, customDir, prodDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	if err := os.WriteFile(filepath.Join(systemDir, "SKILL.md"), []byte("---\nname: bootstrap\ndescription: system skill\n---\n"), 0o644); err != nil {
		t.Fatalf("write system skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(customDir, "SKILL.md"), []byte("---\nname: contract-review\ndescription: custom skill\n---\n"), 0o644); err != nil {
		t.Fatalf("write custom skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(prodDir, "SKILL.md"), []byte("---\nname: vercel-deploy\ndescription: prod skill\n---\n"), 0o644); err != nil {
		t.Fatalf("write prod skill: %v", err)
	}

	skills, err := listFilesystemSkills(
		storage.NewFS(baseDir),
		filepath.Join(baseDir, "extensions_config.json"),
		"prod",
	)
	if err != nil {
		t.Fatalf("listFilesystemSkills() error = %v", err)
	}

	got := make(map[string]string, len(skills))
	gotSourcePaths := make(map[string]string, len(skills))
	for _, skill := range skills {
		got[skill.Name] = skill.Category
		gotSourcePaths[skill.Name] = skill.SourcePath
	}
	if got["bootstrap"] != "system" {
		t.Fatalf("bootstrap category = %q, want system", got["bootstrap"])
	}
	if gotSourcePaths["bootstrap"] != "system/skills/bootstrap" {
		t.Fatalf("bootstrap source_path = %q, want system/skills/bootstrap", gotSourcePaths["bootstrap"])
	}
	if got["contract-review"] != "custom" {
		t.Fatalf("contract-review category = %q, want custom", got["contract-review"])
	}
	if gotSourcePaths["contract-review"] != "custom/skills/contract-review" {
		t.Fatalf("contract-review source_path = %q, want custom/skills/contract-review", gotSourcePaths["contract-review"])
	}
	if got["vercel-deploy"] != "store/prod" {
		t.Fatalf("vercel-deploy category = %q, want store/prod", got["vercel-deploy"])
	}
	if gotSourcePaths["vercel-deploy"] != "store/prod/vercel-deploy" {
		t.Fatalf("vercel-deploy source_path = %q, want store/prod/vercel-deploy", gotSourcePaths["vercel-deploy"])
	}
}
