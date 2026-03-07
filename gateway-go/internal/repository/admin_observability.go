package repository

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminObservabilityRepo struct {
	pool *pgxpool.Pool
}

func NewAdminObservabilityRepo(pool *pgxpool.Pool) *AdminObservabilityRepo {
	return &AdminObservabilityRepo{pool: pool}
}

type AgentTraceRecord struct {
	TraceID      string          `json:"trace_id"`
	RootRunID    string          `json:"root_run_id"`
	ThreadID     *string         `json:"thread_id"`
	UserID       *uuid.UUID      `json:"user_id"`
	AgentName    *string         `json:"agent_name"`
	ModelName    *string         `json:"model_name"`
	StartedAt    time.Time       `json:"started_at"`
	FinishedAt   *time.Time      `json:"finished_at"`
	Status       string          `json:"status"`
	InputTokens  int64           `json:"input_tokens"`
	OutputTokens int64           `json:"output_tokens"`
	TotalTokens  int64           `json:"total_tokens"`
	Error        *string         `json:"error"`
	Metadata     json.RawMessage `json:"metadata"`
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
	Title       *string    `json:"title"`
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
		WHERE ($1::uuid IS NULL OR user_id = $1::uuid)
		  AND ($2 = '' OR agent_name = $2)
		  AND ($3 = '' OR thread_id = $3)
		ORDER BY started_at DESC
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
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
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
			COALESCE(r.thread_id, o.thread_id, t.id) AS thread_id,
			COALESCE(r.user_id, o.user_id, t.user_id) AS user_id,
			r.agent_name,
			r.model_name,
			o.assistant_id,
			t.title,
			COALESCE(r.updated_at, o.updated_at, t.updated_at) AS updated_at
		FROM thread_runtime_configs r
		FULL OUTER JOIN thread_ownerships o
			ON o.thread_id = r.thread_id
		FULL OUTER JOIN threads t
			ON t.id = COALESCE(r.thread_id, o.thread_id)
		ORDER BY updated_at DESC NULLS LAST
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
			&item.Title,
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
	UserCount     int64 `json:"user_count"`
	TraceCount    int64 `json:"trace_count"`
	TotalTokensIn int64 `json:"total_tokens_in"`
	TotalTokensOut int64 `json:"total_tokens_out"`
	ThreadCount   int64 `json:"thread_count"`
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

	// Thread count (from thread_runtime_configs as the primary source)
	err = r.pool.QueryRow(ctx,
		`SELECT COUNT(DISTINCT COALESCE(r.thread_id, o.thread_id))
		 FROM thread_runtime_configs r
		 FULL OUTER JOIN thread_ownerships o ON o.thread_id = r.thread_id`,
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
