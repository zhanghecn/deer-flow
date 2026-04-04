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

// Agent is a filesystem-backed authored definition stored under either
// `.openagents/system/agents/{status}/{name}/` for reserved built-ins or
// `.openagents/custom/agents/{status}/{name}/` for custom agents.
type Agent struct {
	Name             string                 `json:"name"`
	Description      string                 `json:"description"`
	Model            *string                `json:"model"`
	ToolGroups       []string               `json:"tool_groups"`
	ToolNames        []string               `json:"tool_names,omitempty"`
	McpServers       []string               `json:"mcp_servers"`
	Status           string                 `json:"status"`
	Memory           *AgentMemoryConfig     `json:"memory,omitempty"`
	SubagentDefaults *AgentSubagentDefaults `json:"subagent_defaults,omitempty"`
	Subagents        []AgentSubagent        `json:"subagents,omitempty"`
	AgentsMD         string                 `json:"agents_md"`
	Skills           []SkillRef             `json:"skills,omitempty"`
}

type AgentSubagentDefaults struct {
	GeneralPurposeEnabled bool     `json:"general_purpose_enabled" yaml:"general_purpose_enabled"`
	ToolNames             []string `json:"tool_names,omitempty" yaml:"tool_names,omitempty"`
}

type AgentSubagent struct {
	Name         string   `json:"name" yaml:"name"`
	Description  string   `json:"description" yaml:"description"`
	SystemPrompt string   `json:"system_prompt" yaml:"system_prompt"`
	Model        *string  `json:"model,omitempty" yaml:"model,omitempty"`
	ToolNames    []string `json:"tool_names,omitempty" yaml:"tool_names,omitempty"`
	Enabled      bool     `json:"enabled" yaml:"enabled"`
}

type ToolCatalogItem struct {
	Name                     string `json:"name"`
	Group                    string `json:"group"`
	Label                    string `json:"label"`
	Description              string `json:"description"`
	ConfigurableForMainAgent bool   `json:"configurable_for_main_agent"`
	ConfigurableForSubagent  bool   `json:"configurable_for_subagent"`
	ReservedPolicy           string `json:"reserved_policy"`
}

type AgentMemoryConfig struct {
	Enabled                 bool    `json:"enabled" yaml:"enabled"`
	ModelName               *string `json:"model_name,omitempty" yaml:"model_name,omitempty"`
	DebounceSeconds         int     `json:"debounce_seconds" yaml:"debounce_seconds"`
	MaxFacts                int     `json:"max_facts" yaml:"max_facts"`
	FactConfidenceThreshold float64 `json:"fact_confidence_threshold" yaml:"fact_confidence_threshold"`
	InjectionEnabled        bool    `json:"injection_enabled" yaml:"injection_enabled"`
	MaxInjectionTokens      int     `json:"max_injection_tokens" yaml:"max_injection_tokens"`
}

// Skill is a filesystem-backed skill definition stored under `.openagents/skills/`.
type Skill struct {
	Name            string            `json:"name"`
	Description     string            `json:"description"`
	DescriptionI18n map[string]string `json:"description_i18n,omitempty"`
	Status          string            `json:"status"`
	SkillMD         string            `json:"skill_md"`
}
