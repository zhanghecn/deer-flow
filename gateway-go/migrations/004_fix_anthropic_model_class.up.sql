-- Normalize anthropic-compatible model adapters.
-- If existing rows were seeded with OpenAI adapter but provider is anthropic,
-- switch to ChatAnthropic to avoid /chat/completions 404 on anthropic endpoints.

BEGIN;

UPDATE models
SET config_json = jsonb_set(
    config_json,
    '{use}',
    '"langchain_anthropic:ChatAnthropic"'::jsonb,
    true
)
WHERE lower(provider) = 'anthropic'
  AND COALESCE(config_json->>'use', '') <> 'langchain_anthropic:ChatAnthropic';

COMMIT;
