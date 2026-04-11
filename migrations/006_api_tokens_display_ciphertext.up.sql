BEGIN;

-- Keep a server-encrypted owner-visible copy of each API key so the workspace
-- key manager can show the full key again without weakening hash-based auth.
ALTER TABLE api_tokens
    ADD COLUMN IF NOT EXISTS token_ciphertext BYTEA;

COMMIT;
