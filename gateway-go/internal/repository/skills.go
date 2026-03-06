package repository

import (
	"context"
	"errors"

	"github.com/deer-flow/gateway/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SkillRepo struct {
	pool *pgxpool.Pool
}

func NewSkillRepo(pool *pgxpool.Pool) *SkillRepo {
	return &SkillRepo{pool: pool}
}

func (r *SkillRepo) Create(ctx context.Context, s *model.Skill) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO skills (id, name, description, status, skill_md, metadata, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		s.ID, s.Name, s.Description, s.Status, s.SkillMD, s.Metadata, s.CreatedBy,
	)
	return err
}

func (r *SkillRepo) FindByName(ctx context.Context, name string) (*model.Skill, error) {
	s := &model.Skill{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, description, status, skill_md, metadata, created_by, created_at, updated_at
		 FROM skills WHERE name = $1`, name,
	).Scan(&s.ID, &s.Name, &s.Description, &s.Status, &s.SkillMD, &s.Metadata, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return s, err
}

func (r *SkillRepo) List(ctx context.Context, status string) ([]model.Skill, error) {
	query := `SELECT id, name, description, status, skill_md, metadata, created_by, created_at, updated_at FROM skills`
	var args []interface{}
	if status != "" {
		query += ` WHERE status = $1`
		args = append(args, status)
	}
	query += ` ORDER BY updated_at DESC`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var skills []model.Skill
	for rows.Next() {
		var s model.Skill
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.Status, &s.SkillMD, &s.Metadata, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		skills = append(skills, s)
	}
	return skills, nil
}

func (r *SkillRepo) Update(ctx context.Context, name string, s *model.Skill) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE skills SET description=$1, skill_md=$2, metadata=$3, updated_at=NOW()
		 WHERE name=$4`,
		s.Description, s.SkillMD, s.Metadata, name,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *SkillRepo) UpdateStatus(ctx context.Context, name string, status string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE skills SET status=$1, updated_at=NOW() WHERE name=$2`, status, name,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *SkillRepo) Delete(ctx context.Context, name string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM skills WHERE name = $1`, name,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
