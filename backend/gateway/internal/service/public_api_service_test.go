package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type stubPublicAPIModelRepo struct {
	enabled map[string]bool
}

type stubPublicAPIInvocationRepo struct {
	byResponseID map[string]*model.PublicAPIInvocation
}

func (s stubPublicAPIModelRepo) FindEnabledByName(
	_ context.Context,
	name string,
) (*repository.ModelRecord, error) {
	if !s.enabled[name] {
		return nil, nil
	}
	return &repository.ModelRecord{Name: name, Enabled: true}, nil
}

func (s *stubPublicAPIInvocationRepo) Create(
	_ context.Context,
	invocation *model.PublicAPIInvocation,
) error {
	if s.byResponseID == nil {
		s.byResponseID = make(map[string]*model.PublicAPIInvocation)
	}
	cloned := *invocation
	s.byResponseID[invocation.ResponseID] = &cloned
	return nil
}

func (s *stubPublicAPIInvocationRepo) Finish(
	_ context.Context,
	invocation *model.PublicAPIInvocation,
) error {
	if s.byResponseID == nil {
		s.byResponseID = make(map[string]*model.PublicAPIInvocation)
	}
	cloned := *invocation
	s.byResponseID[invocation.ResponseID] = &cloned
	return nil
}

func (s *stubPublicAPIInvocationRepo) AttachArtifacts(
	_ context.Context,
	_ []model.PublicAPIArtifact,
) error {
	return nil
}

func (s *stubPublicAPIInvocationRepo) GetByResponseID(
	_ context.Context,
	responseID string,
	_ uuid.UUID,
) (*model.PublicAPIInvocation, error) {
	if s.byResponseID == nil {
		return nil, nil
	}
	item, ok := s.byResponseID[responseID]
	if !ok {
		return nil, nil
	}
	cloned := *item
	return &cloned, nil
}

func (s *stubPublicAPIInvocationRepo) GetArtifactByFileID(
	_ context.Context,
	_ string,
	_ uuid.UUID,
) (*model.PublicAPIArtifact, *model.PublicAPIInvocation, error) {
	return nil, nil, nil
}

func (s *stubPublicAPIInvocationRepo) ListByUser(
	_ context.Context,
	_ uuid.UUID,
	_ model.PublicAPIInvocationFilter,
) ([]model.PublicAPIInvocation, error) {
	return nil, nil
}

func TestFetchThreadStatePassesRuntimeHeaders(t *testing.T) {
	t.Parallel()

	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	var seenUserID string
	var seenAgentName string
	var seenAgentStatus string
	var seenModelName string
	var seenHistoryCall bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/threads/thread-1/history" {
			seenHistoryCall = true
		}
		seenUserID = r.Header.Get("X-User-ID")
		seenAgentName = r.Header.Get("X-Agent-Name")
		seenAgentStatus = r.Header.Get("X-Agent-Status")
		seenModelName = r.Header.Get("X-Model-Name")
		_, _ = io.WriteString(w, `{"values":{"messages":[]}}`)
	}))
	t.Cleanup(server.Close)

	svc := &PublicAPIService{
		langGraphURL: server.URL,
		httpClient:   server.Client(),
	}

	if _, err := svc.fetchThreadState(context.Background(), userID, "thread-1", "demo-agent", "kimi-k2.5"); err != nil {
		t.Fatalf("fetchThreadState: %v", err)
	}
	if seenUserID != userID.String() {
		t.Fatalf("expected x-user-id %q, got %q", userID.String(), seenUserID)
	}
	if seenAgentName != "demo-agent" {
		t.Fatalf("expected x-agent-name demo-agent, got %q", seenAgentName)
	}
	if seenAgentStatus != "prod" {
		t.Fatalf("expected x-agent-status prod, got %q", seenAgentStatus)
	}
	if seenModelName != "kimi-k2.5" {
		t.Fatalf("expected x-model-name kimi-k2.5, got %q", seenModelName)
	}
	if seenHistoryCall {
		t.Fatal("did not expect history fallback for non-empty state values")
	}
}

