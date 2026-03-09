package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/openagents/gateway/internal/model"
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
		s.ID, s.Name, s.Description, s.Status, s.SkillMDRef, s.Metadata, s.CreatedBy,
	)
	return err
}

func (r *SkillRepo) FindAnyByName(ctx context.Context, name string) (*model.Skill, error) {
	s := &model.Skill{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, description, status, skill_md, metadata, created_by, created_at, updated_at
		 FROM skills WHERE name = $1 ORDER BY CASE status WHEN 'prod' THEN 0 ELSE 1 END LIMIT 1`, name,
	).Scan(&s.ID, &s.Name, &s.Description, &s.Status, &s.SkillMDRef, &s.Metadata, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return s, err
}

func (r *SkillRepo) FindByName(ctx context.Context, name string) (*model.Skill, error) {
	return r.FindAnyByName(ctx, name)
}

func (r *SkillRepo) List(ctx context.Context, status string) ([]model.Skill, error) {
	query := `SELECT id, name, description, status, skill_md, metadata, created_by, created_at, updated_at FROM skills`
	var args []interface{}
	if status != "" {
		query += ` WHERE status = $1`
		args = append(args, status)
	}
	query += ` ORDER BY name ASC, updated_at DESC`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var skills []model.Skill
	for rows.Next() {
		var s model.Skill
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.Status, &s.SkillMDRef, &s.Metadata, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
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
		s.Description, s.SkillMDRef, s.Metadata, name,
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
		`UPDATE skills SET status=$1, skill_md=$2, updated_at=NOW() WHERE name=$3`, status, sSkillMDRef(name, status), name,
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

func (r *SkillRepo) FindByNames(ctx context.Context, names []string) ([]model.Skill, error) {
	if len(names) == 0 {
		return []model.Skill{}, nil
	}

	rows, err := r.pool.Query(ctx,
		`SELECT DISTINCT ON (name) id, name, description, status, skill_md, metadata, created_by, created_at, updated_at
		 FROM skills
		 WHERE name = ANY($1)
		 ORDER BY name ASC, CASE status WHEN 'prod' THEN 0 ELSE 1 END, updated_at DESC`,
		names,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var skills []model.Skill
	for rows.Next() {
		var s model.Skill
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.Status, &s.SkillMDRef, &s.Metadata, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		skills = append(skills, s)
	}
	return skills, nil
}

func sSkillMDRef(name string, status string) string {
	if status == "prod" {
		return "skills/public/" + name + "/SKILL.md"
	}
	return "skills/custom/" + name + "/SKILL.md"
}
