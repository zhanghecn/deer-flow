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
