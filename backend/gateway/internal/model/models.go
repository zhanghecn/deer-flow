package model

import (
	"encoding/json"
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

// Agent represents a shared agent definition row. Markdown content is
// materialized on disk; the DB stores filesystem references and metadata.
type Agent struct {
	ID          uuid.UUID          `json:"id" db:"id"`
	Name        string             `json:"name" db:"name"`
	DisplayName *string            `json:"display_name" db:"display_name"`
	Description string             `json:"description" db:"description"`
	AvatarURL   *string            `json:"avatar_url" db:"avatar_url"`
	Model       *string            `json:"model" db:"model"`
	ToolGroups  []string           `json:"tool_groups" db:"tool_groups"`
	McpServers  []string           `json:"mcp_servers" db:"mcp_servers"`
	Status      string             `json:"status" db:"status"`
	Memory      *AgentMemoryConfig `json:"memory,omitempty"`
	AgentsMD    string             `json:"agents_md"`
	AgentsMDRef string             `json:"-" db:"agents_md"`
	Skills      []SkillRef         `json:"skills,omitempty"`
	ConfigJSON  json.RawMessage    `json:"config_json" db:"config_json"`
	CreatedBy   *uuid.UUID         `json:"created_by" db:"created_by"`
	CreatedAt   time.Time          `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at" db:"updated_at"`
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

// Skill represents a shared skill library row. The DB stores a path reference
// to SKILL.md while the markdown body lives on disk.
type Skill struct {
	ID          uuid.UUID       `json:"id" db:"id"`
	Name        string          `json:"name" db:"name"`
	Description string          `json:"description" db:"description"`
	Status      string          `json:"status" db:"status"`
	SkillMD     string          `json:"skill_md"`
	SkillMDRef  string          `json:"-" db:"skill_md"`
	Metadata    json.RawMessage `json:"metadata" db:"metadata"`
	CreatedBy   *uuid.UUID      `json:"created_by" db:"created_by"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at" db:"updated_at"`
}
