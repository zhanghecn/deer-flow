-- Seed runtime data.
-- WARNING: this migration contains API credentials in config_json.

BEGIN;

INSERT INTO models (name, display_name, provider, config_json, enabled)
VALUES
    (
        'kimi-k2.5-1',
        'Kimi K2.5 #1',
        'anthropic',
        '{
          "use": "langchain_anthropic:ChatAnthropic",
          "model": "kimi-k2.5",
          "api_key": "sk-kimi-iTmVzeQofVNhi0NVJVn0gY21zEdrbXpEMlSeX6QotEpYL4op46Fb8TWzsQbPSSn1",
          "base_url": "https://api.kimi.com/coding/",
          "max_input_tokens": 256000,
          "supports_thinking": true,
          "supports_vision": false,
          "supports_reasoning_effort": false,
          "when_thinking_enabled": {
            "thinking": {
              "type": "enabled"
            }
          }
        }'::jsonb,
        true
    ),
    (
        'kimi-k2.5-2',
        'Kimi K2.5 #2',
        'anthropic',
        '{
          "use": "langchain_anthropic:ChatAnthropic",
          "model": "kimi-k2.5",
          "api_key": "sk-kimi-OOSOEpfXJsjGQGB5dIuDTqNfrNWSzYCLlwHNuxD2cmsihdYQmq1qYRDfjx75kH4T",
          "base_url": "https://api.kimi.com/coding/",
          "max_input_tokens": 256000,
          "supports_thinking": true,
          "supports_vision": false,
          "supports_reasoning_effort": false,
          "when_thinking_enabled": {
            "thinking": {
              "type": "enabled"
            }
          }
        }'::jsonb,
        true
    ),
    (
        'glm-5',
        'GLM-5',
        'anthropic',
        '{
          "use": "langchain_anthropic:ChatAnthropic",
          "model": "glm-5",
          "api_key": "sk-sp-7f7dd6439d8e4af0a4241da5e4ea2e8c",
          "base_url": "https://coding.dashscope.aliyuncs.com/apps/anthropic",
          "max_input_tokens": 200000,
          "supports_thinking": true,
          "supports_vision": false,
          "supports_reasoning_effort": false,
          "when_thinking_enabled": {
            "thinking": {
              "type": "enabled"
            }
          }
        }'::jsonb,
        true
    )
ON CONFLICT (name) DO UPDATE
SET
    display_name = EXCLUDED.display_name,
    provider = EXCLUDED.provider,
    config_json = EXCLUDED.config_json,
    enabled = EXCLUDED.enabled;

-- Default admin account:
-- account: admin
-- password: admin123
UPDATE users
SET
    password_hash = '$2a$10$c.57yAjkgO031eInR.91Vurdh9BZm2re7OrWk2Gx06tlngnJdyMYi',
    role = 'admin',
    updated_at = NOW()
WHERE LOWER(name) = 'admin';

INSERT INTO users (email, name, password_hash, role)
SELECT
    'admin@163.com',
    'admin',
    '$2a$10$c.57yAjkgO031eInR.91Vurdh9BZm2re7OrWk2Gx06tlngnJdyMYi',
    'admin'
WHERE NOT EXISTS (
    SELECT 1
    FROM users
    WHERE LOWER(name) = 'admin'
);

COMMIT;
