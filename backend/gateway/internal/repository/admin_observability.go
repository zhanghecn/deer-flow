package repository

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminObservabilityRepo struct {
	pool *pgxpool.Pool
}

func NewAdminObservabilityRepo(pool *pgxpool.Pool) *AdminObservabilityRepo {
	return &AdminObservabilityRepo{pool: pool}
}

type AgentTraceRecord struct {
	TraceID            string          `json:"trace_id"`
	RootRunID          string          `json:"root_run_id"`
	ThreadID           *string         `json:"thread_id"`
	UserID             *uuid.UUID      `json:"user_id"`
	AgentName          *string         `json:"agent_name"`
	ModelName          *string         `json:"model_name"`
	StartedAt          time.Time       `json:"started_at"`
	FinishedAt         *time.Time      `json:"finished_at"`
	Status             string          `json:"status"`
	InputTokens        int64           `json:"input_tokens"`
	OutputTokens       int64           `json:"output_tokens"`
	TotalTokens        int64           `json:"total_tokens"`
	Error              *string         `json:"error"`
	Metadata           json.RawMessage `json:"metadata"`
	ContextWindow      json.RawMessage `json:"context_window,omitempty"`
	InitialUserMessage *string         `json:"initial_user_message,omitempty"`
}

type AgentTraceEventRecord struct {
	ID           int64           `json:"id"`
	TraceID      string          `json:"trace_id"`
	EventIndex   int64           `json:"event_index"`
	RunID        string          `json:"run_id"`
	ParentRunID  *string         `json:"parent_run_id"`
	RunType      string          `json:"run_type"`
	EventType    string          `json:"event_type"`
	NodeName     *string         `json:"node_name"`
	ToolName     *string         `json:"tool_name"`
	TaskRunID    *string         `json:"task_run_id"`
	StartedAt    *time.Time      `json:"started_at"`
	FinishedAt   *time.Time      `json:"finished_at"`
	DurationMs   *int64          `json:"duration_ms"`
	InputTokens  *int64          `json:"input_tokens"`
	OutputTokens *int64          `json:"output_tokens"`
	TotalTokens  *int64          `json:"total_tokens"`
	Status       string          `json:"status"`
	Error        *string         `json:"error"`
	Payload      json.RawMessage `json:"payload"`
	CreatedAt    time.Time       `json:"created_at"`
}

type RuntimeThreadRecord struct {
	ThreadID    string     `json:"thread_id"`
	UserID      *uuid.UUID `json:"user_id"`
	AgentName   *string    `json:"agent_name"`
	ModelName   *string    `json:"model_name"`
	AssistantID *string    `json:"assistant_id"`
	CreatedAt   *time.Time `json:"created_at"`
	UpdatedAt   *time.Time `json:"updated_at"`
}

type CheckpointTableRecord struct {
	Name string `json:"name"`
}

