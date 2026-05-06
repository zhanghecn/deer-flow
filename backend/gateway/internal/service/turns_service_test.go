package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
)

type stubPublicAPIKnowledgeRepo struct {
	attached []string
}

func (s *stubPublicAPIKnowledgeRepo) AttachBaseToThread(
	_ context.Context,
	_ uuid.UUID,
	threadID string,
	knowledgeBaseID string,
) error {
	s.attached = append(s.attached, threadID+":"+knowledgeBaseID)
	return nil
}

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

func TestTurnCollectorConvertsCumulativeAssistantTextToDeltas(t *testing.T) {
	t.Parallel()

	collector := newTurnCollector("turn_test")

	first := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "先定位",
				},
			},
		},
	})
	if len(first) != 2 {
		t.Fatalf("expected start and first text delta, got %#v", first)
	}
	if first[1].Delta != "先定位" {
		t.Fatalf("expected first delta, got %q", first[1].Delta)
	}

	replay := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "先定位",
				},
			},
		},
	})
	if len(replay) != 0 {
		t.Fatalf("expected duplicate cumulative text to be ignored, got %#v", replay)
	}

	extended := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "先定位，再读取",
				},
			},
		},
	})
	if len(extended) != 1 {
		t.Fatalf("expected only appended text delta, got %#v", extended)
	}
	if extended[0].Delta != "，再读取" {
		t.Fatalf("expected appended delta, got %q", extended[0].Delta)
	}
}

func TestTurnCollectorSuppressesCumulativeReplayAfterTokenDeltas(t *testing.T) {
	t.Parallel()

	collector := newTurnCollector("turn_test")

	for _, chunk := range []string{"找到", "多个", "案例"} {
		events := collector.consume("messages", []any{
			map[string]any{
				"type": "AIMessageChunk",
				"id":   "msg_current",
				"content": []any{
					map[string]any{
						"type": "text",
						"text": chunk,
					},
				},
			},
		})
		if len(events) == 0 {
			t.Fatalf("expected token delta event for %q", chunk)
		}
	}

	replay := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "找到多个案例",
				},
			},
		},
	})
	if len(replay) != 0 {
		t.Fatalf("expected cumulative replay after token deltas to be ignored, got %#v", replay)
	}

	extended := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "找到多个案例，需要继续",
				},
			},
		},
	})
	if len(extended) != 1 {
		t.Fatalf("expected appended cumulative text delta, got %#v", extended)
	}
	if extended[0].Delta != "，需要继续" {
		t.Fatalf("expected appended delta, got %q", extended[0].Delta)
	}
}

func TestTurnCollectorSuppressesWhitespaceNormalizedFinalReplay(t *testing.T) {
	t.Parallel()

	collector := newTurnCollector("turn_test")

	for _, chunk := range []string{"OA", "_TURNS", "_DELTA", "_0427", "流式", "通道"} {
		events := collector.consume("messages", []any{
			map[string]any{
				"type": "AIMessageChunk",
				"id":   "msg_current",
				"content": []any{
					map[string]any{
						"type": "text",
						"text": chunk,
					},
				},
			},
		})
		if len(events) == 0 {
			t.Fatalf("expected token delta event for %q", chunk)
		}
	}

	replay := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "OA_TURNS_DELTA_0427 流式通道",
				},
			},
		},
	})
	if len(replay) != 0 {
		t.Fatalf("expected whitespace-normalized replay to be ignored, got %#v", replay)
	}

	extended := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "OA_TURNS_DELTA_0427 流式通道已完成",
				},
			},
		},
	})
	if len(extended) != 1 {
		t.Fatalf("expected only appended suffix after normalized prefix, got %#v", extended)
	}
	if extended[0].Delta != "已完成" {
		t.Fatalf("expected appended suffix, got %q", extended[0].Delta)
	}
}

