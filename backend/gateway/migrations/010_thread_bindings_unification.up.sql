-- Unify thread runtime ownership/config into a single local table: thread_bindings.
-- Thread metadata should come from LangGraph threads APIs/storage, not local gateway tables.

BEGIN;

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

-- Hard cleanup of legacy split tables.
DROP TABLE IF EXISTS thread_runtime_configs;
DROP TABLE IF EXISTS thread_ownerships;

-- Drop legacy local threads table only if it matches the old gateway schema.
-- If "threads" is managed by LangGraph storage, it should not have agent_id.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'threads'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'threads' AND column_name = 'agent_id'
    ) THEN
        DROP TABLE threads;
    END IF;
END $$;

COMMIT;
