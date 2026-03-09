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
	ThreadID  string     `json:"thread_id"`
	UpdatedAt *time.Time `json:"updated_at"`
	Values    any        `json:"values"`
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
			title
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
		if err := rows.Scan(&item.ThreadID, &item.UpdatedAt, &title); err != nil {
			return nil, err
		}
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
