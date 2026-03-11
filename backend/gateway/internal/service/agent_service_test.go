package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

func TestCollectSkillNamesPreservesOrder(t *testing.T) {
	t.Parallel()

	skills := []struct {
		name string
	}{
		{name: "analysis"},
		{name: "research"},
	}
	got := collectSkillNames([]model.Skill{
		{Name: skills[0].name},
		{Name: skills[1].name},
	})
	want := []string{"analysis", "research"}
	if len(got) != len(want) {
		t.Fatalf("collectSkillNames() len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("collectSkillNames()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestNormalizeAgentMemoryConfigRequiresModelWhenEnabled(t *testing.T) {
	t.Parallel()

	_, err := normalizeAgentMemoryConfig(&model.AgentMemoryConfig{Enabled: true})
	if err == nil {
		t.Fatal("expected error for enabled memory without model_name")
	}
}

func TestParseAgentMemoryConfigReadsPersistedPolicy(t *testing.T) {
	t.Parallel()

	modelName := "memory-model"
	raw, err := json.Marshal(map[string]any{
		"memory": map[string]any{
			"enabled":                   true,
			"model_name":                modelName,
			"debounce_seconds":          45,
			"max_facts":                 50,
			"fact_confidence_threshold": 0.8,
			"injection_enabled":         true,
			"max_injection_tokens":      1500,
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	got, err := parseAgentMemoryConfig(raw)
	if err != nil {
		t.Fatalf("parseAgentMemoryConfig() error = %v", err)
	}
	if !got.Enabled {
		t.Fatal("expected enabled memory config")
	}
	if got.ModelName == nil || *got.ModelName != modelName {
		t.Fatalf("ModelName = %v, want %q", got.ModelName, modelName)
	}
	if got.MaxFacts != 50 {
		t.Fatalf("MaxFacts = %d, want 50", got.MaxFacts)
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
