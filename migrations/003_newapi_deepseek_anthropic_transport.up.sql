-- Move previously synced New API DeepSeek thinking rows onto the transport
-- that preserves signed Anthropic thinking blocks across tool-call turns.

BEGIN;

UPDATE models
SET config_json = jsonb_set(
    jsonb_set(
        jsonb_set(
            config_json - 'api_base',
            '{use}',
            to_jsonb('langchain_anthropic:ChatAnthropic'::TEXT),
            TRUE
        ),
        '{base_url}',
        to_jsonb(REGEXP_REPLACE(config_json->>'base_url', '/v1/?$', '')),
        TRUE
    ),
    '{reasoning}',
    '{"contract":"anthropic_thinking","default_level":"max"}'::JSONB,
    TRUE
)
WHERE provider = 'deepseek'
  AND config_json->>'use' = 'langchain_deepseek:ChatDeepSeek'
  AND config_json->'reasoning'->>'contract' = 'deepseek_reasoner'
  AND config_json ? 'api_base'
  AND (
      LOWER(config_json->>'model') LIKE '%reasoner%'
      OR LOWER(config_json->>'model') LIKE 'deepseek-r1%'
      OR LOWER(config_json->>'model') LIKE 'deepseek-v4%'
  )
  AND LOWER(config_json->>'base_url') NOT LIKE 'https://api.deepseek.com%';

COMMIT;
