package model

import (
	"encoding/json"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestAgentJSONIncludesExplicitEmptyToolNames(t *testing.T) {
	t.Parallel()

	payload, err := json.Marshal(Agent{
		Name:        "support-agent",
		Description: "Support agent",
		ToolNames:   []string{},
		McpServers:  []string{"mcp-profiles/customer-docs.json"},
		Status:      "dev",
		AgentsMD:    "# Agent",
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	serialized := string(payload)
	if !strings.Contains(serialized, `"tool_names":[]`) {
		t.Fatalf("serialized agent missing explicit empty tool_names: %s", serialized)
	}
}

func TestAgentRuntimeMiddlewaresDefaultFilesystemWhenFieldMissing(t *testing.T) {
	t.Parallel()

	for name, decode := range map[string]func(*AgentRuntimeMiddlewares) error{
		"json": func(cfg *AgentRuntimeMiddlewares) error {
			return json.Unmarshal([]byte(`{}`), cfg)
		},
		"yaml": func(cfg *AgentRuntimeMiddlewares) error {
			return yaml.Unmarshal([]byte(`{}`), cfg)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var cfg AgentRuntimeMiddlewares
			if err := decode(&cfg); err != nil {
				t.Fatalf("decode runtime_middlewares: %v", err)
			}
			if !cfg.Filesystem {
				t.Fatalf("Filesystem = false, want default true for missing field")
			}
		})
	}
}

func TestAgentRuntimeMiddlewaresPreservesExplicitFilesystemFalse(t *testing.T) {
	t.Parallel()

	for name, decode := range map[string]func(*AgentRuntimeMiddlewares) error{
		"json": func(cfg *AgentRuntimeMiddlewares) error {
			return json.Unmarshal([]byte(`{"filesystem":false}`), cfg)
		},
		"yaml": func(cfg *AgentRuntimeMiddlewares) error {
			return yaml.Unmarshal([]byte("filesystem: false\n"), cfg)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var cfg AgentRuntimeMiddlewares
			if err := decode(&cfg); err != nil {
				t.Fatalf("decode runtime_middlewares: %v", err)
			}
			if cfg.Filesystem {
				t.Fatalf("Filesystem = true, want explicit false preserved")
			}
		})
	}
}