func TestListModelsSkipsUncallablePublishedAgents(t *testing.T) {
	t.Parallel()

	baseDir := t.TempDir()
	fsStore := storage.NewFS(baseDir)

	if err := fsStore.WriteAgentFiles(
		"lead_agent",
		"prod",
		"# lead agent\n",
		map[string]any{
			"name": "lead_agent",
		},
	); err != nil {
		t.Fatalf("write lead_agent: %v", err)
	}
	if err := fsStore.WriteAgentFiles(
		"contract-reviewer",
		"prod",
		"# contract reviewer\n",
		map[string]any{
			"name":  "contract-reviewer",
			"model": "kimi-k2.5",
		},
	); err != nil {
		t.Fatalf("write contract-reviewer: %v", err)
	}
	if err := fsStore.WriteAgentFiles(
		"stale-agent",
		"prod",
		"# stale agent\n",
		map[string]any{
			"name":  "stale-agent",
			"model": "disabled-model",
		},
	); err != nil {
		t.Fatalf("write stale-agent: %v", err)
	}
	// Ensure the agent directory exists so created_at lookup has a stable root.
	if err := os.MkdirAll(fsStore.AgentSkillsDir("contract-reviewer", "prod"), 0o755); err != nil {
		t.Fatalf("ensure skills dir: %v", err)
	}

	svc := &PublicAPIService{
		fs: fsStore,
		modelRepo: stubPublicAPIModelRepo{
			enabled: map[string]bool{
				"kimi-k2.5": true,
			},
		},
	}

	response, err := svc.ListModels(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if len(response.Data) != 1 {
		t.Fatalf("expected 1 callable model, got %#v", response.Data)
	}
	if response.Data[0].ID != "contract-reviewer" {
		t.Fatalf("expected contract-reviewer, got %#v", response.Data)
	}
}

func TestRunAgentTurnReturnsEmbeddedLangGraphError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"__error__":{"error":"APIConnectionError","message":"Connection error."}}`)
	}))
	t.Cleanup(server.Close)

	svc := &PublicAPIService{
		langGraphURL: server.URL,
		httpClient:   server.Client(),
	}

	err := svc.runAgentTurnStream(
		context.Background(),
		&publicAPIRunPlan{
			Auth: PublicAPIAuthContext{
				UserID: uuid.MustParse("11111111-1111-1111-1111-111111111111"),
			},
			AgentName:      "demo-agent",
			ThreadID:       "thread-1",
			ModelName:      "kimi-k2.5",
			PromptText:     "hello",
			RuntimeUploads: nil,
		},
		nil,
	)
	if err == nil {
		t.Fatal("expected embedded run error")
	}
	if !strings.Contains(err.Error(), "APIConnectionError: Connection error.") {
		t.Fatalf("expected embedded error details, got %v", err)
	}
}

func TestRunAgentTurnForwardsRuntimeUploadMimeType(t *testing.T) {
	t.Parallel()

	var requestPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestPayload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: end\ndata: {}\n\n")
	}))
	t.Cleanup(server.Close)

	svc := &PublicAPIService{
		langGraphURL: server.URL,
		httpClient:   server.Client(),
	}

	err := svc.runAgentTurnStream(
		context.Background(),
		&publicAPIRunPlan{
			Auth: PublicAPIAuthContext{
				UserID: uuid.MustParse("11111111-1111-1111-1111-111111111111"),
			},
			AgentName:  "demo-agent",
			ThreadID:   "thread-1",
			ModelName:  "vision-model",
			PromptText: "describe the image",
			RuntimeUploads: []publicAPIRuntimeUpload{
				{Filename: "file_123_chart.png", Size: 42, MimeType: "image/png"},
			},
		},
		nil,
	)
	if err != nil {
		t.Fatalf("runAgentTurnStream: %v", err)
	}

	input := requestPayload["input"].(map[string]any)
	messages := input["messages"].([]any)
	message := messages[0].(map[string]any)
	additional := message["additional_kwargs"].(map[string]any)
	files := additional["files"].([]any)
	file := files[0].(map[string]any)
	if got := file["mime_type"]; got != "image/png" {
		t.Fatalf("mime_type = %#v, want image/png", got)
	}
}

func TestFinishInvocationWithErrorStoresFailedTurnSnapshotForTurnsSurface(t *testing.T) {
	t.Parallel()

	invocationRepo := &stubPublicAPIInvocationRepo{}
	svc := &PublicAPIService{invocationRepo: invocationRepo}
	invocation := &model.PublicAPIInvocation{
		ID:           uuid.New(),
		ResponseID:   "turn_failed",
		Surface:      "turns",
		AgentName:    "demo-agent",
		ThreadID:     "thread-1",
		RequestModel: "demo-agent",
		Status:       "in_progress",
		CreatedAt:    time.Unix(42, 0).UTC(),
	}

	cause := wrapPublicAPITurnFailure(&PublicAPIError{
		StatusCode: http.StatusBadGateway,
		Code:       "runtime_error",
		Message:    "state lookup exploded",
	}, publicAPITurnFailureContext{
		Stage:          model.TurnFailureStageStateFetch,
		PreviousTurnID: "turn_prev",
		Metadata:       map[string]any{"source": "test"},
	})

	err := svc.finishInvocationWithError(context.Background(), invocation, cause, nil)
	if err == nil {
		t.Fatal("expected finishInvocationWithError to return a public error")
	}

	var snapshot model.TurnSnapshot
	if unmarshalErr := json.Unmarshal(invocation.ResponseJSON, &snapshot); unmarshalErr != nil {
		t.Fatalf("unmarshal failed turn snapshot: %v", unmarshalErr)
	}
	if snapshot.Object != "turn" || snapshot.Status != "failed" {
		t.Fatalf("unexpected turn snapshot %#v", snapshot)
	}
	if snapshot.PreviousTurnID != "turn_prev" {
		t.Fatalf("expected previous turn id to be preserved, got %#v", snapshot.PreviousTurnID)
	}
	if len(snapshot.Events) != 1 {
		t.Fatalf("expected 1 terminal event, got %#v", snapshot.Events)
	}
	if snapshot.Events[0].Type != model.TurnEventTurnFailed {
		t.Fatalf("expected terminal failed event, got %#v", snapshot.Events[0])
	}
	if snapshot.Events[0].Stage != model.TurnFailureStageStateFetch {
		t.Fatalf("expected state_fetch stage, got %#v", snapshot.Events[0].Stage)
	}
	if snapshot.Events[0].Retryable == nil || !*snapshot.Events[0].Retryable {
		t.Fatalf("expected retryable=true, got %#v", snapshot.Events[0].Retryable)
	}
	if snapshot.Events[0].Code != "runtime_error" {
		t.Fatalf("expected runtime_error code, got %#v", snapshot.Events[0].Code)
	}
}

func TestFetchThreadStateFallsBackToHistoryWhenStateIsEmpty(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/threads/thread-1/state":
			_, _ = io.WriteString(w, `{"values":{},"tasks":[]}`)
		case r.Method == http.MethodPost && r.URL.Path == "/threads/thread-1/history":
			_, _ = io.WriteString(w, `[{"values":{"messages":[{"type":"ai","content":"done"}],"artifacts":["/mnt/user-data/outputs/demo.txt"]},"tasks":[]}]`)
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	t.Cleanup(server.Close)

	svc := &PublicAPIService{
		langGraphURL: server.URL,
		httpClient:   server.Client(),
	}

	payload, err := svc.fetchThreadState(
		context.Background(),
		uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		"thread-1",
		"demo-agent",
		"kimi-k2.5",
	)
	if err != nil {
		t.Fatalf("fetchThreadState: %v", err)
	}

	text, reasoning, artifacts, err := extractAssistantResultFromState(payload)
	if err != nil {
		t.Fatalf("extractAssistantResultFromState: %v", err)
	}
	if text != "done" {
		t.Fatalf("expected assistant text done, got %q", text)
	}
	if reasoning != "" {
		t.Fatalf("expected no reasoning text, got %q", reasoning)
	}
	if len(artifacts) != 1 || artifacts[0] != "/mnt/user-data/outputs/demo.txt" {
		t.Fatalf("unexpected artifacts %#v", artifacts)
	}
}

func TestExtractAssistantResultFromStateCombinesEarlierReasoningWithFinalText(t *testing.T) {
	t.Parallel()

	payload := []byte(`{
		"values": {
			"messages": [
				{
					"type": "human",
					"content": [{"type": "text", "text": "question"}]
				},
				{
					"type": "ai",
					"content": [
						{"type": "thinking", "thinking": "先搜索案例库。"},
						{"type": "tool_use", "name": "grep_files"}
					]
				},
				{
					"type": "tool",
					"content": [{"type": "text", "text": "{\"items\":[]}"}]
				},
				{
					"type": "ai",
					"content": [{"type": "text", "text": "最终答案"}]
				}
			],
			"artifacts": ["/mnt/user-data/outputs/demo.txt"]
		},
		"tasks": []
	}`)

	text, reasoning, artifacts, err := extractAssistantResultFromState(payload)
	if err != nil {
		t.Fatalf("extractAssistantResultFromState: %v", err)
	}
	if text != "最终答案" {
		t.Fatalf("text = %q, want %q", text, "最终答案")
	}
	if reasoning != "先搜索案例库。" {
		t.Fatalf("reasoning = %q, want %q", reasoning, "先搜索案例库。")
	}
	if len(artifacts) != 1 || artifacts[0] != "/mnt/user-data/outputs/demo.txt" {
		t.Fatalf("unexpected artifacts %#v", artifacts)
	}
}

func TestNormalizeStructuredOutputTextAcceptsValidJSONInsideMarkdownFence(t *testing.T) {
	t.Parallel()

	options := &model.PublicAPITextOptions{
		Format: &model.PublicAPITextFormat{
			Type:   "json_schema",
			Schema: json.RawMessage(`{"type":"object"}`),
			Strict: true,
		},
	}

	normalized, err := normalizeStructuredOutputText("```json\n{\"ok\":true}\n```", options)
	if err != nil {
		t.Fatalf("normalizeStructuredOutputText: %v", err)
	}
	if normalized != `{"ok":true}` {
		t.Fatalf("normalized output = %q, want %q", normalized, `{"ok":true}`)
	}
}

