-- OpenAgents Gateway schema baseline (squashed from historical migrations).

BEGIN;

SET TIME ZONE 'Asia/Shanghai';

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(20) DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_lower_unique ON users ((LOWER(name)));

-- API tokens
CREATE TABLE IF NOT EXISTS api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    name VARCHAR(128) NOT NULL,
    scopes TEXT[] DEFAULT '{}',
    last_used TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- Agents (shared)
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) UNIQUE NOT NULL,
    display_name VARCHAR(256),
    description TEXT DEFAULT '',
    avatar_url TEXT,
    model VARCHAR(128),
    tool_groups TEXT[] DEFAULT '{}',
    mcp_servers TEXT[] DEFAULT '{}',
    status VARCHAR(10) DEFAULT 'dev',
    agents_md TEXT DEFAULT '',
    config_json JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

-- Skills (shared)
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    status VARCHAR(10) DEFAULT 'dev',
    skill_md TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);

CREATE TABLE IF NOT EXISTS agent_skills (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, skill_id)
);

-- Models
CREATE TABLE IF NOT EXISTS models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) UNIQUE NOT NULL,
    display_name VARCHAR(256),
    provider VARCHAR(64) NOT NULL,
    config_json JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Runtime thread ownership/bindings
CREATE TABLE IF NOT EXISTS thread_bindings (
    thread_id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_name VARCHAR(128),
    assistant_id VARCHAR(128),
    model_name VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_thread_bindings_user_id ON thread_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_bindings_agent_name ON thread_bindings(agent_name);

-- Agent observability
CREATE TABLE IF NOT EXISTS agent_traces (
    trace_id VARCHAR(64) PRIMARY KEY,
    root_run_id VARCHAR(64) NOT NULL,
    thread_id VARCHAR(128),
    user_id UUID,
    agent_name VARCHAR(128),
    model_name VARCHAR(128),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_agent_traces_user_id ON agent_traces(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_traces_agent_name ON agent_traces(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_traces_thread_id ON agent_traces(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_traces_started_at ON agent_traces(started_at DESC);

CREATE TABLE IF NOT EXISTS agent_trace_events (
    id BIGSERIAL PRIMARY KEY,
    trace_id VARCHAR(64) NOT NULL REFERENCES agent_traces(trace_id) ON DELETE CASCADE,
    event_index BIGINT NOT NULL,
    run_id VARCHAR(64) NOT NULL,
    parent_run_id VARCHAR(64),
    run_type VARCHAR(32) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    node_name VARCHAR(256),
    tool_name VARCHAR(256),
    task_run_id VARCHAR(64),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms BIGINT,
    input_tokens BIGINT,
    output_tokens BIGINT,
    total_tokens BIGINT,
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    error TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trace_id, event_index)
);
CREATE INDEX IF NOT EXISTS idx_agent_trace_events_trace_id ON agent_trace_events(trace_id, event_index);
CREATE INDEX IF NOT EXISTS idx_agent_trace_events_task_run_id ON agent_trace_events(task_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_trace_events_run_id ON agent_trace_events(run_id);

-- Provider keys
CREATE TABLE IF NOT EXISTS llm_provider_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_name VARCHAR(64) NOT NULL,
    display_name VARCHAR(256) NOT NULL,
    api_key TEXT NOT NULL,
    base_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llm_provider_keys_provider ON llm_provider_keys(provider_name);

COMMIT;