func TestTurnCollectorSuppressesRepeatedReasoningAcrossMessageIDs(t *testing.T) {
	t.Parallel()

	collector := newTurnCollector("turn_test")
	reasoning := "需要先检索甲辰案例，再逐个读取详细文章，避免只根据文件名回答。"

	first := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "reasoning_one",
			"content": []any{
				map[string]any{
					"type":      "reasoning",
					"reasoning": reasoning,
				},
			},
		},
	})
	if len(first) != 2 {
		t.Fatalf("expected start and reasoning delta, got %#v", first)
	}
	if first[1].Delta != reasoning {
		t.Fatalf("expected first reasoning delta, got %q", first[1].Delta)
	}

	replayed := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "reasoning_two",
			"content": []any{
				map[string]any{
					"type":      "reasoning",
					"reasoning": reasoning,
				},
			},
		},
	})
	if len(replayed) != 1 {
		t.Fatalf("expected only the new assistant message start, got %#v", replayed)
	}
}

func TestTurnCollectorConvertsNoIDReasoningSnapshotsToDeltas(t *testing.T) {
	t.Parallel()

	collector := newTurnCollector("turn_test")
	first := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"content": []any{
				map[string]any{
					"type":     "thinking",
					"thinking": "先读取技能",
				},
			},
		},
	})
	if len(first) != 2 || first[1].Delta != "先读取技能" {
		t.Fatalf("expected first reasoning delta, got %#v", first)
	}

	replay := collector.consume("messages-tuple", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"content": []any{
				map[string]any{
					"type":     "thinking",
					"thinking": "先读取技能",
				},
			},
		},
	})
	if len(replay) != 0 {
		t.Fatalf("expected duplicate no-id reasoning snapshot to be ignored, got %#v", replay)
	}

	extended := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"content": []any{
				map[string]any{
					"type":     "thinking",
					"thinking": "先读取技能，然后调用知识库工具",
				},
			},
		},
	})
	if len(extended) != 1 || extended[0].Delta != "，然后调用知识库工具" {
		t.Fatalf("expected appended no-id reasoning delta, got %#v", extended)
	}
}

func TestTurnCollectorDropsSummarizationChunks(t *testing.T) {
	t.Parallel()

	collector := newTurnCollector("turn_test")
	events := collector.consume("messages-tuple", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "summary_msg",
			"content": []any{
				map[string]any{
					"type":      "reasoning",
					"reasoning": "压缩摘要内部输出，不应进入 SDK 消息流。",
				},
			},
		},
		map[string]any{
			"lc_source": "summarization",
		},
	})

	if len(events) != 0 {
		t.Fatalf("expected summarization chunks to be hidden, got %#v", events)
	}
}

