package model

import (
	"time"

	"github.com/google/uuid"
)

// User represents a platform user.
type User struct {
	ID           uuid.UUID `json:"id" db:"id"`
	Email        string    `json:"email" db:"email"`
	Name         string    `json:"name" db:"name"`
	PasswordHash string    `json:"-" db:"password_hash"`
	AvatarURL    *string   `json:"avatar_url" db:"avatar_url"`
	Role         string    `json:"role" db:"role"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// APIToken represents an API access token.
type APIToken struct {
	ID        uuid.UUID  `json:"id" db:"id"`
	UserID    uuid.UUID  `json:"user_id" db:"user_id"`
	TokenHash string     `json:"-" db:"token_hash"`
	Name      string     `json:"name" db:"name"`
	Scopes    []string   `json:"scopes" db:"scopes"`
	LastUsed  *time.Time `json:"last_used" db:"last_used"`
	ExpiresAt *time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
}

// Agent is a filesystem-backed agent definition stored under
// `.openagents/agents/{status}/{name}/`.
type Agent struct {
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Model       *string            `json:"model"`
	ToolGroups  []string           `json:"tool_groups"`
	McpServers  []string           `json:"mcp_servers"`
	Status      string             `json:"status"`
	Memory      *AgentMemoryConfig `json:"memory,omitempty"`
	AgentsMD    string             `json:"agents_md"`
	Skills      []SkillRef         `json:"skills,omitempty"`
}

type AgentMemoryConfig struct {
	Enabled                 bool    `json:"enabled"`
	ModelName               *string `json:"model_name,omitempty"`
	DebounceSeconds         int     `json:"debounce_seconds"`
	MaxFacts                int     `json:"max_facts"`
	FactConfidenceThreshold float64 `json:"fact_confidence_threshold"`
	InjectionEnabled        bool    `json:"injection_enabled"`
	MaxInjectionTokens      int     `json:"max_injection_tokens"`
}

// Skill is a filesystem-backed skill definition stored under `.openagents/skills/`.
type Skill struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
	SkillMD     string `json:"skill_md"`
}
