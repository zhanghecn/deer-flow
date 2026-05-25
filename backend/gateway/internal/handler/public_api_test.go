package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
)

func TestPublicAPIInvocationFilterFromQueryIncludesThreadScopedAuditFields(t *testing.T) {
	t.Parallel()

	tokenID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/public-api/invocations?agent_name=demo-agent&thread_id=thread-1&session_id=session-1&surface=turns&finished_only=true&limit=1&offset=2&api_token_id="+tokenID.String(),
		nil,
	)

	filter, err := publicAPIInvocationFilterFromQuery(context)
	if err != nil {
		t.Fatalf("parse invocation filter: %v", err)
	}

	if filter.APITokenID == nil || *filter.APITokenID != tokenID {
		t.Fatalf("api token filter = %#v, want %s", filter.APITokenID, tokenID)
	}
	if filter.AgentName != "demo-agent" {
		t.Fatalf("agent filter = %q", filter.AgentName)
	}
	if filter.ThreadID != "thread-1" {
		t.Fatalf("thread filter = %q", filter.ThreadID)
	}
	if filter.SessionID != "session-1" {
		t.Fatalf("session filter = %q", filter.SessionID)
	}
	if filter.Surface != "turns" {
		t.Fatalf("surface filter = %q", filter.Surface)
	}
	if !filter.FinishedOnly {
		t.Fatal("expected finished-only filter")
	}
	if filter.Limit != 1 || filter.Offset != 2 {
		t.Fatalf("pagination = limit %d offset %d", filter.Limit, filter.Offset)
	}
}

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
