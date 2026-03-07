package repository

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ModelRecord struct {
	Name        string
	DisplayName *string
	Provider    string
	ConfigJSON  json.RawMessage
	Enabled     bool
}

type ModelRepo struct {
	pool *pgxpool.Pool
}

func NewModelRepo(pool *pgxpool.Pool) *ModelRepo {
	return &ModelRepo{pool: pool}
}

func (r *ModelRepo) ListEnabled(ctx context.Context) ([]ModelRecord, error) {
	rows, err := r.pool.Query(
		ctx,
		`SELECT name, display_name, provider, config_json, enabled
		 FROM models
		 WHERE enabled = TRUE
		 ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ModelRecord
	for rows.Next() {
		var row ModelRecord
		if err := rows.Scan(&row.Name, &row.DisplayName, &row.Provider, &row.ConfigJSON, &row.Enabled); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, nil
}

func (r *ModelRepo) FindEnabledByName(ctx context.Context, name string) (*ModelRecord, error) {
	var row ModelRecord
	err := r.pool.QueryRow(
		ctx,
		`SELECT name, display_name, provider, config_json, enabled
		 FROM models
		 WHERE name = $1 AND enabled = TRUE`,
		name,
	).Scan(&row.Name, &row.DisplayName, &row.Provider, &row.ConfigJSON, &row.Enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}