func (r *AdminObservabilityRepo) ListTraces(
	ctx context.Context,
	userID *uuid.UUID,
	agentName string,
	threadID string,
	limit int,
	offset int,
) ([]AgentTraceRecord, error) {
	query := `
		SELECT
			t.trace_id,
			t.root_run_id,
			t.thread_id,
			t.user_id,
			t.agent_name,
			t.model_name,
			t.started_at,
			t.finished_at,
			t.status,
				t.input_tokens,
				t.output_tokens,
				t.total_tokens,
				t.error,
				t.metadata,
				first_event.payload,
				latest_context.context_window
			FROM agent_traces t
			LEFT JOIN LATERAL (
				SELECT payload
				FROM agent_trace_events e
				WHERE e.trace_id = t.trace_id
				  AND e.event_type = 'start'
				ORDER BY e.event_index ASC
				LIMIT 1
			) first_event ON TRUE
			LEFT JOIN LATERAL (
				-- List rows need compact counters, not the raw summary text that
				-- belongs in the trace-detail/debug payload.
				SELECT (e.payload->'context_window') #- '{last_summary,summary_preview}' AS context_window
				FROM agent_trace_events e
				WHERE e.trace_id = t.trace_id
				  AND e.payload ? 'context_window'
				ORDER BY e.event_index DESC
				LIMIT 1
			) latest_context ON TRUE
			WHERE ($1::uuid IS NULL OR t.user_id = $1::uuid)
			  AND ($2 = '' OR t.agent_name = $2)
			  AND ($3 = '' OR t.thread_id = $3)
			ORDER BY t.started_at DESC
			LIMIT $4 OFFSET $5
		`

	rows, err := r.pool.Query(ctx, query, userID, agentName, threadID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]AgentTraceRecord, 0)
	for rows.Next() {
		var item AgentTraceRecord
		var firstPayload json.RawMessage
		var contextWindow json.RawMessage
		if err := rows.Scan(
			&item.TraceID,
			&item.RootRunID,
			&item.ThreadID,
			&item.UserID,
			&item.AgentName,
			&item.ModelName,
			&item.StartedAt,
			&item.FinishedAt,
			&item.Status,
			&item.InputTokens,
			&item.OutputTokens,
			&item.TotalTokens,
			&item.Error,
			&item.Metadata,
			&firstPayload,
			&contextWindow,
		); err != nil {
			return nil, err
		}
		item.InitialUserMessage = extractInitialUserMessage(firstPayload)
		item.ContextWindow = normalizeJSONPayload(contextWindow)
		items = append(items, item)
	}
	return items, nil
}

func (r *AdminObservabilityRepo) FindLatestByThreadAndUser(
	ctx context.Context,
	threadID string,
	userID uuid.UUID,
) (*AgentTraceRecord, error) {
	row := r.pool.QueryRow(
		ctx,
		`SELECT
			trace_id,
			root_run_id,
			thread_id,
			user_id,
			agent_name,
			model_name,
			started_at,
			finished_at,
			status,
			input_tokens,
			output_tokens,
			total_tokens,
			error,
			metadata
		FROM agent_traces
		WHERE thread_id = $1 AND user_id = $2
		ORDER BY started_at DESC
		LIMIT 1`,
		threadID,
		userID,
	)

	var item AgentTraceRecord
	if err := row.Scan(
		&item.TraceID,
		&item.RootRunID,
		&item.ThreadID,
		&item.UserID,
		&item.AgentName,
		&item.ModelName,
		&item.StartedAt,
		&item.FinishedAt,
		&item.Status,
		&item.InputTokens,
		&item.OutputTokens,
		&item.TotalTokens,
		&item.Error,
		&item.Metadata,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *AdminObservabilityRepo) CountTraces(
	ctx context.Context,
	userID *uuid.UUID,
	agentName string,
	threadID string,
) (int64, error) {
	query := `
		SELECT COUNT(*)
		FROM agent_traces
		WHERE ($1::uuid IS NULL OR user_id = $1::uuid)
		  AND ($2 = '' OR agent_name = $2)
		  AND ($3 = '' OR thread_id = $3)
	`

	var total int64
	err := r.pool.QueryRow(ctx, query, userID, agentName, threadID).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total, nil
}

func (r *AdminObservabilityRepo) ListTraceEvents(ctx context.Context, traceID string) ([]AgentTraceEventRecord, error) {
	query := `
		SELECT
			id,
			trace_id,
			event_index,
			run_id,
			parent_run_id,
			run_type,
			event_type,
			node_name,
			tool_name,
			task_run_id,
			started_at,
			finished_at,
			duration_ms,
			input_tokens,
			output_tokens,
			total_tokens,
			status,
			error,
			payload,
			created_at
		FROM agent_trace_events
		WHERE trace_id = $1
		ORDER BY event_index ASC
	`

	rows, err := r.pool.Query(ctx, query, traceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]AgentTraceEventRecord, 0)
	for rows.Next() {
		var item AgentTraceEventRecord
		if err := rows.Scan(
			&item.ID,
			&item.TraceID,
			&item.EventIndex,
			&item.RunID,
			&item.ParentRunID,
			&item.RunType,
			&item.EventType,
			&item.NodeName,
			&item.ToolName,
			&item.TaskRunID,
			&item.StartedAt,
			&item.FinishedAt,
			&item.DurationMs,
			&item.InputTokens,
			&item.OutputTokens,
			&item.TotalTokens,
			&item.Status,
			&item.Error,
			&item.Payload,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *AdminObservabilityRepo) ListRuntimeThreads(ctx context.Context, limit int, offset int) ([]RuntimeThreadRecord, error) {
	query := `
		SELECT
			thread_id,
			user_id,
			agent_name,
			model_name,
			assistant_id,
			created_at,
			updated_at
		FROM thread_bindings
		ORDER BY updated_at DESC
		LIMIT $1 OFFSET $2
	`

	rows, err := r.pool.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]RuntimeThreadRecord, 0)
	for rows.Next() {
		var item RuntimeThreadRecord
		if err := rows.Scan(
			&item.ThreadID,
			&item.UserID,
			&item.AgentName,
			&item.ModelName,
			&item.AssistantID,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *AdminObservabilityRepo) ListCheckpointTables(ctx context.Context) ([]CheckpointTableRecord, error) {
	tables := []string{"checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"}
	query := `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_name = ANY($1)
		ORDER BY table_name ASC
	`

	rows, err := r.pool.Query(ctx, query, tables)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]CheckpointTableRecord, 0)
	for rows.Next() {
		var item CheckpointTableRecord
		if err := rows.Scan(&item.Name); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

// AdminStats holds aggregate statistics for the admin dashboard.
type AdminStats struct {
	UserCount      int64 `json:"user_count"`
	TraceCount     int64 `json:"trace_count"`
	TotalTokensIn  int64 `json:"total_tokens_in"`
	TotalTokensOut int64 `json:"total_tokens_out"`
	ThreadCount    int64 `json:"thread_count"`
}

func (r *AdminObservabilityRepo) GetStats(ctx context.Context) (*AdminStats, error) {
	stats := &AdminStats{}

	// User count
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&stats.UserCount)
	if err != nil {
		return nil, err
	}

	// Trace count + token aggregates
	err = r.pool.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)
		 FROM agent_traces`,
	).Scan(&stats.TraceCount, &stats.TotalTokensIn, &stats.TotalTokensOut)
	if err != nil {
		return nil, err
	}

	// Thread count
	err = r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM thread_bindings`,
	).Scan(&stats.ThreadCount)
	if err != nil {
		return nil, err
	}

	return stats, nil
}

