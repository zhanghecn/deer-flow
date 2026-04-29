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

func TestAgentRuntimeMiddlewaresDefaultsToEmptyDisabledList(t *testing.T) {
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
			if len(cfg.Disabled) != 0 {
				t.Fatalf("Disabled = %#v, want empty deny-list", cfg.Disabled)
			}
			if !cfg.MiddlewareEnabled("filesystem") {
				t.Fatalf("MiddlewareEnabled(filesystem) = false, want default enabled")
			}
		})
	}
}

func TestAgentRuntimeMiddlewaresNormalizesDisabledList(t *testing.T) {
	t.Parallel()

	for name, decode := range map[string]func(*AgentRuntimeMiddlewares) error{
		"json": func(cfg *AgentRuntimeMiddlewares) error {
			return json.Unmarshal([]byte(`{"disabled":[" filesystem ","filesystem","todo"]}`), cfg)
		},
		"yaml": func(cfg *AgentRuntimeMiddlewares) error {
			return yaml.Unmarshal([]byte("disabled:\n  - ' filesystem '\n  - filesystem\n  - todo\n"), cfg)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var cfg AgentRuntimeMiddlewares
			if err := decode(&cfg); err != nil {
				t.Fatalf("decode runtime_middlewares: %v", err)
			}
			if len(cfg.Disabled) != 2 || cfg.Disabled[0] != "filesystem" || cfg.Disabled[1] != "todo" {
				t.Fatalf("Disabled = %#v, want normalized middleware names", cfg.Disabled)
			}
			if cfg.MiddlewareEnabled("filesystem") {
				t.Fatalf("MiddlewareEnabled(filesystem) = true, want disabled")
			}
			if !cfg.MiddlewareEnabled("subagents") {
				t.Fatalf("MiddlewareEnabled(subagents) = false, want enabled")
			}
		})
	}
}

func TestAgentRuntimeMiddlewaresRejectsDeprecatedFilesystemSwitch(t *testing.T) {
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
			if err := decode(&cfg); err == nil {
				t.Fatal("decode runtime_middlewares error = nil, want deprecated filesystem rejection")
			}
		})
	}
}

func TestAgentRuntimeMiddlewaresRejectsUnknownFields(t *testing.T) {
	t.Parallel()

	for name, decode := range map[string]func(*AgentRuntimeMiddlewares) error{
		"json": func(cfg *AgentRuntimeMiddlewares) error {
			return json.Unmarshal([]byte(`{"enabled":["filesystem"]}`), cfg)
		},
		"yaml": func(cfg *AgentRuntimeMiddlewares) error {
			return yaml.Unmarshal([]byte("enabled:\n  - filesystem\n"), cfg)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var cfg AgentRuntimeMiddlewares
			if err := decode(&cfg); err == nil {
				t.Fatal("decode runtime_middlewares error = nil, want unknown-field rejection")
			}
		})
	}
}
