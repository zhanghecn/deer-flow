package repository

import (
	"context"
	"errors"

	"github.com/openagents/gateway/internal/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
		a.ID, a.Name, a.DisplayName, a.Description, a.AvatarURL, a.Model, a.ToolGroups, a.McpServers, a.Status, a.AgentsMD, a.ConfigJSON, a.CreatedBy,
	)
	return err
}

func (r *AgentRepo) FindByName(ctx context.Context, name string) (*model.Agent, error) {
	a := &model.Agent{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, display_name, description, avatar_url, model, tool_groups, mcp_servers, status, agents_md, config_json, created_by, created_at, updated_at
		 FROM agents WHERE name = $1`, name,
	).Scan(&a.ID, &a.Name, &a.DisplayName, &a.Description, &a.AvatarURL, &a.Model, &a.ToolGroups, &a.McpServers, &a.Status, &a.AgentsMD, &a.ConfigJSON, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return a, err
}

func (r *AgentRepo) List(ctx context.Context, status string) ([]model.Agent, error) {
	query := `SELECT id, name, display_name, description, avatar_url, model, tool_groups, mcp_servers, status, agents_md, config_json, created_by, created_at, updated_at
		 FROM agents`
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

	var agents []model.Agent
	for rows.Next() {
		var a model.Agent
		if err := rows.Scan(&a.ID, &a.Name, &a.DisplayName, &a.Description, &a.AvatarURL, &a.Model, &a.ToolGroups, &a.McpServers, &a.Status, &a.AgentsMD, &a.ConfigJSON, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		agents = append(agents, a)
	}
	return agents, nil
}

func (r *AgentRepo) Update(ctx context.Context, name string, a *model.Agent) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE agents SET display_name=$1, description=$2, avatar_url=$3, model=$4, tool_groups=$5, mcp_servers=$6, agents_md=$7, config_json=$8, updated_at=NOW()
		 WHERE name=$9`,
		a.DisplayName, a.Description, a.AvatarURL, a.Model, a.ToolGroups, a.McpServers, a.AgentsMD, a.ConfigJSON, name,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *AgentRepo) UpdateStatus(ctx context.Context, name string, status string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE agents SET status=$1, updated_at=NOW() WHERE name=$2`, status, name,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *AgentRepo) Delete(ctx context.Context, name string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM agents WHERE name = $1`, name,
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
		`SELECT s.id, s.name FROM skills s
		 JOIN agent_skills as2 ON as2.skill_id = s.id
		 WHERE as2.agent_id = $1`, agentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var refs []model.SkillRef
	for rows.Next() {
		var ref model.SkillRef
		if err := rows.Scan(&ref.ID, &ref.Name); err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	return refs, nil
}

