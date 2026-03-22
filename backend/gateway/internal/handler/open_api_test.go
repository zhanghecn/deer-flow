package handler

import "testing"

func TestBuildLangGraphRunRequestUsesSDKShape(t *testing.T) {
	t.Parallel()

	payload := buildLangGraphRunRequest(
		"contract-review-agent",
		"thread-123",
		"kimi-k2.5-1",
		"hello",
	)

	if got := payload["assistant_id"]; got != openAPIAssistantID {
		t.Fatalf("expected assistant_id %q, got %#v", openAPIAssistantID, got)
	}

	input, ok := payload["input"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected one input message, got %#v", payload["input"])
	}
	messages, ok := input["messages"].([]map[string]interface{})
	if !ok || len(messages) != 1 {
		t.Fatalf("expected one SDK message, got %#v", input["messages"])
	}
	if got := messages[0]["type"]; got != "human" {
		t.Fatalf("expected human message, got %#v", got)
	}

	content, ok := messages[0]["content"].([]map[string]interface{})
	if !ok || len(content) != 1 {
		t.Fatalf("expected one text content block, got %#v", messages[0]["content"])
	}
	if got := content[0]["type"]; got != "text" {
		t.Fatalf("expected text content type, got %#v", got)
	}
	if got := content[0]["text"]; got != "hello" {
		t.Fatalf("expected text hello, got %#v", got)
	}

	config, ok := payload["config"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected config object, got %#v", payload["config"])
	}
	configurable, ok := config["configurable"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected config.configurable object, got %#v", config["configurable"])
	}
	if got := configurable["agent_name"]; got != "contract-review-agent" {
		t.Fatalf("expected agent_name contract-review-agent, got %#v", got)
	}
	if got := configurable["agent_status"]; got != "prod" {
		t.Fatalf("expected agent_status prod, got %#v", got)
	}
	if got := configurable["thread_id"]; got != "thread-123" {
		t.Fatalf("expected thread_id thread-123, got %#v", got)
	}
	if got := configurable["model_name"]; got != "kimi-k2.5-1" {
		t.Fatalf("expected model_name kimi-k2.5-1, got %#v", got)
	}

	if _, exists := payload["configurable"]; exists {
		t.Fatalf("did not expect legacy top-level configurable field in payload")
	}
}

func TestBuildLangGraphThreadCreateRequestUsesLeadAgentGraph(t *testing.T) {
	t.Parallel()

	payload := buildLangGraphThreadCreateRequest("thread-456")

	if got := payload["thread_id"]; got != "thread-456" {
		t.Fatalf("expected thread_id thread-456, got %#v", got)
	}
	if got := payload["if_exists"]; got != "do_nothing" {
		t.Fatalf("expected if_exists do_nothing, got %#v", got)
	}

	metadata, ok := payload["metadata"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected metadata object, got %#v", payload["metadata"])
	}
	if got := metadata["graph_id"]; got != openAPIAssistantID {
		t.Fatalf("expected metadata.graph_id %q, got %#v", openAPIAssistantID, got)
	}
}