func TestNormalizeStructuredOutputTextAcceptsBalancedJSONWithinProse(t *testing.T) {
	t.Parallel()

	options := &model.PublicAPITextOptions{
		Format: &model.PublicAPITextFormat{
			Type:   "json_schema",
			Schema: json.RawMessage(`{"type":"object"}`),
			Strict: true,
		},
	}

	normalized, err := normalizeStructuredOutputText("Answer:\n{\"ok\":true}\nThanks", options)
	if err != nil {
		t.Fatalf("normalizeStructuredOutputText: %v", err)
	}
	if normalized != `{"ok":true}` {
		t.Fatalf("normalized output = %q, want %q", normalized, `{"ok":true}`)
	}
}

func TestNormalizeStructuredOutputTextRejectsMalformedJSON(t *testing.T) {
	t.Parallel()

	options := &model.PublicAPITextOptions{
		Format: &model.PublicAPITextFormat{
			Type:   "json_schema",
			Schema: json.RawMessage(`{"type":"object"}`),
			Strict: true,
		},
	}

	if _, err := normalizeStructuredOutputText(`{"ok",true}`, options); err == nil {
		t.Fatal("expected malformed JSON to be rejected")
	}
}

func TestNormalizeStructuredOutputTextRejectsSchemaMismatchWhenStrict(t *testing.T) {
	t.Parallel()

	options := &model.PublicAPITextOptions{
		Format: &model.PublicAPITextFormat{
			Type:   "json_schema",
			Schema: json.RawMessage(`{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}},"additionalProperties":false}`),
			Strict: true,
		},
	}

	if _, err := normalizeStructuredOutputText(`{"ok":"yes"}`, options); err == nil {
		t.Fatal("expected schema mismatch to be rejected")
	}
}

