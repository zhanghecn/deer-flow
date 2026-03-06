package model

import "github.com/google/uuid"

// Auth DTOs

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Name     string `json:"name" binding:"required,min=1,max=128"`
	Password string `json:"password" binding:"required,min=8,max=128"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
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
	Name        string   `json:"name" binding:"required,min=1,max=128"`
	DisplayName string   `json:"display_name"`
	Description string   `json:"description"`
	AvatarURL   *string  `json:"avatar_url"`
	Model       *string  `json:"model"`
	ToolGroups  []string `json:"tool_groups"`
	AgentsMD    string   `json:"agents_md"`
}

type UpdateAgentRequest struct {
	DisplayName *string  `json:"display_name"`
	Description *string  `json:"description"`
	AvatarURL   *string  `json:"avatar_url"`
	Model       *string  `json:"model"`
	ToolGroups  []string `json:"tool_groups"`
	AgentsMD    *string  `json:"agents_md"`
}

type AgentResponse struct {
	Agent
	Skills []SkillRef `json:"skills,omitempty"`
}

type SkillRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
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
