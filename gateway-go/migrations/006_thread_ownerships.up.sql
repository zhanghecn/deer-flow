-- Track per-thread ownership for strict multi-tenant access control.

BEGIN;

CREATE TABLE IF NOT EXISTS thread_ownerships (
    thread_id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assistant_id VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thread_ownerships_user_id ON thread_ownerships(user_id);

COMMIT;