func TestBuildResponseArtifactsDiscoversThreadOutputsWithoutPresentFiles(t *testing.T) {
	t.Parallel()

	baseDir := t.TempDir()
	fsStore := storage.NewFS(baseDir)
	threadID := "thread-output-discovery"
	outputPath := filepath.Join(
		fsStore.ThreadUserDataDir(threadID),
		"outputs",
		"summary.md",
	)
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		t.Fatalf("mkdir output dir: %v", err)
	}
	if err := os.WriteFile(outputPath, []byte("# summary"), 0o644); err != nil {
		t.Fatalf("write output file: %v", err)
	}

	svc := &PublicAPIService{fs: fsStore}
	invocation := &model.PublicAPIInvocation{
		ID:         uuid.New(),
		ResponseID: "resp_test",
		ThreadID:   threadID,
	}

	responseArtifacts, ledgerArtifacts, err := svc.buildResponseArtifacts(invocation, nil)
	if err != nil {
		t.Fatalf("buildResponseArtifacts: %v", err)
	}
	if len(responseArtifacts) != 1 {
		t.Fatalf("expected 1 response artifact, got %#v", responseArtifacts)
	}
	if responseArtifacts[0].Filename != "summary.md" {
		t.Fatalf("unexpected filename %#v", responseArtifacts[0])
	}
	if len(ledgerArtifacts) != 1 {
		t.Fatalf("expected 1 ledger artifact, got %#v", ledgerArtifacts)
	}
	if ledgerArtifacts[0].VirtualPath != "/mnt/user-data/outputs/summary.md" {
		t.Fatalf("unexpected virtual path %#v", ledgerArtifacts[0])
	}
}

