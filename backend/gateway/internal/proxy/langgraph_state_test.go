package proxy

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTransformLangGraphHistoryPayloadFiltersFrontendState(t *testing.T) {
	t.Parallel()

	payload := []map[string]any{
		{
			"checkpoint": map[string]any{"checkpoint_id": "cp-1"},
			"values": map[string]any{
				"title":           "Surprise me",
				"artifacts":       []any{"/outputs/demo.html"},
				"todos":           []any{map[string]any{"content": "done"}},
				"messages":        []any{map[string]any{"id": "m1"}, map[string]any{"id": "m2"}, map[string]any{"id": "m3"}, map[string]any{"id": "m4"}},
				"skills_metadata": []any{"huge"},
				"thread_data":     map[string]any{"workspace_path": "/tmp"},
				"_summarization_event": map[string]any{
					"cutoff_index":    float64(2),
					"summary_message": map[string]any{"id": "summary"},
				},
			},
		},
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	transformed, changed, err := transformLangGraphHistoryPayload(raw)
	if err != nil {
		t.Fatalf("transform payload: %v", err)
	}
	if !changed {
		t.Fatalf("expected payload to change")
	}

	var states []map[string]any
	if err := json.Unmarshal(transformed, &states); err != nil {
		t.Fatalf("unmarshal transformed payload: %v", err)
	}

	values := states[0]["values"].(map[string]any)
	if _, ok := values["skills_metadata"]; ok {
		t.Fatalf("expected skills_metadata to be removed")
	}
	if _, ok := values["thread_data"]; ok {
		t.Fatalf("expected thread_data to be removed")
	}
	if _, ok := values["_summarization_event"]; ok {
		t.Fatalf("expected summarization metadata to be removed from frontend state")
	}

	messages := values["messages"].([]any)
	if len(messages) != 3 {
		t.Fatalf("expected compacted messages length 3, got %d", len(messages))
	}
	first := messages[0].(map[string]any)
	if first["id"] != "summary" {
		t.Fatalf("expected first message to be the summary, got %#v", first)
	}
}

func TestTransformLangGraphHistoryPayloadSanitizesMessagesForFrontend(t *testing.T) {
	t.Parallel()

	reasoning := strings.Repeat("r", langGraphHistoryReasoningLimit+128)
	writeContent := strings.Repeat("w", langGraphHistoryToolArgLimit+128)

	payload := []map[string]any{
		{
			"values": map[string]any{
				"messages": []any{
					map[string]any{
						"id":   "ai-1",
						"type": "ai",
						"content": []any{
							map[string]any{
								"type":      "thinking",
								"thinking":  reasoning,
								"signature": "secret",
							},
							map[string]any{
								"type": "text",
								"text": "visible answer",
							},
						},
						"tool_calls": []any{
							map[string]any{
								"id":   "tool-1",
								"name": "write_file",
								"args": map[string]any{
									"path":    "/tmp/demo.html",
									"content": writeContent,
								},
								"type": "tool_call",
							},
						},
						"response_metadata": map[string]any{"tokens": 99},
					},
					map[string]any{
						"id":           "tool-read",
						"type":         "tool",
						"name":         "read_file",
						"tool_call_id": "tool-1",
						"content":      "large read output",
					},
					map[string]any{
						"id":           "tool-task",
						"type":         "tool",
						"name":         "task",
						"tool_call_id": "tool-2",
						"content":      "Task Succeeded. Result: done",
					},
				},
			},
		},
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	transformed, changed, err := transformLangGraphHistoryPayload(raw)
	if err != nil {
		t.Fatalf("transform payload: %v", err)
	}
	if !changed {
		t.Fatalf("expected payload to change")
	}

	var states []map[string]any
	if err := json.Unmarshal(transformed, &states); err != nil {
		t.Fatalf("unmarshal transformed payload: %v", err)
	}

	messages := states[0]["values"].(map[string]any)["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("expected dropped read_file tool message, got %d messages", len(messages))
	}

	aiMessage := messages[0].(map[string]any)
	if _, ok := aiMessage["response_metadata"]; ok {
		t.Fatalf("expected response_metadata to be removed")
	}

	contentBlocks := aiMessage["content"].([]any)
	reasoningBlock := contentBlocks[0].(map[string]any)
	if _, ok := reasoningBlock["signature"]; ok {
		t.Fatalf("expected reasoning signature to be removed")
	}
	reasoningText := reasoningBlock["thinking"].(string)
	if !strings.Contains(reasoningText, "[truncated for history]") {
		t.Fatalf("expected reasoning content to be truncated")
	}

	toolCalls := aiMessage["tool_calls"].([]any)
	writeToolCall := toolCalls[0].(map[string]any)
	args := writeToolCall["args"].(map[string]any)
	if !strings.Contains(args["content"].(string), "[truncated for history]") {
		t.Fatalf("expected write_file tool call args to be truncated")
	}
	if _, ok := writeToolCall["type"]; ok {
		t.Fatalf("expected non-frontend tool call fields to be removed")
	}

	taskMessage := messages[1].(map[string]any)
	if taskMessage["name"] != "task" {
		t.Fatalf("expected task tool message to be preserved, got %#v", taskMessage["name"])
	}
}

func TestTransformLangGraphHistoryPayloadCompactsCompletedTurns(t *testing.T) {
	t.Parallel()

	payload := []map[string]any{
		{
			"values": map[string]any{
				"messages": []any{
					map[string]any{
						"id":      "human-1",
						"type":    "human",
						"content": "make something",
					},
					map[string]any{
						"id":   "ai-processing-1",
						"type": "ai",
						"content": []any{
							map[string]any{"type": "thinking", "thinking": "hidden"},
						},
						"tool_calls": []any{
							map[string]any{"id": "tool-1", "name": "write_file", "args": map[string]any{"path": "/tmp/a.html"}},
						},
					},
					map[string]any{
						"id":           "tool-1-result",
						"type":         "tool",
						"name":         "task",
						"tool_call_id": "tool-1",
						"content":      "Task Succeeded. Result: done",
					},
					map[string]any{
						"id":      "ai-final-1",
						"type":    "ai",
						"content": "here is the final result",
					},
					map[string]any{
						"id":      "human-2",
						"type":    "human",
						"content": "continue",
					},
					map[string]any{
						"id":   "ai-processing-2",
						"type": "ai",
						"content": []any{
							map[string]any{"type": "thinking", "thinking": "still running"},
						},
						"tool_calls": []any{
							map[string]any{"id": "tool-2", "name": "task", "args": map[string]any{"prompt": "continue"}},
						},
					},
				},
			},
		},
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	transformed, changed, err := transformLangGraphHistoryPayload(raw)
	if err != nil {
		t.Fatalf("transform payload: %v", err)
	}
	if !changed {
		t.Fatalf("expected payload to change")
	}

	var states []map[string]any
	if err := json.Unmarshal(transformed, &states); err != nil {
		t.Fatalf("unmarshal transformed payload: %v", err)
	}

	messages := states[0]["values"].(map[string]any)["messages"].([]any)
	if len(messages) != 4 {
		t.Fatalf("expected 4 compacted messages, got %d", len(messages))
	}

	ids := make([]string, 0, len(messages))
	for _, message := range messages {
		messageMap := message.(map[string]any)
		ids = append(ids, messageMap["id"].(string))
	}

	expected := []string{"human-1", "ai-final-1", "human-2", "ai-processing-2"}
	for index, id := range expected {
		if ids[index] != id {
			t.Fatalf("expected message %d to be %q, got %q", index, id, ids[index])
		}
	}
}

func TestTransformLangGraphHistoryPayloadTrimsActiveTurnTail(t *testing.T) {
	t.Parallel()

	messages := []any{
		map[string]any{
			"id":      "human-1",
			"type":    "human",
			"content": "build ppt",
		},
	}

	for index := 0; index < 14; index++ {
		taskID := "task-" + string(rune('a'+index))
		messages = append(messages,
			map[string]any{
				"id":   "ai-step-" + taskID,
				"type": "ai",
				"content": []any{
					map[string]any{"type": "thinking", "thinking": "step"},
				},
				"tool_calls": []any{
					map[string]any{"id": taskID, "name": "task", "args": map[string]any{"prompt": "do work"}},
				},
			},
			map[string]any{
				"id":           "tool-step-" + taskID,
				"type":         "tool",
				"name":         "task",
				"tool_call_id": taskID,
				"content":      "Task Succeeded. Result: done",
			},
		)
	}

	messages = append(messages, map[string]any{
		"id":      "ai-final",
		"type":    "ai",
		"content": "presentation ready",
	})

	payload := []map[string]any{
		{
			"values": map[string]any{
				"messages": messages,
			},
		},
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	transformed, changed, err := transformLangGraphHistoryPayload(raw)
	if err != nil {
		t.Fatalf("transform payload: %v", err)
	}
	if !changed {
		t.Fatalf("expected payload to change")
	}

	var states []map[string]any
	if err := json.Unmarshal(transformed, &states); err != nil {
		t.Fatalf("unmarshal transformed payload: %v", err)
	}

	resultMessages := states[0]["values"].(map[string]any)["messages"].([]any)
	if len(resultMessages) >= len(messages) {
		t.Fatalf("expected active turn to be compacted from %d messages, got %d", len(messages), len(resultMessages))
	}

	ids := make(map[string]struct{}, len(resultMessages))
	for _, message := range resultMessages {
		messageMap := message.(map[string]any)
		ids[messageMap["id"].(string)] = struct{}{}
	}

	if _, ok := ids["human-1"]; !ok {
		t.Fatalf("expected human message to be preserved")
	}
	if _, ok := ids["ai-final"]; !ok {
		t.Fatalf("expected final assistant message to be preserved")
	}
	if _, ok := ids["ai-step-task-a"]; ok {
		t.Fatalf("expected oldest processing message to be dropped")
	}
	if _, ok := ids["tool-step-task-a"]; ok {
		t.Fatalf("expected oldest task result to be dropped")
	}
}

func TestTransformLangGraphHistoryPayloadNoOpForInvalidJSON(t *testing.T) {
	t.Parallel()

	if _, _, err := transformLangGraphHistoryPayload([]byte("{")); err == nil {
		t.Fatalf("expected invalid json error")
	}
}
