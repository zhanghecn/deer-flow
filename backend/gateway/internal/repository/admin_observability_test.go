package repository

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
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

func TestExtractInitialUserMessageTruncatesUTF8Safely(t *testing.T) {
	t.Parallel()

	preview := truncatePreview(strings.Repeat("压测中文片段", 40), 140)
	if !utf8.ValidString(preview) {
		t.Fatalf("expected valid UTF-8 preview, got %q", preview)
	}
	if len([]rune(preview)) > 140 {
		t.Fatalf("expected preview capped to 140 runes, got %d", len([]rune(preview)))
	}
	if !strings.HasSuffix(preview, "...") {
		t.Fatalf("expected truncated preview to end with ellipsis, got %q", preview)
	}
}

func TestNormalizeJSONPayloadOmitsEmptyContextWindow(t *testing.T) {
	t.Parallel()

	for _, raw := range []json.RawMessage{
		nil,
		json.RawMessage(``),
		json.RawMessage(`null`),
		json.RawMessage(`{}`),
	} {
		if got := normalizeJSONPayload(raw); got != nil {
			t.Fatalf("expected empty payload %q to be omitted, got %s", string(raw), string(got))
		}
	}

	got := normalizeJSONPayload(json.RawMessage(`{"summary_applied":true}`))
	if string(got) != `{"summary_applied":true}` {
		t.Fatalf("expected non-empty payload to be preserved, got %s", string(got))
	}
}
