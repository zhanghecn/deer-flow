package agentfs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

func TestPublishAgentRejectsDevScopedSkills(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	fsStore := storage.NewFS(baseDir)
	if err := os.MkdirAll(filepath.Join(baseDir, "custom", "agents", "dev", "analyst", "skills", "research"), 0o755); err != nil {
		t.Fatalf("mkdir agent skills: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(baseDir, "custom", "agents", "dev", "analyst", "skills", "research", "SKILL.md"),
		[]byte("---\nname: research\ndescription: dev research\n---\n"),
		0o644,
	); err != nil {
		t.Fatalf("write copied skill: %v", err)
	}

	if err := fsStore.WriteAgentFiles("analyst", "dev", "# Analyst", map[string]interface{}{
		"name":           "analyst",
		"description":    "Research analyst",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
		"skill_refs": []model.SkillRef{
			{
				Name:             "research",
				Category:         "store/dev",
				SourcePath:       "store/dev/research",
				MaterializedPath: "skills/research",
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
		t.Fatalf("write dev agent: %v", err)
	}

	_, err := PublishAgent(fsStore, "analyst")
	if err == nil {
		t.Fatal("expected publish to reject store/dev skill refs")
	}
	if !strings.Contains(err.Error(), "store/prod skills") {
		t.Fatalf("PublishAgent() error = %v, want prod-skill validation", err)
	}
}

func TestPublishAgentAllowsAgentOwnedPrivateSkills(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	fsStore := storage.NewFS(baseDir)
	if err := os.MkdirAll(filepath.Join(baseDir, "custom", "agents", "dev", "analyst", "skills", "research"), 0o755); err != nil {
		t.Fatalf("mkdir private skill dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(baseDir, "custom", "agents", "dev", "analyst", "skills", "research", "SKILL.md"),
		[]byte("---\nname: research\ndescription: private research\n---\n"),
		0o644,
	); err != nil {
		t.Fatalf("write private skill: %v", err)
	}

	if err := fsStore.WriteAgentFiles("analyst", "dev", "# Analyst", map[string]interface{}{
		"name":           "analyst",
		"description":    "Research analyst",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
		"skill_refs": []model.SkillRef{
			{
				Name:             "research",
				MaterializedPath: "skills/research",
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
		t.Fatalf("write dev agent: %v", err)
	}

	agent, err := PublishAgent(fsStore, "analyst")
	if err != nil {
		t.Fatalf("PublishAgent() error = %v", err)
	}

	if agent.Status != "prod" {
		t.Fatalf("agent.Status = %q, want %q", agent.Status, "prod")
	}
	if _, err := os.Stat(filepath.Join(baseDir, "custom", "agents", "prod", "analyst", "skills", "research", "SKILL.md")); err != nil {
		t.Fatalf("expected private skill in prod archive: %v", err)
	}
}

func TestLoadAgentDerivesSkillRefMetadataFromSourcePath(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	fsStore := storage.NewFS(baseDir)
	if err := fsStore.WriteAgentFiles("contract-reviewer", "dev", "# Contract Reviewer", map[string]interface{}{
		"name":           "contract-reviewer",
		"description":    "Contract reviewer",
		"status":         "dev",
		"agents_md_path": "AGENTS.md",
		"skill_refs": []map[string]string{
			{
				"name":        "china-lawyer-analyst",
				"source_path": "system/skills/china-lawyer-analyst",
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
		t.Fatalf("write agent files: %v", err)
	}

	agent, err := LoadAgent(fsStore, "contract-reviewer", "dev", false)
	if err != nil {
		t.Fatalf("LoadAgent() error = %v", err)
	}
	if agent == nil || len(agent.Skills) != 1 {
		t.Fatalf("agent.Skills = %#v, want 1 derived skill ref", agent)
	}
	if got := agent.Skills[0].Category; got != "system" {
		t.Fatalf("agent.Skills[0].Category = %q, want system", got)
	}
	if got := agent.Skills[0].MaterializedPath; got != "skills/china-lawyer-analyst" {
		t.Fatalf("agent.Skills[0].MaterializedPath = %q, want skills/china-lawyer-analyst", got)
	}
}