func ParseTracePagination(limitRaw string, offsetRaw string) (limit int, offset int) {
	limit = 50
	offset = 0
	if parsed, err := parsePositiveInt(limitRaw); err == nil && parsed > 0 {
		if parsed > 200 {
			parsed = 200
		}
		limit = parsed
	}
	if parsed, err := parsePositiveInt(offsetRaw); err == nil && parsed >= 0 {
		offset = parsed
	}
	return limit, offset
}

func parsePositiveInt(raw string) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, strconv.ErrSyntax
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, err
	}
	return value, nil
}

var (
	singleQuotedTextPattern    = regexp.MustCompile(`'text'\s*:\s*'([^']*)'`)
	doubleQuotedTextPattern    = regexp.MustCompile(`"text"\s*:\s*"([^"]*)"`)
	singleQuotedContentPattern = regexp.MustCompile(`content='([^']*)'`)
	doubleQuotedContentPattern = regexp.MustCompile(`content="([^"]*)"`)
	unicodeEscapePattern       = regexp.MustCompile(`\\u([0-9a-fA-F]{4})`)
	hexEscapePattern           = regexp.MustCompile(`\\x([0-9a-fA-F]{2})`)
)

func normalizeJSONPayload(payload json.RawMessage) json.RawMessage {
	trimmed := strings.TrimSpace(string(payload))
	if trimmed == "" || trimmed == "null" || trimmed == "{}" {
		return nil
	}
	// Keep the compact-state shape from the trace payload unchanged, but omit
	// empty/null rows so API consumers can distinguish "not captured" from an
	// explicit context-window snapshot.
	return json.RawMessage(trimmed)
}

