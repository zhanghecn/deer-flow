-- Backfill context-window metadata for baseline runtime models.
-- This only fills rows that do not already declare `max_input_tokens`, so
-- operator-managed values continue to win during future migrations.

BEGIN;

-- Kimi K2.5 official materials describe a 256K context window.
UPDATE models
SET config_json = jsonb_set(
    config_json,
    '{max_input_tokens}',
    to_jsonb(256000),
    true
)
WHERE COALESCE(config_json ->> 'model', '') = 'kimi-k2.5'
  AND NOT (config_json ? 'max_input_tokens');

-- GLM-5 official docs list a 200K context window.
UPDATE models
SET config_json = jsonb_set(
    config_json,
    '{max_input_tokens}',
    to_jsonb(200000),
    true
)
WHERE COALESCE(config_json ->> 'model', '') = 'glm-5'
  AND NOT (config_json ? 'max_input_tokens');

COMMIT;
