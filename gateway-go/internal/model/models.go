package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// User represents a platform user.
type User struct {
	ID           uuid.UUID  `json:"id" db:"id"`
	Email        string     `json:"email" db:"email"`
	Name         string     `json:"name" db:"name"`
	PasswordHash string     `json:"-" db:"password_hash"`
	AvatarURL    *string    `json:"avatar_url" db:"avatar_url"`
	Role         string     `json:"role" db:"role"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at" db:"updated_at"`
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

// Agent represents an agent definition (shared across all users).
type Agent struct {
	ID          uuid.UUID       `json:"id" db:"id"`
	Name        string          `json:"name" db:"name"`
	DisplayName *string         `json:"display_name" db:"display_name"`
	Description string          `json:"description" db:"description"`
	AvatarURL   *string         `json:"avatar_url" db:"avatar_url"`
	Model       *string         `json:"model" db:"model"`
	ToolGroups  []string        `json:"tool_groups" db:"tool_groups"`
	Status      string          `json:"status" db:"status"`
	AgentsMD    string          `json:"agents_md" db:"agents_md"`
	ConfigJSON  json.RawMessage `json:"config_json" db:"config_json"`
	CreatedBy   *uuid.UUID      `json:"created_by" db:"created_by"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at" db:"updated_at"`
}

// Skill represents a reusable skill definition (shared across all users).
type Skill struct {
	ID          uuid.UUID       `json:"id" db:"id"`
	Name        string          `json:"name" db:"name"`
	Description string          `json:"description" db:"description"`
	Status      string          `json:"status" db:"status"`
	SkillMD     string          `json:"skill_md" db:"skill_md"`
	Metadata    json.RawMessage `json:"metadata" db:"metadata"`
	CreatedBy   *uuid.UUID      `json:"created_by" db:"created_by"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at" db:"updated_at"`
}

// Thread represents a conversation thread.
type Thread struct {
	ID        string     `json:"id" db:"id"`
	UserID    uuid.UUID  `json:"user_id" db:"user_id"`
	AgentID   *uuid.UUID `json:"agent_id" db:"agent_id"`
	Title     *string    `json:"title" db:"title"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
}

// Model represents a configured LLM model.
type Model struct {
	ID          uuid.UUID       `json:"id" db:"id"`
	Name        string          `json:"name" db:"name"`
	DisplayName *string         `json:"display_name" db:"display_name"`
	Provider    string          `json:"provider" db:"provider"`
	ConfigJSON  json.RawMessage `json:"config_json" db:"config_json"`
	Enabled     bool            `json:"enabled" db:"enabled"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
}
