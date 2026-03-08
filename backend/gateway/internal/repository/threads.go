package repository

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
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
			updated_at
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
		if err := rows.Scan(&item.ThreadID, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.Values = nil
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
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