func TestPublicAPIRunCollectorExtractsTextDeltaFromMessagesEvent(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)
	record := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": " OK",
				},
			},
			"tool_calls": []any{},
		},
		map[string]any{
			"thread_id": "thread-1",
		},
	})

	if len(record.RunEvents) != 1 {
		t.Fatalf("expected 1 run event, got %#v", record.RunEvents)
	}
	if record.RunEvents[0].Type != "assistant_delta" {
		t.Fatalf("unexpected run event type %q", record.RunEvents[0].Type)
	}
	if record.RunEvents[0].Delta != " OK" {
		t.Fatalf("unexpected text delta %q", record.RunEvents[0].Delta)
	}
}

func TestPublicAPIRunCollectorConvertsCumulativeTextSnapshotsToDeltas(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)
	first := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "正在检索",
				},
			},
			"tool_calls": []any{},
		},
	})
	if len(first.RunEvents) != 1 || first.RunEvents[0].Delta != "正在检索" {
		t.Fatalf("expected first text delta, got %#v", first.RunEvents)
	}

	replay := collector.consume("values", map[string]any{
		"messages": []any{
			map[string]any{
				"type": "ai",
				"id":   "msg_current",
				"content": []any{
					map[string]any{
						"type": "text",
						"text": "正在检索",
					},
				},
			},
		},
	})
	if len(replay.RunEvents) != 0 {
		t.Fatalf("expected duplicate cumulative snapshot to be suppressed, got %#v", replay.RunEvents)
	}

	extended := collector.consume("messages-tuple", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"id":   "msg_current",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "正在检索知识库",
				},
			},
			"tool_calls": []any{},
		},
	})
	if len(extended.RunEvents) != 1 || extended.RunEvents[0].Delta != "知识库" {
		t.Fatalf("expected only appended text delta, got %#v", extended.RunEvents)
	}
}

func TestPublicAPIRunCollectorDropsSummarizationChunks(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)
	record := collector.consume("messages-tuple", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"content": []any{
				map[string]any{
					"type": "text",
					"text": "内部压缩摘要",
				},
			},
			"tool_calls": []any{},
		},
		map[string]any{
			"lc_source": "summarization",
		},
	})

	if len(record.RunEvents) != 0 {
		t.Fatalf("expected summarization chunks to be hidden, got %#v", record.RunEvents)
	}
}

func TestBuildResponseRunEventsKeepsV1BudgetOrdered(t *testing.T) {
	t.Parallel()

	invocation := &model.PublicAPIInvocation{
		ResponseID: "resp_test",
		CreatedAt:  time.Unix(42, 0).UTC(),
	}
	runtimeEvents := []model.PublicAPIRunEvent{
		{EventIndex: 2, CreatedAt: 43, Type: "tool_started", ResponseID: "resp_test", ToolName: "bash"},
		{EventIndex: 3, CreatedAt: 44, Type: "tool_finished", ResponseID: "resp_test", ToolName: "bash"},
	}

	events := buildResponseRunEvents(invocation, runtimeEvents, "done")
	if len(events) != 5 {
		t.Fatalf("expected 5 run events, got %#v", events)
	}
	if events[0].Type != "run_started" || events[0].EventIndex != 1 {
		t.Fatalf("unexpected first event %#v", events[0])
	}
	if events[3].Type != "assistant_message" || events[3].EventIndex != 4 {
		t.Fatalf("unexpected assistant terminal event %#v", events[3])
	}
	if events[4].Type != "run_completed" || events[4].EventIndex != 5 {
		t.Fatalf("unexpected completion event %#v", events[4])
	}
}