func extractInitialUserMessage(payload json.RawMessage) *string {
	if len(payload) == 0 {
		return nil
	}

	var root map[string]any
	if err := json.Unmarshal(payload, &root); err != nil {
		return nil
	}

	inputs, _ := root["inputs"].(map[string]any)
	if inputs == nil {
		return nil
	}

	messages, _ := inputs["messages"].([]any)
	if len(messages) == 0 {
		return nil
	}

	fallbackText := ""
	for _, rawMessage := range messages {
		if text := strings.TrimSpace(extractStringMessageText(rawMessage)); text != "" && fallbackText == "" {
			fallbackText = text
		}

		message, ok := rawMessage.(map[string]any)
		if !ok {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(stringValue(message["role"])))
		if role == "" {
			role = strings.ToLower(strings.TrimSpace(stringValue(message["type"])))
		}
		if role != "human" && role != "user" {
			continue
		}

		text := strings.TrimSpace(extractTextValue(message["content"]))
		if text == "" {
			continue
		}
		text = collapseWhitespace(text)
		text = truncatePreview(text, 140)
		return &text
	}

	if fallbackText != "" {
		fallbackText = collapseWhitespace(fallbackText)
		fallbackText = truncatePreview(fallbackText, 140)
		return &fallbackText
	}

	return nil
}

func extractStringMessageText(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return extractTextValue(text)
}

func extractTextValue(value any) string {
	switch typed := value.(type) {
	case string:
		return extractTraceText(typed)
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(extractTextValue(item))
			if text == "" {
				continue
			}
			parts = append(parts, text)
		}
		return strings.Join(parts, " ")
	case map[string]any:
		if text := strings.TrimSpace(stringValue(typed["text"])); text != "" {
			return decodeEscapedUnicode(text)
		}
		if text := strings.TrimSpace(stringValue(typed["content"])); text != "" {
			return decodeEscapedUnicode(text)
		}
		return ""
	default:
		return ""
	}
}

func extractTraceText(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	matches := append(
		collectRegexMatches(singleQuotedTextPattern, trimmed),
		collectRegexMatches(doubleQuotedTextPattern, trimmed)...,
	)
	if len(matches) > 0 {
		return strings.Join(matches, " ")
	}

	if match := singleQuotedContentPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		return decodeEscapedUnicode(strings.TrimSpace(match[1]))
	}
	if match := doubleQuotedContentPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		return decodeEscapedUnicode(strings.TrimSpace(match[1]))
	}

	return decodeEscapedUnicode(trimmed)
}

func collectRegexMatches(pattern *regexp.Regexp, value string) []string {
	allMatches := pattern.FindAllStringSubmatch(value, -1)
	if len(allMatches) == 0 {
		return nil
	}

	results := make([]string, 0, len(allMatches))
	for _, match := range allMatches {
		if len(match) < 2 {
			continue
		}
		text := decodeEscapedUnicode(strings.TrimSpace(match[1]))
		if text == "" {
			continue
		}
		results = append(results, text)
	}
	return results
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func decodeEscapedUnicode(value string) string {
	value = unicodeEscapePattern.ReplaceAllStringFunc(value, func(match string) string {
		hex := match[2:]
		code, err := strconv.ParseInt(hex, 16, 32)
		if err != nil {
			return match
		}
		return string(rune(code))
	})

	return hexEscapePattern.ReplaceAllStringFunc(value, func(match string) string {
		hex := match[2:]
		code, err := strconv.ParseInt(hex, 16, 32)
		if err != nil {
			return match
		}
		return string(rune(code))
	})
}

func collapseWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func truncatePreview(value string, maxLen int) string {
	// Trace previews are displayed in multilingual admin UIs, so truncate by
	// runes instead of bytes to avoid cutting through UTF-8 code points.
	runes := []rune(value)
	if len(runes) <= maxLen {
		return value
	}
	return string(runes[:maxLen-3]) + "..."
}
