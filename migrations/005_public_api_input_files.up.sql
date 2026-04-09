BEGIN;

CREATE TABLE IF NOT EXISTS public_api_input_files (
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

CREATE INDEX IF NOT EXISTS idx_public_api_input_files_token_created
    ON public_api_input_files(api_token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_input_files_user_created
    ON public_api_input_files(user_id, created_at DESC);

COMMIT;
