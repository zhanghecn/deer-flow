package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type stubPublicAPIModelRepo struct {
	enabled map[string]bool
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

	collector := newPublicAPIRunCollector()
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

	if record.OpenAgentsEvent.Category != "assistant.message" {
		t.Fatalf("unexpected category %q", record.OpenAgentsEvent.Category)
	}
	if record.TextDelta != " OK" {
		t.Fatalf("unexpected text delta %q", record.TextDelta)
	}
}
