package repository

import (
	"encoding/json"
	"testing"
)

func TestExtractInitialUserMessage(t *testing.T) {
	t.Parallel()

	payload := json.RawMessage(`{
		"inputs": {
			"messages": [
				{
					"type": "human",
					"content": [
						{"type": "text", "text": "  hello   world  "}
					]
				}
			]
		}
	}`)

	got := extractInitialUserMessage(payload)
	if got == nil {
		t.Fatal("expected initial user message")
	}
	if *got != "hello world" {
		t.Fatalf("expected normalized preview, got %q", *got)
	}
}

func TestExtractInitialUserMessageReturnsNilWhenNoHumanInput(t *testing.T) {
	t.Parallel()

	payload := json.RawMessage(`{
		"inputs": {
			"messages": [
				{
					"type": "ai",
					"content": [{"type": "text", "text": "assistant"}]
				}
			]
		}
	}`)

	if got := extractInitialUserMessage(payload); got != nil {
		t.Fatalf("expected nil preview, got %q", *got)
	}
}

func TestExtractInitialUserMessageSupportsStringifiedMessages(t *testing.T) {
	t.Parallel()

	payload := json.RawMessage(`{
		"inputs": {
			"messages": [
				"content=[{'type': 'text', 'text': '\\u7ed9\\u6211\\u4e00\\u4e2a\\u5c0f\\u60ca\\u559c\\u5427'}] additional_kwargs={} response_metadata={}"
			]
		}
	}`)

	got := extractInitialUserMessage(payload)
	if got == nil {
		t.Fatal("expected initial user message")
	}
	if *got != "给我一个小惊喜吧" {
		t.Fatalf("expected extracted preview, got %q", *got)
	}
}
