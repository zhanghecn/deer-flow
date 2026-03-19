BEGIN;

ALTER TABLE thread_bindings
    ADD COLUMN IF NOT EXISTS agent_status VARCHAR(16);

UPDATE thread_bindings
SET agent_status = 'dev'
WHERE agent_status IS NULL OR BTRIM(agent_status) = '';

ALTER TABLE thread_bindings
    ALTER COLUMN agent_status SET DEFAULT 'dev';

ALTER TABLE thread_bindings
    ALTER COLUMN agent_status SET NOT NULL;

ALTER TABLE thread_bindings
    ADD COLUMN IF NOT EXISTS execution_backend VARCHAR(32);

UPDATE thread_bindings
SET execution_backend = 'default'
WHERE execution_backend IS NULL OR BTRIM(execution_backend) = '';

ALTER TABLE thread_bindings
    ALTER COLUMN execution_backend SET DEFAULT 'default';

ALTER TABLE thread_bindings
    ALTER COLUMN execution_backend SET NOT NULL;

ALTER TABLE thread_bindings
    ADD COLUMN IF NOT EXISTS remote_session_id TEXT;

COMMIT;
