package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LLMProviderKey represents a stored LLM provider API key.
type LLMProviderKey struct {
	ID           uuid.UUID  `json:"id"`
	ProviderName string     `json:"provider_name"`
	DisplayName  string     `json:"display_name"`
	APIKey       string     `json:"api_key"`
	BaseURL      *string    `json:"base_url"`
	IsActive     bool       `json:"is_active"`
	CreatedBy    *uuid.UUID `json:"created_by"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type LLMKeyRepo struct {
	pool *pgxpool.Pool
}

func NewLLMKeyRepo(pool *pgxpool.Pool) *LLMKeyRepo {
	return &LLMKeyRepo{pool: pool}
}

func (r *LLMKeyRepo) List(ctx context.Context) ([]LLMProviderKey, error) {
	query := `
		SELECT id, provider_name, display_name, api_key, base_url, is_active, created_by, created_at, updated_at
		FROM llm_provider_keys
		ORDER BY created_at DESC
	`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]LLMProviderKey, 0)
	for rows.Next() {
		var item LLMProviderKey
		if err := rows.Scan(
			&item.ID, &item.ProviderName, &item.DisplayName, &item.APIKey,
			&item.BaseURL, &item.IsActive, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *LLMKeyRepo) Create(ctx context.Context, record *LLMProviderKey) error {
	query := `
		INSERT INTO llm_provider_keys (provider_name, display_name, api_key, base_url, is_active, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at
	`
	return r.pool.QueryRow(ctx, query,
		record.ProviderName, record.DisplayName, record.APIKey, record.BaseURL, record.IsActive, record.CreatedBy,
	).Scan(&record.ID, &record.CreatedAt, &record.UpdatedAt)
}

func (r *LLMKeyRepo) Update(ctx context.Context, id uuid.UUID, record *LLMProviderKey) error {
	query := `
		UPDATE llm_provider_keys
		SET provider_name = $1, display_name = $2, api_key = $3, base_url = $4, is_active = $5, updated_at = NOW()
		WHERE id = $6
		RETURNING updated_at
	`
	err := r.pool.QueryRow(ctx, query,
		record.ProviderName, record.DisplayName, record.APIKey, record.BaseURL, record.IsActive, id,
	).Scan(&record.UpdatedAt)
	if err == pgx.ErrNoRows {
		return pgx.ErrNoRows
	}
	return err
}

func (r *LLMKeyRepo) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM llm_provider_keys WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
