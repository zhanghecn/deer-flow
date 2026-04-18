package service

import (
	"encoding/json"
	"testing"
)

func TestTurnCollectorDropsHistoricalAssistantAndToolReplay(t *testing.T) {
	t.Parallel()

	collector := newTurnCollector("turn_test")
	collector.primeReplayBoundary(turnReplayBoundary{
		messageIDs: map[string]struct{}{
			"msg_old": {},
		},
		toolCallIDs: map[string]struct{}{
			"call_old": {},
		},
	})

	historical := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_old",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "旧答案",
				},
			},
			"tool_calls": []any{
				map[string]any{
					"id":   "call_old",
					"name": "list_files",
					"args": map[string]any{
						"path": "",
					},
				},
			},
		},
	})
	if len(historical) != 0 {
		t.Fatalf("expected historical assistant replay to be ignored, got %#v", historical)
	}

	historicalTool := collector.consume("messages", []any{
		map[string]any{
			"type":         "tool",
			"name":         "list_files",
			"tool_call_id": "call_old",
			"content":      []any{map[string]any{"type": "text", "text": "old"}},
		},
	})
	if len(historicalTool) != 0 {
		t.Fatalf("expected historical tool replay to be ignored, got %#v", historicalTool)
	}

	current := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_new",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "新答案",
				},
				map[string]any{
					"type":      "reasoning",
					"reasoning": "新思考",
				},
			},
			"tool_calls": []any{
				map[string]any{
					"id":   "call_new",
					"name": "read_file_page",
					"args": map[string]any{
						"path": "盲派八字全知识点训练集.md",
						"page": 1,
					},
				},
			},
		},
	})
	if len(current) != 4 {
		t.Fatalf("expected current assistant stream to emit start/text/reasoning/tool events, got %#v", current)
	}
}

func TestExtractTurnReplayBoundaryFromState(t *testing.T) {
	t.Parallel()

	payload, err := json.Marshal(map[string]any{
		"values": map[string]any{
			"messages": []any{
				map[string]any{
					"type": "ai",
					"id":   "msg_prev",
					"tool_calls": []any{
						map[string]any{
							"id":   "call_prev",
							"name": "list_files",
						},
					},
				},
				map[string]any{
					"type":         "tool",
					"id":           "tool_msg_prev",
					"tool_call_id": "call_prev",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	boundary := extractTurnReplayBoundaryFromState(payload)
	if _, ok := boundary.messageIDs["msg_prev"]; !ok {
		t.Fatalf("expected assistant message id to be captured, got %#v", boundary.messageIDs)
	}
	if _, ok := boundary.toolCallIDs["call_prev"]; !ok {
		t.Fatalf("expected tool call id to be captured, got %#v", boundary.toolCallIDs)
	}
}
