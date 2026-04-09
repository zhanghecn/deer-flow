BEGIN;

-- Public API keys need stable prefixes, lifecycle state, and explicit
-- per-agent allowlists before they can back a long-lived external contract.
ALTER TABLE api_tokens
    ADD COLUMN IF NOT EXISTS token_prefix VARCHAR(32);

UPDATE api_tokens
SET token_prefix = SUBSTRING(token_hash FROM 1 FOR 12)
WHERE COALESCE(token_prefix, '') = '';

ALTER TABLE api_tokens
    ALTER COLUMN token_prefix SET NOT NULL;

ALTER TABLE api_tokens
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS allowed_agents TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_tokens_status ON api_tokens(status);

COMMIT;
