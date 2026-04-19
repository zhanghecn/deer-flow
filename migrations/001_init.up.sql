-- Squashed gateway schema baseline.
-- This file covers only gateway-owned tables. Runtime checkpoint tables and
-- removed legacy agent/skill tables are intentionally excluded from the
-- migration contract.

BEGIN;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(20) DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_name_lower_unique ON users ((LOWER(name)));

CREATE TABLE api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    token_ciphertext BYTEA,
    token_prefix VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    scopes TEXT[] DEFAULT '{}',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    allowed_agents TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    revoked_at TIMESTAMPTZ,
    last_used TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_status ON api_tokens(status);

-- Public API usage is gateway-owned operational state, so these tables live in
-- the schema baseline instead of a separate historical migration chain.
CREATE TABLE public_api_invocations (
    id UUID PRIMARY KEY,
    response_id VARCHAR(128) NOT NULL UNIQUE,
    surface VARCHAR(32) NOT NULL,
    api_token_id UUID NOT NULL REFERENCES api_tokens(id),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_name VARCHAR(128) NOT NULL,
    thread_id VARCHAR(128) NOT NULL,
    trace_id VARCHAR(64),
    request_model VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    error TEXT,
    request_json JSONB NOT NULL,
    response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_public_api_invocations_user_created
    ON public_api_invocations(user_id, created_at DESC);
CREATE INDEX idx_public_api_invocations_token_created
    ON public_api_invocations(api_token_id, created_at DESC);
CREATE INDEX idx_public_api_invocations_agent_created
    ON public_api_invocations(agent_name, created_at DESC);
CREATE INDEX idx_public_api_invocations_thread_created
    ON public_api_invocations(thread_id, created_at DESC);

CREATE TABLE public_api_artifacts (
    id UUID PRIMARY KEY,
    invocation_id UUID NOT NULL REFERENCES public_api_invocations(id) ON DELETE CASCADE,
    response_id VARCHAR(128) NOT NULL,
    file_id VARCHAR(128) NOT NULL UNIQUE,
    virtual_path TEXT NOT NULL,
    storage_ref TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT,
    sha256 VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_public_api_artifacts_invocation
    ON public_api_artifacts(invocation_id, created_at ASC);
CREATE INDEX idx_public_api_artifacts_response
    ON public_api_artifacts(response_id, created_at ASC);

CREATE TABLE public_api_input_files (
    id UUID PRIMARY KEY,
    file_id VARCHAR(128) NOT NULL UNIQUE,
    api_token_id UUID NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(64) NOT NULL,
    filename TEXT NOT NULL,
    storage_ref TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT NOT NULL,
    sha256 VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_public_api_input_files_token_created
    ON public_api_input_files(api_token_id, created_at DESC);
CREATE INDEX idx_public_api_input_files_user_created
    ON public_api_input_files(user_id, created_at DESC);

CREATE TABLE models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(128) UNIQUE NOT NULL,
    display_name VARCHAR(256),
    provider VARCHAR(64) NOT NULL,
    config_json JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE thread_bindings (
    thread_id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_name VARCHAR(128),
    assistant_id VARCHAR(128),
    model_name VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    title TEXT,
    agent_status VARCHAR(16) NOT NULL DEFAULT 'dev',
    execution_backend VARCHAR(32) NOT NULL DEFAULT 'default',
    remote_session_id TEXT
);

CREATE INDEX idx_thread_bindings_user_id ON thread_bindings(user_id);
CREATE INDEX idx_thread_bindings_agent_name ON thread_bindings(agent_name);

CREATE TABLE agent_traces (
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

CREATE INDEX idx_agent_traces_user_id ON agent_traces(user_id);
CREATE INDEX idx_agent_traces_agent_name ON agent_traces(agent_name);
CREATE INDEX idx_agent_traces_thread_id ON agent_traces(thread_id);
CREATE INDEX idx_agent_traces_started_at ON agent_traces(started_at DESC);

CREATE TABLE agent_trace_events (
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

CREATE INDEX idx_agent_trace_events_trace_id ON agent_trace_events(trace_id, event_index);
CREATE INDEX idx_agent_trace_events_task_run_id ON agent_trace_events(task_run_id);
CREATE INDEX idx_agent_trace_events_run_id ON agent_trace_events(run_id);

CREATE TABLE knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    source_type VARCHAR(32) NOT NULL DEFAULT 'sidebar',
    command_name VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    visibility VARCHAR(32) NOT NULL DEFAULT 'shared',
    preview_enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_knowledge_bases_user_id ON knowledge_bases(user_id);
CREATE INDEX idx_knowledge_bases_created_at ON knowledge_bases(created_at DESC);
CREATE INDEX idx_knowledge_bases_visibility ON knowledge_bases(visibility);

CREATE TABLE knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_kind VARCHAR(32) NOT NULL,
    locator_type VARCHAR(32) NOT NULL,
    source_storage_path TEXT NOT NULL,
    markdown_storage_path TEXT,
    preview_storage_path TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'processing',
    error TEXT,
    doc_description TEXT,
    page_count INTEGER,
    node_count INTEGER NOT NULL DEFAULT 0,
    build_model_name VARCHAR(128),
    document_tree JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    canonical_storage_path TEXT,
    source_map_storage_path TEXT,
    content_sha256 VARCHAR(64),
    canonical_markdown TEXT,
    source_map_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    document_index_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    build_quality VARCHAR(32) NOT NULL DEFAULT 'ready',
    quality_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_knowledge_documents_base_id ON knowledge_documents(knowledge_base_id);
CREATE INDEX idx_knowledge_documents_user_id ON knowledge_documents(user_id);
CREATE INDEX idx_knowledge_documents_status ON knowledge_documents(status);
CREATE INDEX idx_knowledge_documents_content_sha
    ON knowledge_documents(content_sha256, file_kind, status, build_model_name);

CREATE TABLE knowledge_document_nodes (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    node_id VARCHAR(64) NOT NULL,
    parent_node_id VARCHAR(64),
    node_path TEXT NOT NULL,
    title TEXT NOT NULL,
    depth INTEGER NOT NULL,
    child_count INTEGER NOT NULL DEFAULT 0,
    locator_type VARCHAR(32) NOT NULL,
    page_start INTEGER,
    page_end INTEGER,
    line_start INTEGER,
    line_end INTEGER,
    heading_slug TEXT,
    summary TEXT,
    excerpt TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    prefix_summary TEXT,
    node_text TEXT,
    visual_summary TEXT,
    summary_quality VARCHAR(32) NOT NULL DEFAULT 'fallback',
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    UNIQUE (document_id, node_id)
);

CREATE INDEX idx_knowledge_document_nodes_document_id ON knowledge_document_nodes(document_id);
CREATE INDEX idx_knowledge_document_nodes_parent
    ON knowledge_document_nodes(document_id, parent_node_id, node_path);

CREATE TABLE knowledge_thread_bindings (
    thread_id VARCHAR(64) NOT NULL,
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (thread_id, knowledge_base_id)
);

CREATE INDEX idx_knowledge_thread_bindings_user_id ON knowledge_thread_bindings(user_id);
CREATE INDEX idx_knowledge_thread_bindings_base_id ON knowledge_thread_bindings(knowledge_base_id);

CREATE TABLE knowledge_build_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thread_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    stage VARCHAR(64),
    message TEXT,
    progress_percent INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 0,
    completed_steps INTEGER NOT NULL DEFAULT 0,
    model_name VARCHAR(128),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_knowledge_build_jobs_document_id
    ON knowledge_build_jobs(document_id, created_at DESC);
CREATE INDEX idx_knowledge_build_jobs_thread_id
    ON knowledge_build_jobs(thread_id, created_at DESC);
CREATE INDEX idx_knowledge_build_jobs_status
    ON knowledge_build_jobs(status, created_at DESC);

CREATE TABLE knowledge_build_events (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES knowledge_build_jobs(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    stage VARCHAR(64) NOT NULL,
    step_name VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    message TEXT,
    elapsed_ms INTEGER,
    retry_count INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_knowledge_build_events_job_id ON knowledge_build_events(job_id, id);
CREATE INDEX idx_knowledge_build_events_document_id ON knowledge_build_events(document_id, id);

COMMIT;
