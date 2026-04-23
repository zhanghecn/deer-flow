package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/openagents/gateway/internal/model"
)

type ModelRecord struct {
	Name        string
	DisplayName *string
	Provider    string
	ConfigJSON  json.RawMessage
	Enabled     bool
	CreatedAt   time.Time
}

type ModelRepo struct {
	pool *pgxpool.Pool
}

func NewModelRepo(pool *pgxpool.Pool) *ModelRepo {
	return &ModelRepo{pool: pool}
}

type modelScanner interface {
	Scan(dest ...any) error
}

func scanModelRecord(scanner modelScanner) (ModelRecord, error) {
	var row ModelRecord
	err := scanner.Scan(
		&row.Name,
		&row.DisplayName,
		&row.Provider,
		&row.ConfigJSON,
		&row.Enabled,
		&row.CreatedAt,
	)
	return row, err
}

func (r *ModelRepo) ListEnabled(ctx context.Context) ([]ModelRecord, error) {
	return r.list(ctx, `SELECT name, display_name, provider, config_json, enabled, created_at
		FROM models
		WHERE enabled = TRUE
		ORDER BY created_at ASC, name ASC`)
}

func (r *ModelRepo) ListAll(ctx context.Context) ([]ModelRecord, error) {
	return r.list(ctx, `SELECT name, display_name, provider, config_json, enabled, created_at
		FROM models
		ORDER BY created_at ASC, name ASC`)
}

func (r *ModelRepo) list(ctx context.Context, query string) ([]ModelRecord, error) {
	rows, err := r.pool.Query(
		ctx,
		query,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ModelRecord
	for rows.Next() {
		row, err := scanModelRecord(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, nil
}

func (r *ModelRepo) FindEnabledByName(ctx context.Context, name string) (*ModelRecord, error) {
	return r.findByQuery(
		ctx,
		`SELECT name, display_name, provider, config_json, enabled, created_at
		 FROM models
		 WHERE name = $1 AND enabled = TRUE`,
		name,
	)
}

func (r *ModelRepo) FindByName(ctx context.Context, name string) (*ModelRecord, error) {
	return r.findByQuery(
		ctx,
		`SELECT name, display_name, provider, config_json, enabled, created_at
		FROM models
		WHERE name = $1`,
		name,
	)
}

func (r *ModelRepo) findByQuery(ctx context.Context, query string, name string) (*ModelRecord, error) {
	row, err := scanModelRecord(
		r.pool.QueryRow(
			ctx,
			query,
			name,
		),
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *ModelRepo) Create(ctx context.Context, record *ModelRecord) error {
	row, err := scanModelRecord(
		r.pool.QueryRow(
			ctx,
			`INSERT INTO models (name, display_name, provider, config_json, enabled)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING name, display_name, provider, config_json, enabled, created_at`,
			record.Name,
			record.DisplayName,
			record.Provider,
			record.ConfigJSON,
			record.Enabled,
		),
	)
	if err != nil {
		return err
	}
	*record = row
	return nil
}

func (r *ModelRepo) UpdateByName(ctx context.Context, currentName string, record *ModelRecord) error {
	row, err := scanModelRecord(
		r.pool.QueryRow(
			ctx,
			`UPDATE models
			SET name = $1, display_name = $2, provider = $3, config_json = $4, enabled = $5
			WHERE name = $6
			RETURNING name, display_name, provider, config_json, enabled, created_at`,
			record.Name,
			record.DisplayName,
			record.Provider,
			record.ConfigJSON,
			record.Enabled,
			currentName,
		),
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return pgx.ErrNoRows
	}
	if err != nil {
		return err
	}
	*record = row
	return nil
}

func (r *ModelRepo) DeleteByName(ctx context.Context, name string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM models WHERE name = $1`, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ModelRepo) MigrateLegacyReasoningConfigs(ctx context.Context) error {
	rows, err := r.pool.Query(
		ctx,
		`SELECT name, config_json
		 FROM models
		 ORDER BY created_at ASC, name ASC`,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	type pendingUpdate struct {
		name       string
		configJSON json.RawMessage
	}

	updates := make([]pendingUpdate, 0)
	for rows.Next() {
		var name string
		var configJSON json.RawMessage
		if err := rows.Scan(&name, &configJSON); err != nil {
			return err
		}

		config := map[string]interface{}{}
		if err := json.Unmarshal(configJSON, &config); err != nil {
			return err
		}
		normalized, changed := model.NormalizeLegacyReasoningConfig(config)
		if !changed {
			continue
		}
		normalizedJSON, err := json.Marshal(normalized)
		if err != nil {
			return err
		}
		updates = append(updates, pendingUpdate{
			name:       name,
			configJSON: normalizedJSON,
		})
	}
	if rows.Err() != nil {
		return rows.Err()
	}

	for _, update := range updates {
		if _, err := r.pool.Exec(
			ctx,
			`UPDATE models SET config_json = $1 WHERE name = $2`,
			update.configJSON,
			update.name,
		); err != nil {
			return err
		}
	}
	return nil
}
