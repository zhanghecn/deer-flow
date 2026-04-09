package handler

import (
	"encoding/json"
	"github.com/openagents/gateway/internal/model"
	"testing"
)

func TestTranslateChatCompletionsRequestMapsJSONSchema(t *testing.T) {
	t.Parallel()

	request := model.PublicAPIChatCompletionsRequest{
		Model: "demo-agent",
		Messages: []model.PublicAPIChatMessage{
			{Role: "user", Content: "hello"},
		},
		ResponseFormat: &model.PublicAPIChatResponseFormat{
			Type: "json_schema",
			JSONSchema: &model.PublicAPIChatJSONSchema{
				Name:   "demo",
				Schema: json.RawMessage(`{"type":"object"}`),
				Strict: true,
			},
		},
	}

	translated, err := translateChatCompletionsRequest(request)
	if err != nil {
		t.Fatalf("translateChatCompletionsRequest: %v", err)
	}
	if translated.Model != "demo-agent" {
		t.Fatalf("expected model to be preserved, got %q", translated.Model)
	}
	if translated.Text == nil || translated.Text.Format == nil {
		t.Fatalf("expected json schema format to be translated")
	}
	if translated.Text.Format.Type != "json_schema" {
		t.Fatalf("expected json_schema type, got %q", translated.Text.Format.Type)
	}
}

func TestTranslateResponseToChatCompletionIncludesArtifacts(t *testing.T) {
	t.Parallel()

	body := json.RawMessage(`{
		"id":"resp_demo",
		"created_at": 42,
		"model":"demo-agent",
		"output_text":"hello",
		"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3},
		"metadata":{"openagents":{"thread_id":"thread-1"}},
		"artifacts":[{"id":"file_1"}]
	}`)

	translated, err := translateResponseToChatCompletion(body)
	if err != nil {
		t.Fatalf("translateResponseToChatCompletion: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(translated, &payload); err != nil {
		t.Fatalf("unmarshal translated body: %v", err)
	}
	if payload["object"] != "chat.completion" {
		t.Fatalf("expected chat.completion object, got %#v", payload["object"])
	}
	if payload["artifacts"] == nil {
		t.Fatalf("expected artifacts to be preserved")
	}
}