func TestTurnCollectorEmitsCompactionEventWithoutRawSummary(t *testing.T) {
	t.Parallel()

	collector := newTurnCollector("turn_test")
	events := collector.consume("values", map[string]any{
		"values": map[string]any{
			"context_window": map[string]any{
				"summary_applied":                   true,
				"summary_count":                     float64(2),
				"approx_input_tokens":               float64(215448),
				"approx_input_tokens_after_summary": float64(40984),
				"max_input_tokens":                  float64(200000),
				"last_summary": map[string]any{
					"summary_preview": "raw summary should remain out of the turn stream",
				},
			},
			"messages": []any{},
		},
	})

	if len(events) != 1 {
		t.Fatalf("expected one compaction event, got %#v", events)
	}
	event := events[0]
	if event.Type != model.TurnEventContextCompacted {
		t.Fatalf("expected context compaction event, got %q", event.Type)
	}
	if event.SummaryCount == nil || *event.SummaryCount != 2 {
		t.Fatalf("expected summary count 2, got %#v", event.SummaryCount)
	}
	if event.ContextBeforeTokens == nil || *event.ContextBeforeTokens != 215448 {
		t.Fatalf("expected pre-compaction token count, got %#v", event.ContextBeforeTokens)
	}
	if event.ContextAfterTokens == nil || *event.ContextAfterTokens != 40984 {
		t.Fatalf("expected post-compaction token count, got %#v", event.ContextAfterTokens)
	}
	if event.Text != "Conversation compacted" {
		t.Fatalf("expected stable public message, got %q", event.Text)
	}

	duplicate := collector.consume("values", map[string]any{
		"values": map[string]any{
			"context_window": map[string]any{
				"summary_applied": true,
				"summary_count":   float64(2),
			},
			"messages": []any{},
		},
	})
	if len(duplicate) != 0 {
		t.Fatalf("expected duplicate summary count to be suppressed, got %#v", duplicate)
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

func TestNormalizeTurnKnowledgeBaseIDsValidatesAndDedupesUUIDs(t *testing.T) {
	t.Parallel()

	first := "11111111-1111-1111-1111-111111111111"
	second := "22222222-2222-2222-2222-222222222222"
	ids, err := normalizeTurnKnowledgeBaseIDs([]string{
		" " + first + " ",
		first,
		second,
	})
	if err != nil {
		t.Fatalf("normalizeTurnKnowledgeBaseIDs: %v", err)
	}
	if len(ids) != 2 || ids[0] != first || ids[1] != second {
		t.Fatalf("unexpected normalized ids %#v", ids)
	}

	if _, err := normalizeTurnKnowledgeBaseIDs([]string{"not-a-uuid"}); err == nil {
		t.Fatal("expected invalid uuid to fail")
	}
}

func TestTurnKnowledgeScopeRequiredOnlyWhenIDsPresent(t *testing.T) {
	t.Parallel()

	ids := []string{"11111111-1111-1111-1111-111111111111"}
	if err := requireTurnKnowledgeScope(PublicAPIAuthContext{Scopes: []string{"responses:create"}}, ids); err == nil {
		t.Fatal("expected missing knowledge:read to fail")
	}
	if err := requireTurnKnowledgeScope(PublicAPIAuthContext{Scopes: []string{"responses:create"}}, nil); err != nil {
		t.Fatalf("unexpected empty knowledge scope error: %v", err)
	}
	if err := requireTurnKnowledgeScope(PublicAPIAuthContext{Scopes: []string{"Knowledge:Read"}}, ids); err != nil {
		t.Fatalf("expected case-insensitive knowledge scope to pass: %v", err)
	}
}

func TestAttachTurnKnowledgeBasesUsesThreadBindingRepository(t *testing.T) {
	t.Parallel()

	repo := &stubPublicAPIKnowledgeRepo{}
	svc := &PublicAPIService{knowledgeRepo: repo}
	userID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	knowledgeID := "44444444-4444-4444-4444-444444444444"

	if err := svc.attachTurnKnowledgeBases(
		context.Background(),
		PublicAPIAuthContext{UserID: userID, Scopes: []string{"knowledge:read"}},
		"thread-sdk",
		[]string{knowledgeID},
	); err != nil {
		t.Fatalf("attachTurnKnowledgeBases: %v", err)
	}
	if len(repo.attached) != 1 || repo.attached[0] != "thread-sdk:"+knowledgeID {
		t.Fatalf("expected one thread binding attach, got %#v", repo.attached)
	}
}

func TestAttachRunKnowledgeBasesMergesAgentDefaultsAndRequestIDs(t *testing.T) {
	t.Parallel()

	repo := &stubPublicAPIKnowledgeRepo{}
	svc := &PublicAPIService{knowledgeRepo: repo}
	defaultKnowledgeID := "11111111-1111-1111-1111-111111111111"
	requestKnowledgeID := "22222222-2222-2222-2222-222222222222"
	plan := &publicAPIRunPlan{
		Auth: PublicAPIAuthContext{
			UserID: uuid.MustParse("33333333-3333-3333-3333-333333333333"),
			Scopes: []string{"knowledge:read"},
		},
		ThreadID:              "thread-sdk",
		AgentKnowledgeBaseIDs: []string{defaultKnowledgeID},
	}

	if err := svc.attachRunKnowledgeBases(
		context.Background(),
		plan,
		[]string{requestKnowledgeID, defaultKnowledgeID},
	); err != nil {
		t.Fatalf("attachRunKnowledgeBases: %v", err)
	}

	want := []string{
		"thread-sdk:" + defaultKnowledgeID,
		"thread-sdk:" + requestKnowledgeID,
	}
	if len(repo.attached) != len(want) {
		t.Fatalf("attached = %#v, want %#v", repo.attached, want)
	}
	for index := range want {
		if repo.attached[index] != want[index] {
			t.Fatalf("attached[%d] = %q, want %q", index, repo.attached[index], want[index])
		}
	}
}
