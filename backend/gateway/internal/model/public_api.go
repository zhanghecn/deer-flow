package model

import (
	"encoding/json"

	"github.com/google/uuid"
)

// PublicAPIResponsesRequest is the canonical external request shape. The raw
// JSON payloads remain available so the gateway can preserve the northbound
// contract exactly in the audit ledger.
type PublicAPIResponsesRequest struct {
	Model              string                `json:"model" binding:"required"`
	Input              json.RawMessage       `json:"input" binding:"required"`
	PreviousResponseID string                `json:"previous_response_id,omitempty"`
	Metadata           json.RawMessage       `json:"metadata,omitempty"`
	Stream             bool                  `json:"stream,omitempty"`
	Text               *PublicAPITextOptions `json:"text,omitempty"`
	Reasoning          *PublicAPIReasoning   `json:"reasoning,omitempty"`
	MaxOutputTokens    *int                  `json:"max_output_tokens,omitempty"`
}

type PublicAPITextOptions struct {
	Format *PublicAPITextFormat `json:"format,omitempty"`
}

type PublicAPITextFormat struct {
	Type   string          `json:"type"`
	Name   string          `json:"name,omitempty"`
	Schema json.RawMessage `json:"schema,omitempty"`
	Strict bool            `json:"strict,omitempty"`
}

// PublicAPIReasoning keeps the northbound shape explicit even though the
// runtime currently only guarantees thinking enablement plus best-effort effort
// forwarding. Unsupported values are rejected instead of being ignored.
type PublicAPIReasoning struct {
	Effort  string `json:"effort,omitempty"`
	Summary string `json:"summary,omitempty"`
}

// PublicAPIChatCompletionsRequest is a compatibility adapter. The gateway maps
// it into the canonical responses flow instead of keeping a second execution
// path.
type PublicAPIChatCompletionsRequest struct {
	Model               string                       `json:"model" binding:"required"`
	Messages            []PublicAPIChatMessage       `json:"messages" binding:"required"`
	Metadata            json.RawMessage              `json:"metadata,omitempty"`
	Stream              bool                         `json:"stream,omitempty"`
	ResponseFormat      *PublicAPIChatResponseFormat `json:"response_format,omitempty"`
	ReasoningEffort     string                       `json:"reasoning_effort,omitempty"`
	MaxCompletionTokens *int                         `json:"max_completion_tokens,omitempty"`
	MaxTokens           *int                         `json:"max_tokens,omitempty"`
	StreamOptions       *PublicAPIChatStreamOptions  `json:"stream_options,omitempty"`
}

type PublicAPIChatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type PublicAPIChatResponseFormat struct {
	Type       string                   `json:"type"`
	JSONSchema *PublicAPIChatJSONSchema `json:"json_schema,omitempty"`
}

type PublicAPIChatJSONSchema struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
	Strict bool            `json:"strict,omitempty"`
}

type PublicAPIChatStreamOptions struct {
	IncludeUsage bool `json:"include_usage,omitempty"`
}

type PublicAPIModelCard struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

type PublicAPIModelsResponse struct {
	Object string               `json:"object"`
	Data   []PublicAPIModelCard `json:"data"`
}

type PublicAPIResponseArtifact struct {
	ID          string  `json:"id"`
	Object      string  `json:"object"`
	Filename    string  `json:"filename"`
	MimeType    *string `json:"mime_type,omitempty"`
	Bytes       *int64  `json:"bytes,omitempty"`
	DownloadURL string  `json:"download_url"`
}

type PublicAPIFileObject struct {
	ID        string  `json:"id"`
	Object    string  `json:"object"`
	Bytes     int64   `json:"bytes"`
	CreatedAt int64   `json:"created_at"`
	Filename  string  `json:"filename"`
	Purpose   string  `json:"purpose"`
	MimeType  *string `json:"mime_type,omitempty"`
	Status    string  `json:"status,omitempty"`
}

type PublicAPIRunEventType string

const (
	PublicAPIRunStarted        PublicAPIRunEventType = "run_started"
	PublicAPIAssistantDelta    PublicAPIRunEventType = "assistant_delta"
	PublicAPIAssistantMessage  PublicAPIRunEventType = "assistant_message"
	PublicAPIToolStarted       PublicAPIRunEventType = "tool_started"
	PublicAPIToolFinished      PublicAPIRunEventType = "tool_finished"
	PublicAPIQuestionRequested PublicAPIRunEventType = "question_requested"
	PublicAPIQuestionAnswered  PublicAPIRunEventType = "question_answered"
	PublicAPIRunCompleted      PublicAPIRunEventType = "run_completed"
	PublicAPIRunFailed         PublicAPIRunEventType = "run_failed"
)

// PublicAPIRunEvent is the stable live event contract for public consumers.
// Keep this v1 event budget intentionally small so the gateway does not freeze
// raw LangGraph internals into the long-lived public API surface.
type PublicAPIRunEvent struct {
	EventIndex int                   `json:"event_index"`
	CreatedAt  int64                 `json:"created_at"`
	Type       PublicAPIRunEventType `json:"type"`
	ResponseID string                `json:"response_id,omitempty"`
	Delta      string                `json:"delta,omitempty"`
	Text       string                `json:"text,omitempty"`
	ToolName   string                `json:"tool_name,omitempty"`
	ToolArgs   any                   `json:"tool_arguments,omitempty"`
	ToolOutput any                   `json:"tool_output,omitempty"`
	Error      string                `json:"error,omitempty"`
	QuestionID string                `json:"question_id,omitempty"`
}

type PublicAPIResponseReasoningSummary struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type PublicAPIResponseReasoning struct {
	Effort  string                              `json:"effort,omitempty"`
	Summary []PublicAPIResponseReasoningSummary `json:"summary,omitempty"`
}

type PublicAPIResponseOpenAgents struct {
	ThreadID           string              `json:"thread_id"`
	TraceID            string              `json:"trace_id,omitempty"`
	PreviousResponseID string              `json:"previous_response_id,omitempty"`
	RunEvents          []PublicAPIRunEvent `json:"run_events,omitempty"`
}

type PublicAPIInvocationFilter struct {
	APITokenID *uuid.UUID
	AgentName  string
	Limit      int
	Offset     int
}
