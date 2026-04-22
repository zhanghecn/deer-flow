package handler

import (
	"encoding/json"
	"testing"
)

func TestBuildAdminModelRecordNormalizesFields(t *testing.T) {
	t.Parallel()

	displayName := "  Kimi K2.5 #1  "
	record, err := buildAdminModelRecord(adminModelRequest{
		Name:        "  kimi-k2.5-1  ",
		DisplayName: &displayName,
		Provider:    "  anthropic  ",
		Enabled:     boolPtr(false),
		ConfigJSON: map[string]interface{}{
			"use":   "langchain_anthropic:ChatAnthropic",
			"model": "kimi-k2.5",
		},
	})
	if err != nil {
		t.Fatalf("buildAdminModelRecord returned error: %v", err)
	}

	if record.Name != "kimi-k2.5-1" {
		t.Fatalf("expected normalized name, got %q", record.Name)
	}
	if record.Provider != "anthropic" {
		t.Fatalf("expected normalized provider, got %q", record.Provider)
	}
	if record.DisplayName == nil || *record.DisplayName != "Kimi K2.5 #1" {
		t.Fatalf("expected normalized display name, got %#v", record.DisplayName)
	}
	if record.Enabled {
		t.Fatalf("expected disabled record")
	}

	var config map[string]any
	if err := json.Unmarshal(record.ConfigJSON, &config); err != nil {
		t.Fatalf("decode config json: %v", err)
	}
	if config["model"] != "kimi-k2.5" {
		t.Fatalf("expected model field to be preserved, got %#v", config["model"])
	}
}

func TestBuildAdminModelRecordRejectsMissingConfigFields(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Name:     "kimi-k2.5-1",
		Provider: "anthropic",
		ConfigJSON: map[string]interface{}{
			"use": "langchain_anthropic:ChatAnthropic",
		},
	})
	if err == nil || err.Error() != "config_json.model is required" {
		t.Fatalf("expected missing model error, got %v", err)
	}
}

func TestBuildAdminModelRecordRejectsRuntimeOnlyEffort(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Name:     "gpt-5-mini",
		Provider: "openai",
		ConfigJSON: map[string]interface{}{
			"use":               "langchain_openai:ChatOpenAI",
			"model":             "gpt-5-mini",
			"effort":            "high",
			"supports_thinking": true,
		},
	})
	if err == nil || err.Error() != "config_json.effort is runtime-only; remove it from the model profile" {
		t.Fatalf("expected runtime-only effort error, got %v", err)
	}
}

func TestBuildAdminModelRecordRejectsRetiredReasoningEffortKey(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Name:     "gpt-5-mini",
		Provider: "openai",
		ConfigJSON: map[string]interface{}{
			"use":               "langchain_openai:ChatOpenAI",
			"model":             "gpt-5-mini",
			"reasoning_effort":  "high",
			"supports_thinking": true,
		},
	})
	if err == nil || err.Error() != "config_json.reasoning_effort is retired; use per-run `effort` instead" {
		t.Fatalf("expected retired reasoning_effort error, got %v", err)
	}
}

func TestBuildAdminModelRecordRejectsRetiredSupportsReasoningEffortKey(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Name:     "gpt-5-mini",
		Provider: "openai",
		ConfigJSON: map[string]interface{}{
			"use":                       "langchain_openai:ChatOpenAI",
			"model":                     "gpt-5-mini",
			"supports_reasoning_effort": true,
			"supports_thinking":         true,
		},
	})
	if err == nil || err.Error() != "config_json.supports_reasoning_effort is retired; rename it to `supports_effort`" {
		t.Fatalf("expected retired supports_reasoning_effort error, got %v", err)
	}
}

func TestBuildAdminModelRecordInfersRuntimeClassAndNameFromKnownProvider(t *testing.T) {
	t.Parallel()

	record, err := buildAdminModelRecord(adminModelRequest{
		Provider: "  openai-compatible  ",
		ConfigJSON: map[string]interface{}{
			"model": "gpt-5-mini",
		},
	})
	if err != nil {
		t.Fatalf("buildAdminModelRecord returned error: %v", err)
	}

	if record.Name != "openai-compatible-gpt-5-mini" {
		t.Fatalf("expected generated name, got %q", record.Name)
	}
	if record.DisplayName == nil || *record.DisplayName != "gpt-5-mini" {
		t.Fatalf("expected generated display name, got %#v", record.DisplayName)
	}

	var config map[string]any
	if err := json.Unmarshal(record.ConfigJSON, &config); err != nil {
		t.Fatalf("decode config json: %v", err)
	}
	if config["use"] != "langchain_openai:ChatOpenAI" {
		t.Fatalf("expected inferred runtime class, got %#v", config["use"])
	}
}

func TestBuildAdminModelRecordInfersProviderFromKnownRuntimeClass(t *testing.T) {
	t.Parallel()

	record, err := buildAdminModelRecord(adminModelRequest{
		ConfigJSON: map[string]interface{}{
			"use":   "langchain_google_genai:ChatGoogleGenerativeAI",
			"model": "gemini-2.5-pro",
		},
	})
	if err != nil {
		t.Fatalf("buildAdminModelRecord returned error: %v", err)
	}

	if record.Provider != "google" {
		t.Fatalf("expected inferred provider, got %q", record.Provider)
	}
	if record.Name != "google-gemini-2-5-pro" {
		t.Fatalf("expected generated name, got %q", record.Name)
	}
}

func TestBuildAdminModelRecordRejectsUnknownProviderWithoutRuntimeClass(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Provider: "custom-provider",
		ConfigJSON: map[string]interface{}{
			"model": "custom-model",
		},
	})
	if err == nil || err.Error() != "config_json.use is required" {
		t.Fatalf("expected missing runtime class error, got %v", err)
	}
}

func boolPtr(value bool) *bool {
	return &value
}
