package repository

import (
	"context"
	"errors"

	"github.com/deer-flow/gateway/internal/model"
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

func (r *ThreadRepo) Upsert(ctx context.Context, t *model.Thread) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO threads (id, user_id, agent_id, title)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (id) DO UPDATE SET title = COALESCE(EXCLUDED.title, threads.title), updated_at = NOW()`,
		t.ID, t.UserID, t.AgentID, t.Title,
	)
	return err
}

func (r *ThreadRepo) FindByID(ctx context.Context, id string) (*model.Thread, error) {
	t := &model.Thread{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, agent_id, title, created_at, updated_at
		 FROM threads WHERE id = $1`, id,
	).Scan(&t.ID, &t.UserID, &t.AgentID, &t.Title, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

func (r *ThreadRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]model.Thread, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, agent_id, title, created_at, updated_at
		 FROM threads WHERE user_id = $1 ORDER BY updated_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var threads []model.Thread
	for rows.Next() {
		var t model.Thread
		if err := rows.Scan(&t.ID, &t.UserID, &t.AgentID, &t.Title, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		threads = append(threads, t)
	}
	return threads, nil
}
