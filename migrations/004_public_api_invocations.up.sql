BEGIN;

CREATE TABLE IF NOT EXISTS public_api_invocations (
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

CREATE INDEX IF NOT EXISTS idx_public_api_invocations_user_created
    ON public_api_invocations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_invocations_token_created
    ON public_api_invocations(api_token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_invocations_agent_created
    ON public_api_invocations(agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_invocations_thread_created
    ON public_api_invocations(thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public_api_artifacts (
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

CREATE INDEX IF NOT EXISTS idx_public_api_artifacts_invocation
    ON public_api_artifacts(invocation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_public_api_artifacts_response
    ON public_api_artifacts(response_id, created_at ASC);

COMMIT;
