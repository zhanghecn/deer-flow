package repository

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ThreadRepo struct {
	pool *pgxpool.Pool
}

func NewThreadRepo(pool *pgxpool.Pool) *ThreadRepo {
	return &ThreadRepo{pool: pool}
}

type ThreadSearchOptions struct {
	Limit     int
	Offset    int
	SortBy    string
	SortOrder string
}

type ThreadSearchRecord struct {
	ThreadID         string     `json:"thread_id"`
	UpdatedAt        *time.Time `json:"updated_at"`
	Values           any        `json:"values"`
	AgentName        *string    `json:"agent_name,omitempty"`
	AgentStatus      string     `json:"agent_status"`
	ExecutionBackend *string    `json:"execution_backend,omitempty"`
	RemoteSessionID  *string    `json:"remote_session_id,omitempty"`
	ModelName        *string    `json:"model_name,omitempty"`
}

type ThreadRuntimeRecord struct {
	ThreadID         string  `json:"thread_id"`
	AgentName        *string `json:"agent_name,omitempty"`
	AgentStatus      string  `json:"agent_status"`
	ExecutionBackend *string `json:"execution_backend,omitempty"`
	RemoteSessionID  *string `json:"remote_session_id,omitempty"`
	ModelName        *string `json:"model_name,omitempty"`
}

func (r *ThreadRepo) SearchByUser(
	ctx context.Context,
	userID uuid.UUID,
	opts ThreadSearchOptions,
) ([]ThreadSearchRecord, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset := opts.Offset
	if offset < 0 {
		offset = 0
	}

	sortBy := normalizeThreadSortBy(opts.SortBy)
	sortOrder := normalizeThreadSortOrder(opts.SortOrder)

	query := `
		SELECT
			thread_id,
			updated_at,
			title,
			agent_name,
			agent_status,
			execution_backend,
			remote_session_id,
			model_name
		FROM thread_bindings
		WHERE user_id = $1
		ORDER BY ` + sortBy + ` ` + sortOrder + `
		LIMIT $2 OFFSET $3
	`
	rows, err := r.pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]ThreadSearchRecord, 0)
	for rows.Next() {
		var item ThreadSearchRecord
		var title *string
		var agentName *string
		var agentStatus *string
		var executionBackend *string
		var remoteSessionID *string
		var modelName *string
		if err := rows.Scan(
			&item.ThreadID,
			&item.UpdatedAt,
			&title,
			&agentName,
			&agentStatus,
			&executionBackend,
			&remoteSessionID,
			&modelName,
		); err != nil {
			return nil, err
		}
		item.AgentName = normalizeOptionalThreadText(agentName)
		item.AgentStatus = normalizeThreadAgentStatus(agentStatus)
		item.ExecutionBackend = normalizeThreadExecutionBackend(executionBackend)
		item.RemoteSessionID = normalizeOptionalThreadText(remoteSessionID)
		item.ModelName = normalizeOptionalThreadText(modelName)
		if title != nil {
			trimmedTitle := strings.TrimSpace(*title)
			if trimmedTitle != "" {
				item.Values = map[string]any{"title": trimmedTitle}
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *ThreadRepo) GetRuntimeByUser(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
) (*ThreadRuntimeRecord, error) {
	query := `
		SELECT
			thread_id,
			agent_name,
			agent_status,
			execution_backend,
			remote_session_id,
			model_name
		FROM thread_bindings
		WHERE thread_id = $1 AND user_id = $2
		LIMIT 1
	`

	row := r.pool.QueryRow(ctx, query, threadID, userID)
	var record ThreadRuntimeRecord
	var agentName *string
	var agentStatus *string
	var executionBackend *string
	var remoteSessionID *string
	var modelName *string
	if err := row.Scan(
		&record.ThreadID,
		&agentName,
		&agentStatus,
		&executionBackend,
		&remoteSessionID,
		&modelName,
	); err != nil {
		return nil, err
	}

	record.AgentName = normalizeOptionalThreadText(agentName)
	record.AgentStatus = normalizeThreadAgentStatus(agentStatus)
	record.ExecutionBackend = normalizeThreadExecutionBackend(executionBackend)
	record.RemoteSessionID = normalizeOptionalThreadText(remoteSessionID)
	record.ModelName = normalizeOptionalThreadText(modelName)
	return &record, nil
}

func (r *ThreadRepo) ListIDsByUser(
	ctx context.Context,
	userID uuid.UUID,
) ([]string, error) {
	rows, err := r.pool.Query(
		ctx,
		`SELECT thread_id FROM thread_bindings WHERE user_id = $1 ORDER BY updated_at DESC, thread_id DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	threadIDs := make([]string, 0)
	for rows.Next() {
		var threadID string
		if err := rows.Scan(&threadID); err != nil {
			return nil, err
		}
		threadIDs = append(threadIDs, threadID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return threadIDs, nil
}

func (r *ThreadRepo) UpdateTitle(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
	title string,
) error {
	trimmedTitle := strings.TrimSpace(title)
	if trimmedTitle == "" {
		return pgx.ErrNoRows
	}

	tag, err := r.pool.Exec(
		ctx,
		`UPDATE thread_bindings SET title = $1, updated_at = NOW() WHERE thread_id = $2 AND user_id = $3`,
		trimmedTitle,
		threadID,
		userID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ThreadRepo) DeleteByUser(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
) error {
	tag, err := r.pool.Exec(
		ctx,
		`DELETE FROM thread_bindings WHERE thread_id = $1 AND user_id = $2`,
		threadID,
		userID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func normalizeThreadSortBy(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "thread_id":
		return "thread_id"
	case "created_at":
		return "created_at"
	case "updated_at":
		return "updated_at"
	default:
		return "updated_at"
	}
}

func normalizeThreadSortOrder(raw string) string {
	if strings.EqualFold(strings.TrimSpace(raw), "asc") {
		return "ASC"
	}
	return "DESC"
}

func normalizeOptionalThreadText(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizeThreadAgentStatus(value *string) string {
	if value != nil && strings.EqualFold(strings.TrimSpace(*value), "prod") {
		return "prod"
	}
	return "dev"
}

func normalizeThreadExecutionBackend(value *string) *string {
	if value != nil && strings.EqualFold(strings.TrimSpace(*value), "remote") {
		normalized := "remote"
		return &normalized
	}
	return nil
}
