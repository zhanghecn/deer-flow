BEGIN;

ALTER TABLE agents
    DROP CONSTRAINT IF EXISTS agents_name_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'agents_name_status_key'
    ) THEN
        ALTER TABLE agents
            ADD CONSTRAINT agents_name_status_key UNIQUE (name, status);
    END IF;
END $$;

COMMIT;
