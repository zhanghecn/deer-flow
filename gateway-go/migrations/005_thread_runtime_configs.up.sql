-- Persist per-thread runtime selections for Python-side model resolution.

BEGIN;

CREATE TABLE IF NOT EXISTS thread_runtime_configs (
    thread_id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_name VARCHAR(128),
    model_name VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thread_runtime_configs_user_id ON thread_runtime_configs(user_id);

COMMIT;
