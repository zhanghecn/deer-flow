package service

import (
	"encoding/json"
	"testing"

	"github.com/openagents/gateway/internal/model"
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
