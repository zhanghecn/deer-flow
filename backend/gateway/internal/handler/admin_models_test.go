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

func boolPtr(value bool) *bool {
	return &value
}
