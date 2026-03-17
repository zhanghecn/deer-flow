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
	if err := os.MkdirAll(filepath.Join(baseDir, "skills", "shared", "bootstrap"), 0755); err != nil {
		t.Fatalf("mkdir skill dir: %v", err)
	}
	skillMD := "---\nname: bootstrap\ndescription: shared bootstrap\n---\n\nbody"
	if err := os.WriteFile(filepath.Join(baseDir, "skills", "shared", "bootstrap", "SKILL.md"), []byte(skillMD), 0644); err != nil {
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
	if agent.Skills[0].Category != "shared" {
		t.Fatalf("agent.Skills[0].Category = %q, want %q", agent.Skills[0].Category, "shared")
	}

	copiedSkill := filepath.Join(baseDir, "agents", "dev", "contract-review", "skills", "bootstrap", "SKILL.md")
	if _, err := os.Stat(copiedSkill); err != nil {
		t.Fatalf("expected copied skill at %s: %v", copiedSkill, err)
	}
}

func TestAgentServiceCreateRejectsAmbiguousSkillNames(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	for _, scope := range []string{"shared", filepath.Join("store", "dev")} {
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
		t.Fatal("expected ambiguous skill error")
	}
	if !strings.Contains(err.Error(), "ambiguous") {
		t.Fatalf("Create() error = %v, want ambiguous error", err)
	}
}

func TestAgentServiceUpdatePreservesAliasedSkillSourcePath(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	skillDir := filepath.Join(baseDir, "skills", "shared", "vercel-deploy-claimable")
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
				Category:   "shared",
				SourcePath: "shared/vercel-deploy-claimable",
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
	if got := agent.Skills[0].Category; got != "shared" {
		t.Fatalf("agent.Skills[0].Category = %q, want %q", got, "shared")
	}
	if got := agent.Skills[0].SourcePath; got != "shared/vercel-deploy-claimable" {
		t.Fatalf("agent.Skills[0].SourcePath = %q, want %q", got, "shared/vercel-deploy-claimable")
	}

	copiedSkill := filepath.Join(baseDir, "agents", "prod", "lead_agent", "skills", "vercel-deploy", "SKILL.md")
	if _, err := os.Stat(copiedSkill); err != nil {
		t.Fatalf("expected copied aliased skill at %s: %v", copiedSkill, err)
	}
}

func TestAgentServiceUpdateAcceptsScopedSkillRefs(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	for _, scope := range []string{"shared", filepath.Join("store", "dev")} {
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
