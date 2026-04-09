BEGIN;

DROP INDEX IF EXISTS idx_api_tokens_status;

ALTER TABLE api_tokens
    DROP COLUMN IF EXISTS revoked_at,
    DROP COLUMN IF EXISTS metadata,
    DROP COLUMN IF EXISTS allowed_agents,
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS token_prefix;

COMMIT;
