package repository

import (
	"context"

	"github.com/deer-flow/gateway/internal/model"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ModelRepo struct {
	pool *pgxpool.Pool
}

func NewModelRepo(pool *pgxpool.Pool) *ModelRepo {
	return &ModelRepo{pool: pool}
}

func (r *ModelRepo) List(ctx context.Context) ([]model.Model, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, display_name, provider, config_json, enabled, created_at
		 FROM models WHERE enabled = true ORDER BY name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var models []model.Model
	for rows.Next() {
		var m model.Model
		if err := rows.Scan(&m.ID, &m.Name, &m.DisplayName, &m.Provider, &m.ConfigJSON, &m.Enabled, &m.CreatedAt); err != nil {
			return nil, err
		}
		models = append(models, m)
	}
	return models, nil
}
