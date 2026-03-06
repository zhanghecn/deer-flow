package repository

import (
	"context"
	"errors"

	"github.com/openagents/gateway/internal/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type APITokenRepo struct {
	pool *pgxpool.Pool
}

func NewAPITokenRepo(pool *pgxpool.Pool) *APITokenRepo {
	return &APITokenRepo{pool: pool}
}

func (r *APITokenRepo) Create(ctx context.Context, t *model.APIToken) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO api_tokens (id, user_id, token_hash, name, scopes, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		t.ID, t.UserID, t.TokenHash, t.Name, t.Scopes, t.ExpiresAt,
	)
	return err
}

func (r *APITokenRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]model.APIToken, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, name, scopes, last_used, expires_at, created_at
		 FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tokens []model.APIToken
	for rows.Next() {
		var t model.APIToken
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.Scopes, &t.LastUsed, &t.ExpiresAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, nil
}

func (r *APITokenRepo) FindByHash(ctx context.Context, hash string) (*model.APIToken, error) {
	t := &model.APIToken{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, token_hash, name, scopes, last_used, expires_at, created_at
		 FROM api_tokens WHERE token_hash = $1`, hash,
	).Scan(&t.ID, &t.UserID, &t.TokenHash, &t.Name, &t.Scopes, &t.LastUsed, &t.ExpiresAt, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

func (r *APITokenRepo) Delete(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM api_tokens WHERE id = $1 AND user_id = $2`, id, userID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *APITokenRepo) UpdateLastUsed(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE api_tokens SET last_used = NOW() WHERE id = $1`, id,
	)
	return err
}
