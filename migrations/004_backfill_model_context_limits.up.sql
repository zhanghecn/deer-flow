BEGIN;

-- Seed migrations are only applied once. Older local databases may already
-- have Kimi / GLM model rows without max_input_tokens even though
-- 002_seed_data.up.sql now includes that field. Backfill the missing context
-- limits so fraction-based summarization works on upgraded databases too.

UPDATE models
SET config_json = jsonb_set(config_json, '{max_input_tokens}', to_jsonb(256000), true)
WHERE name IN ('kimi-k2.5-1', 'kimi-k2.5-2')
  AND CASE
        WHEN NOT (config_json ? 'max_input_tokens') THEN TRUE
        WHEN jsonb_typeof(config_json->'max_input_tokens') <> 'number' THEN TRUE
        ELSE COALESCE((config_json->>'max_input_tokens')::bigint, 0) <= 0
      END;

UPDATE models
SET config_json = jsonb_set(config_json, '{max_input_tokens}', to_jsonb(200000), true)
WHERE name = 'glm-5'
  AND CASE
        WHEN NOT (config_json ? 'max_input_tokens') THEN TRUE
        WHEN jsonb_typeof(config_json->'max_input_tokens') <> 'number' THEN TRUE
        ELSE COALESCE((config_json->>'max_input_tokens')::bigint, 0) <= 0
      END;

COMMIT;
