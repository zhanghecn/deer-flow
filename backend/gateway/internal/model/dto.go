package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Auth DTOs

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Name     string `json:"name" binding:"required,min=1,max=128"`
	Password string `json:"password" binding:"required,min=8,max=128"`
}

type LoginRequest struct {
	Account  string `json:"account" binding:"required,min=1,max=128"`
	Password string `json:"password" binding:"required"`
}

type AuthResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type CreateAPITokenRequest struct {
	Name          string          `json:"name" binding:"required,min=1,max=128"`
	Scopes        []string        `json:"scopes"`
	AllowedAgents []string        `json:"allowed_agents"`
	ExpiresAt     *time.Time      `json:"expires_at"`
	Metadata      json.RawMessage `json:"metadata"`
}

// Agent DTOs

type CreateAgentRequest struct {
	Name             string                 `json:"name" binding:"required,min=1,max=128"`
	Description      string                 `json:"description"`
	Model            *string                `json:"model"`
	ToolGroups       []string               `json:"tool_groups"`
	ToolNames        []string               `json:"tool_names"`
	McpServers       []string               `json:"mcp_servers"`
	Memory           *AgentMemoryConfig     `json:"memory"`
	SubagentDefaults *AgentSubagentDefaults `json:"subagent_defaults"`
	Subagents        []AgentSubagent        `json:"subagents"`
	Skills           []string               `json:"skills"`
	SkillRefs        []SkillRef             `json:"skill_refs"`
	AgentsMD         string                 `json:"agents_md"`
}

type UpdateAgentRequest struct {
	Description      *string                `json:"description"`
	Model            *string                `json:"model"`
	ToolGroups       []string               `json:"tool_groups"`
	ToolNames        []string               `json:"tool_names"`
	McpServers       []string               `json:"mcp_servers"`
	Memory           *AgentMemoryConfig     `json:"memory"`
	SubagentDefaults *AgentSubagentDefaults `json:"subagent_defaults"`
	Subagents        []AgentSubagent        `json:"subagents"`
	Skills           []string               `json:"skills"`
	SkillRefs        []SkillRef             `json:"skill_refs"`
	AgentsMD         *string                `json:"agents_md"`
}

type SkillRef struct {
	ID               uuid.UUID `json:"id" yaml:"-"`
	Name             string    `json:"name" yaml:"name"`
	Status           string    `json:"status,omitempty" yaml:"status,omitempty"`
	Category         string    `json:"category,omitempty" yaml:"category,omitempty"`
	SourcePath       string    `json:"source_path,omitempty" yaml:"source_path,omitempty"`
	MaterializedPath string    `json:"materialized_path,omitempty" yaml:"materialized_path,omitempty"`
}

// Skill DTOs

type CreateSkillRequest struct {
	Name            string            `json:"name" binding:"required,min=1,max=64"`
	Description     string            `json:"description"`
	DescriptionI18n map[string]string `json:"description_i18n"`
	SkillMD         string            `json:"skill_md" binding:"required"`
}

type UpdateSkillRequest struct {
	Description     *string            `json:"description"`
	DescriptionI18n *map[string]string `json:"description_i18n"`
	SkillMD         *string            `json:"skill_md"`
}

type CreateAgentAuthoringDraftRequest struct {
	ThreadID    string `json:"thread_id" binding:"required"`
	AgentStatus string `json:"agent_status"`
}

type CreateSkillAuthoringDraftRequest struct {
	ThreadID   string `json:"thread_id" binding:"required"`
	SourcePath string `json:"source_path"`
}

type ListAuthoringFilesRequest struct {
	ThreadID string `form:"thread_id" binding:"required"`
	Path     string `form:"path"`
}

type ReadAuthoringFileRequest struct {
	ThreadID string `form:"thread_id" binding:"required"`
	Path     string `form:"path" binding:"required"`
}

type WriteAuthoringFileRequest struct {
	ThreadID string `json:"thread_id" binding:"required"`
	Path     string `json:"path" binding:"required"`
	Content  string `json:"content"`
}

type SaveAgentAuthoringDraftRequest struct {
	ThreadID    string `json:"thread_id" binding:"required"`
	AgentStatus string `json:"agent_status"`
}

type SaveSkillAuthoringDraftRequest struct {
	ThreadID string `json:"thread_id" binding:"required"`
}

// Generic response

type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Details string `json:"details,omitempty"`
}

type SuccessResponse struct {
	Message string `json:"message"`
}
