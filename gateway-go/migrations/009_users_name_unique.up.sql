-- Enforce unique login account name (case-insensitive).

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_lower_unique ON users ((LOWER(name)));

COMMIT;