func TestBuildInterruptedRunEventsKeepsRunStartedWithoutTerminalCompletion(t *testing.T) {
	t.Parallel()

	invocation := &model.PublicAPIInvocation{
		ResponseID: "resp_test",
		CreatedAt:  time.Unix(42, 0).UTC(),
	}
	runtimeEvents := []model.PublicAPIRunEvent{
		{EventIndex: 2, CreatedAt: 43, Type: model.PublicAPIToolStarted, ToolName: "question"},
		{EventIndex: 3, CreatedAt: 44, Type: model.PublicAPIToolFinished, ToolName: "question"},
		{EventIndex: 4, CreatedAt: 45, Type: model.PublicAPIQuestionRequested, QuestionID: "call_123"},
	}

	events := buildInterruptedRunEvents(invocation, runtimeEvents)
	if len(events) != 4 {
		t.Fatalf("expected 4 run events, got %#v", events)
	}
	if events[0].Type != model.PublicAPIRunStarted || events[0].EventIndex != 1 {
		t.Fatalf("unexpected first event %#v", events[0])
	}
	if events[len(events)-1].Type != model.PublicAPIQuestionRequested {
		t.Fatalf("unexpected final event %#v", events[len(events)-1])
	}
}

func TestPublicAPIRunCollectorMapsToolExecutionCustomEvents(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)
	record := collector.consume("custom", map[string]any{
		"type":       "execution_event",
		"event":      "phase_started",
		"phase_kind": "tool",
		"tool_name":  "execute",
	})

	if len(record.RunEvents) != 0 {
		t.Fatalf("expected no public run event for execution-only tool phase, got %#v", record.RunEvents)
	}
}

func TestPublicAPIRunCollectorExtractsToolArgumentsAndOutputFromMessages(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)
	startRecord := collector.consume("messages", []any{
		map[string]any{
			"type":    "AIMessageChunk",
			"content": []any{},
			"tool_calls": []any{
				map[string]any{
					"id":   "call_123",
					"name": "grep_files",
					"args": map[string]any{
						"pattern": "夏仲奇",
					},
				},
			},
		},
		map[string]any{
			"thread_id": "thread-1",
		},
	})
	if len(startRecord.RunEvents) != 1 {
		t.Fatalf("expected 1 tool-start event, got %#v", startRecord.RunEvents)
	}
	if startRecord.RunEvents[0].Type != model.PublicAPIToolStarted {
		t.Fatalf("unexpected tool-start event %#v", startRecord.RunEvents[0])
	}
	if args, ok := startRecord.RunEvents[0].ToolArgs.(map[string]any); !ok || fmt.Sprint(args["pattern"]) != "夏仲奇" {
		t.Fatalf("unexpected tool args %#v", startRecord.RunEvents[0].ToolArgs)
	}

	finishRecord := collector.consume("messages", []any{
		map[string]any{
			"type":         "tool",
			"name":         "grep_files",
			"tool_call_id": "call_123",
			"content":      "{\"items\":[{\"path\":\"a.md\"}]}",
		},
		map[string]any{
			"thread_id": "thread-1",
		},
	})
	if len(finishRecord.RunEvents) != 1 {
		t.Fatalf("expected 1 tool-finished event, got %#v", finishRecord.RunEvents)
	}
	if finishRecord.RunEvents[0].Type != model.PublicAPIToolFinished {
		t.Fatalf("unexpected tool-finished event %#v", finishRecord.RunEvents[0])
	}
	if fmt.Sprint(finishRecord.RunEvents[0].ToolOutput) != "{\"items\":[{\"path\":\"a.md\"}]}" {
		t.Fatalf("unexpected tool output %#v", finishRecord.RunEvents[0].ToolOutput)
	}
}

func TestPublicAPIRunCollectorRecoversToolArgumentsFromToolUsePartialJSON(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)
	startRecord := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"content": []any{
				map[string]any{
					"type":         "tool_use",
					"id":           "call_456",
					"name":         "grep_files",
					"input":        map[string]any{},
					"partial_json": `{"limit":50,"pattern":"夏仲奇"}`,
				},
			},
			"tool_calls": []any{
				map[string]any{
					"id":        "call_456",
					"name":      "grep_files",
					"arguments": map[string]any{},
				},
			},
		},
		map[string]any{
			"thread_id": "thread-1",
		},
	})
	if len(startRecord.RunEvents) != 1 {
		t.Fatalf("expected 1 tool-start event, got %#v", startRecord.RunEvents)
	}
	if startRecord.RunEvents[0].Type != model.PublicAPIToolStarted {
		t.Fatalf("unexpected tool-start event %#v", startRecord.RunEvents[0])
	}
	args, ok := startRecord.RunEvents[0].ToolArgs.(map[string]any)
	if !ok {
		t.Fatalf("expected recovered tool args map, got %#v", startRecord.RunEvents[0].ToolArgs)
	}
	if fmt.Sprint(args["pattern"]) != "夏仲奇" || fmt.Sprint(args["limit"]) != "50" {
		t.Fatalf("unexpected recovered tool args %#v", startRecord.RunEvents[0].ToolArgs)
	}
}

