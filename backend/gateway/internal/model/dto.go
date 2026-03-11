package model

import "github.com/google/uuid"

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
	Name   string   `json:"name" binding:"required,min=1,max=128"`
	Scopes []string `json:"scopes"`
}

type APITokenResponse struct {
	APIToken
	PlainToken string `json:"token,omitempty"`
}

// Agent DTOs

type CreateAgentRequest struct {
	Name        string             `json:"name" binding:"required,min=1,max=128"`
	Description string             `json:"description"`
	Model       *string            `json:"model"`
	ToolGroups  []string           `json:"tool_groups"`
	McpServers  []string           `json:"mcp_servers"`
	Memory      *AgentMemoryConfig `json:"memory"`
	Skills      []string           `json:"skills"`
	AgentsMD    string             `json:"agents_md"`
}

type UpdateAgentRequest struct {
	Description *string            `json:"description"`
	Model       *string            `json:"model"`
	ToolGroups  []string           `json:"tool_groups"`
	McpServers  []string           `json:"mcp_servers"`
	Memory      *AgentMemoryConfig `json:"memory"`
	Skills      []string           `json:"skills"`
	AgentsMD    *string            `json:"agents_md"`
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
	Name        string `json:"name" binding:"required,min=1,max=64"`
	Description string `json:"description"`
	SkillMD     string `json:"skill_md" binding:"required"`
}

type UpdateSkillRequest struct {
	Description *string `json:"description"`
	SkillMD     *string `json:"skill_md"`
}

// Open API DTOs

type OpenAPIChatRequest struct {
	Message  string `json:"message" binding:"required"`
	ThreadID string `json:"thread_id"`
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
