package model

import "encoding/json"

type TurnEventType string
type TurnFailureStage string

const (
	TurnEventTurnStarted               TurnEventType = "turn.started"
	TurnEventAssistantMessageStarted   TurnEventType = "assistant.message.started"
	TurnEventAssistantTextDelta        TurnEventType = "assistant.text.delta"
	TurnEventAssistantReasoningDelta   TurnEventType = "assistant.reasoning.delta"
	TurnEventToolCallStarted           TurnEventType = "tool.call.started"
	TurnEventToolCallCompleted         TurnEventType = "tool.call.completed"
	TurnEventContextCompacted          TurnEventType = "context.compacted"
	TurnEventTurnRequiresInput         TurnEventType = "turn.requires_input"
	TurnEventAssistantMessageCompleted TurnEventType = "assistant.message.completed"
	TurnEventTurnCompleted             TurnEventType = "turn.completed"
	TurnEventTurnFailed                TurnEventType = "turn.failed"

	TurnFailureStagePrepareRun      TurnFailureStage = "prepare_run"
	TurnFailureStageStreamExecution TurnFailureStage = "stream_execution"
	TurnFailureStageStateFetch      TurnFailureStage = "state_fetch"
	TurnFailureStageSnapshotBuild   TurnFailureStage = "snapshot_build"
)

type TurnThinkingConfig struct {
	Enabled bool   `json:"enabled"`
	Effort  string `json:"effort,omitempty"`
}

// TurnInput keeps the public SDK payload small and explicit: plain text plus
// optional uploaded file ids. Search/file access belongs in MCP tools, not in
// the northbound API shape.
type TurnInput struct {
	Text    string   `json:"text"`
	FileIDs []string `json:"file_ids,omitempty"`
}

type TurnCreateRequest struct {
	Agent          string    `json:"agent" binding:"required"`
	Input          TurnInput `json:"input" binding:"required"`
	SessionID      string    `json:"session_id,omitempty"`
	PreviousTurnID string    `json:"previous_turn_id,omitempty"`
	// External SDK callers can pre-attach existing knowledge bases before the
	// first runtime turn. The service stores these in the same thread binding
	// table used by the workspace UI so there is one knowledge attachment truth.
	KnowledgeBaseIDs []string        `json:"knowledge_base_ids,omitempty"`
	Metadata         json.RawMessage `json:"metadata,omitempty"`
	Stream           bool            `json:"stream,omitempty"`
	// Reuse the existing public text format contract so native `/v1/turns`
	// keeps structured-output parity with the compatibility surfaces instead of
	// quietly dropping JSON schema requests in the workspace console or SDKs.
	Text            *PublicAPITextOptions `json:"text,omitempty"`
	Thinking        *TurnThinkingConfig   `json:"thinking,omitempty"`
	MaxOutputTokens *int                  `json:"max_output_tokens,omitempty"`
}

type TurnUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
	TotalTokens  int64 `json:"total_tokens"`
}

type TurnEvent struct {
	Sequence      int              `json:"sequence"`
	CreatedAt     int64            `json:"created_at"`
	TurnID        string           `json:"turn_id,omitempty"`
	Type          TurnEventType    `json:"type"`
	Status        string           `json:"status,omitempty"`
	MessageID     string           `json:"message_id,omitempty"`
	ToolCallID    string           `json:"tool_call_id,omitempty"`
	ToolName      string           `json:"tool_name,omitempty"`
	Delta         string           `json:"delta,omitempty"`
	Text          string           `json:"text,omitempty"`
	Reasoning     string           `json:"reasoning,omitempty"`
	Error         string           `json:"error,omitempty"`
	Stage         TurnFailureStage `json:"stage,omitempty"`
	Retryable     *bool            `json:"retryable,omitempty"`
	Code          string           `json:"code,omitempty"`
	ToolArguments any              `json:"tool_arguments,omitempty"`
	ToolOutput    any              `json:"tool_output,omitempty"`
	// Context compaction events expose only stable metrics. The raw summary text
	// remains an observability/debug concern and is intentionally not part of the
	// public chat stream.
	ContextBeforeTokens *int64 `json:"context_before_tokens,omitempty"`
	ContextAfterTokens  *int64 `json:"context_after_tokens,omitempty"`
	ContextMaxTokens    *int64 `json:"context_max_tokens,omitempty"`
	SummaryCount        *int   `json:"summary_count,omitempty"`
}

type TurnSnapshot struct {
	ID             string                      `json:"id"`
	Object         string                      `json:"object"`
	Status         string                      `json:"status"`
	Agent          string                      `json:"agent"`
	SessionID      string                      `json:"session_id,omitempty"`
	ThreadID       string                      `json:"thread_id"`
	TraceID        string                      `json:"trace_id,omitempty"`
	PreviousTurnID string                      `json:"previous_turn_id,omitempty"`
	OutputText     string                      `json:"output_text"`
	ReasoningText  string                      `json:"reasoning_text"`
	Artifacts      []PublicAPIResponseArtifact `json:"artifacts,omitempty"`
	Usage          TurnUsage                   `json:"usage"`
	Metadata       map[string]any              `json:"metadata,omitempty"`
	Events         []TurnEvent                 `json:"events"`
	CreatedAt      int64                       `json:"created_at"`
	CompletedAt    int64                       `json:"completed_at,omitempty"`
}

type TurnHistoryItem struct {
	TurnSnapshot
	// Input is recovered from the stored request ledger so external SDK demos
	// can rebuild visible chat history without storing message bodies locally.
	Input TurnInput `json:"input"`
}

type TurnListResponse struct {
	Object string            `json:"object"`
	Data   []TurnHistoryItem `json:"data"`
}