func TestPublicAPIRunCollectorDefersEmptyToolArgsUntilValuesSnapshot(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)
	startRecord := collector.consume("messages", []any{
		map[string]any{
			"type": "AIMessageChunk",
			"content": []any{
				map[string]any{
					"type":  "tool_use",
					"id":    "call_789",
					"name":  "grep_files",
					"input": map[string]any{},
				},
			},
			"tool_calls": []any{
				map[string]any{
					"id":   "call_789",
					"name": "grep_files",
					"args": map[string]any{},
				},
			},
		},
	})
	if len(startRecord.RunEvents) != 0 {
		t.Fatalf("expected no tool-start event before values snapshot, got %#v", startRecord.RunEvents)
	}

	valuesRecord := collector.consume("values", map[string]any{
		"messages": []any{
			map[string]any{
				"type":    "ai",
				"content": []any{},
				"tool_calls": []any{
					map[string]any{
						"id":   "call_789",
						"name": "grep_files",
						"args": map[string]any{
							"pattern": "夏仲奇",
							"limit":   50,
						},
					},
				},
			},
		},
	})
	if len(valuesRecord.RunEvents) != 1 {
		t.Fatalf("expected values snapshot to emit tool-start event, got %#v", valuesRecord.RunEvents)
	}
	args, ok := valuesRecord.RunEvents[0].ToolArgs.(map[string]any)
	if !ok {
		t.Fatalf("expected recovered values tool args map, got %#v", valuesRecord.RunEvents[0].ToolArgs)
	}
	if fmt.Sprint(args["pattern"]) != "夏仲奇" || fmt.Sprint(args["limit"]) != "50" {
		t.Fatalf("unexpected values tool args %#v", valuesRecord.RunEvents[0].ToolArgs)
	}
}

func TestPublicAPIRunCollectorMapsInterruptUpdatesToQuestionRequests(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)
	record := collector.consume("updates", map[string]any{
		"__interrupt__": []any{
			map[string]any{
				"value": map[string]any{
					"request_id": "question-123",
				},
			},
		},
	})

	if len(record.RunEvents) != 1 {
		t.Fatalf("expected 1 run event, got %#v", record.RunEvents)
	}
	if record.RunEvents[0].Type != model.PublicAPIQuestionRequested {
		t.Fatalf("unexpected run event type %#v", record.RunEvents[0].Type)
	}
	if record.RunEvents[0].QuestionID != "question-123" {
		t.Fatalf("unexpected question identifier %#v", record.RunEvents[0].QuestionID)
	}
}

func TestPublicAPIRunCollectorDropsDuplicateUnmatchedToolFinish(t *testing.T) {
	t.Parallel()

	collector := newPublicAPIRunCollector(1)

	started := collector.consume("custom", map[string]any{
		"type":       "execution_event",
		"event":      "phase_started",
		"phase_kind": "tool",
		"tool_name":  "question",
	})
	if len(started.RunEvents) != 0 {
		t.Fatalf("expected tool phase start to stay internal, got %#v", started.RunEvents)
	}

	finished := collector.consume("custom", map[string]any{
		"type":       "execution_event",
		"event":      "phase_finished",
		"phase_kind": "tool",
		"tool_name":  "question",
	})
	if len(finished.RunEvents) != 0 {
		t.Fatalf("expected tool phase finish to stay internal, got %#v", finished.RunEvents)
	}

	duplicate := collector.consume("custom", map[string]any{
		"type":       "execution_event",
		"event":      "phase_finished",
		"phase_kind": "tool",
		"tool_name":  "question",
	})
	if len(duplicate.RunEvents) != 0 {
		t.Fatalf("expected duplicate tool finish to be dropped, got %#v", duplicate.RunEvents)
	}
}
