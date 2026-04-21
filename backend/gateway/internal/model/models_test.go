package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAgentJSONIncludesExplicitEmptyToolNames(t *testing.T) {
	t.Parallel()

	payload, err := json.Marshal(Agent{
		Name:        "support-agent",
		Description: "Support agent",
		ToolNames:   []string{},
		McpServers:  []string{"custom/mcp-profiles/customer-docs.json"},
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
