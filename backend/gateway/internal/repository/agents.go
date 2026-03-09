package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/openagents/gateway/internal/model"
)

type AgentRepo struct {
	pool *pgxpool.Pool
}

func NewAgentRepo(pool *pgxpool.Pool) *AgentRepo {
	return &AgentRepo{pool: pool}
}

func (r *AgentRepo) Create(ctx context.Context, a *model.Agent) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO agents (id, name, display_name, description, avatar_url, model, tool_groups, mcp_servers, status, agents_md, config_json, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		a.ID, a.Name, a.DisplayName, a.Description, a.AvatarURL, a.Model, a.ToolGroups, a.McpServers, a.Status, a.AgentsMDRef, a.ConfigJSON, a.CreatedBy,
	)
	return err
}

func (r *AgentRepo) ExistsName(ctx context.Context, name string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agents WHERE name = $1)`, name).Scan(&exists)
	return exists, err
}

func (r *AgentRepo) FindByName(ctx context.Context, name string, status string) (*model.Agent, error) {
	a := &model.Agent{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, display_name, description, avatar_url, model, tool_groups, mcp_servers, status, agents_md, config_json, created_by, created_at, updated_at
		 FROM agents WHERE name = $1 AND status = $2`, name, status,
	).Scan(&a.ID, &a.Name, &a.DisplayName, &a.Description, &a.AvatarURL, &a.Model, &a.ToolGroups, &a.McpServers, &a.Status, &a.AgentsMDRef, &a.ConfigJSON, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return a, err
}

func (r *AgentRepo) List(ctx context.Context, status string) ([]model.Agent, error) {
	query := `SELECT id, name, display_name, description, avatar_url, model, tool_groups, mcp_servers, status, agents_md, config_json, created_by, created_at, updated_at FROM agents`
	var args []interface{}
	if status != "" {
		query += ` WHERE status = $1`
		args = append(args, status)
	}
	query += ` ORDER BY name ASC, CASE status WHEN 'prod' THEN 0 ELSE 1 END, updated_at DESC`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []model.Agent
	for rows.Next() {
		var a model.Agent
		if err := rows.Scan(&a.ID, &a.Name, &a.DisplayName, &a.Description, &a.AvatarURL, &a.Model, &a.ToolGroups, &a.McpServers, &a.Status, &a.AgentsMDRef, &a.ConfigJSON, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		agents = append(agents, a)
	}
	return agents, nil
}

func (r *AgentRepo) Update(ctx context.Context, name string, status string, a *model.Agent) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE agents SET display_name=$1, description=$2, avatar_url=$3, model=$4, tool_groups=$5, mcp_servers=$6, agents_md=$7, config_json=$8, updated_at=NOW()
		 WHERE name=$9 AND status=$10`,
		a.DisplayName, a.Description, a.AvatarURL, a.Model, a.ToolGroups, a.McpServers, a.AgentsMDRef, a.ConfigJSON, name, status,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *AgentRepo) Delete(ctx context.Context, name string, status string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM agents WHERE name = $1 AND status = $2`, name, status,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *AgentRepo) GetSkills(ctx context.Context, agentID uuid.UUID) ([]model.SkillRef, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT s.id, s.name, s.status, s.skill_md
		 FROM skills s
		 JOIN agent_skills rel ON rel.skill_id = s.id
		 WHERE rel.agent_id = $1
		 ORDER BY s.name ASC`, agentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var refs []model.SkillRef
	for rows.Next() {
		var ref model.SkillRef
		var skillMDRef string
		if err := rows.Scan(&ref.ID, &ref.Name, &ref.Status, &skillMDRef); err != nil {
			return nil, err
		}
		if ref.Status == "prod" {
			ref.Category = "public"
		} else {
			ref.Category = "custom"
		}
		ref.SourcePath = ref.Category + "/" + ref.Name
		refs = append(refs, ref)
	}
	return refs, nil
}

func (r *AgentRepo) ReplaceSkills(ctx context.Context, agentID uuid.UUID, skillIDs []uuid.UUID) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, `DELETE FROM agent_skills WHERE agent_id = $1`, agentID); err != nil {
		return err
	}
	for _, skillID := range skillIDs {
		if _, err := tx.Exec(ctx, `INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2)`, agentID, skillID); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
