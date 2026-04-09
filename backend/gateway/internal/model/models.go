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
	ID            uuid.UUID       `json:"id" db:"id"`
	UserID        uuid.UUID       `json:"user_id" db:"user_id"`
	TokenHash     string          `json:"-" db:"token_hash"`
	TokenPrefix   string          `json:"token_prefix" db:"token_prefix"`
	Name          string          `json:"name" db:"name"`
	Scopes        []string        `json:"scopes" db:"scopes"`
	Status        string          `json:"status" db:"status"`
	AllowedAgents []string        `json:"allowed_agents" db:"allowed_agents"`
	Metadata      json.RawMessage `json:"metadata,omitempty" db:"metadata"`
	LastUsed      *time.Time      `json:"last_used" db:"last_used"`
	ExpiresAt     *time.Time      `json:"expires_at" db:"expires_at"`
	RevokedAt     *time.Time      `json:"revoked_at" db:"revoked_at"`
	CreatedAt     time.Time       `json:"created_at" db:"created_at"`
}

// PublicAPIInvocation stores the stable northbound ledger row for one public API call.
//
// This is intentionally distinct from runtime traces. The invocation row is the
// externally queryable audit unit keyed by API token, surface, and response ID,
// while `agent_traces` remains the runtime execution trace store.
type PublicAPIInvocation struct {
	ID           uuid.UUID       `json:"id" db:"id"`
	ResponseID   string          `json:"response_id" db:"response_id"`
	Surface      string          `json:"surface" db:"surface"`
	APITokenID   uuid.UUID       `json:"api_token_id" db:"api_token_id"`
	UserID       uuid.UUID       `json:"user_id" db:"user_id"`
	AgentName    string          `json:"agent_name" db:"agent_name"`
	ThreadID     string          `json:"thread_id" db:"thread_id"`
	TraceID      *string         `json:"trace_id,omitempty" db:"trace_id"`
	RequestModel string          `json:"request_model" db:"request_model"`
	Status       string          `json:"status" db:"status"`
	InputTokens  int64           `json:"input_tokens" db:"input_tokens"`
	OutputTokens int64           `json:"output_tokens" db:"output_tokens"`
	TotalTokens  int64           `json:"total_tokens" db:"total_tokens"`
	Error        *string         `json:"error,omitempty" db:"error"`
	RequestJSON  json.RawMessage `json:"request_json" db:"request_json"`
	ResponseJSON json.RawMessage `json:"response_json" db:"response_json"`
	ClientIP     *string         `json:"client_ip,omitempty" db:"client_ip"`
	UserAgent    *string         `json:"user_agent,omitempty" db:"user_agent"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
	FinishedAt   *time.Time      `json:"finished_at,omitempty" db:"finished_at"`
}

// PublicAPIArtifact stores the public-facing file index for a completed
// invocation. Public callers should resolve files through these opaque records
// instead of thread-local virtual paths.
type PublicAPIArtifact struct {
	ID           uuid.UUID `json:"id" db:"id"`
	InvocationID uuid.UUID `json:"invocation_id" db:"invocation_id"`
	ResponseID   string    `json:"response_id" db:"response_id"`
	FileID       string    `json:"file_id" db:"file_id"`
	VirtualPath  string    `json:"virtual_path" db:"virtual_path"`
	StorageRef   string    `json:"storage_ref" db:"storage_ref"`
	MimeType     *string   `json:"mime_type,omitempty" db:"mime_type"`
	SizeBytes    *int64    `json:"size_bytes,omitempty" db:"size_bytes"`
	SHA256       *string   `json:"sha256,omitempty" db:"sha256"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

// PublicAPIInputFile stores user-uploaded files that can later be attached to
// public `/v1/responses` calls by opaque `file_id`. The binary source of truth
// stays on disk; PostgreSQL only tracks metadata and authorization ownership.
type PublicAPIInputFile struct {
	ID         uuid.UUID `json:"id" db:"id"`
	FileID     string    `json:"file_id" db:"file_id"`
	APITokenID uuid.UUID `json:"api_token_id" db:"api_token_id"`
	UserID     uuid.UUID `json:"user_id" db:"user_id"`
	Purpose    string    `json:"purpose" db:"purpose"`
	Filename   string    `json:"filename" db:"filename"`
	StorageRef string    `json:"storage_ref" db:"storage_ref"`
	MimeType   *string   `json:"mime_type,omitempty" db:"mime_type"`
	SizeBytes  int64     `json:"bytes" db:"size_bytes"`
	SHA256     *string   `json:"sha256,omitempty" db:"sha256"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
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
	OwnerUserID      string                 `json:"owner_user_id,omitempty"`
	OwnerName        string                 `json:"owner_name,omitempty"`
	CanManage        bool                   `json:"can_manage"`
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
	Category        string            `json:"category,omitempty"`
	SourcePath      string            `json:"source_path,omitempty"`
	CanEdit         bool              `json:"can_edit"`
	Status          string            `json:"status"`
	SkillMD         string            `json:"skill_md"`
}

type AuthoringFileEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
}
