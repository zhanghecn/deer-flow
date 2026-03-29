-- Deterministic bootstrap data only.
-- Runtime/user-generated rows stay in the live database and are intentionally
-- excluded from migrations. Model rows are synced from the current database
-- snapshot so the baseline does not drift behind deployed configuration.
-- WARNING: this migration contains API credentials in config_json.

BEGIN;

INSERT INTO models (name, display_name, provider, config_json, enabled)
VALUES
    (
        'kimi-k2.5',
        'Kimi K2.5',
        'anthropic',
        $${
          "use": "langchain_anthropic:ChatAnthropic",
          "model": "kimi-k2.5",
          "api_key": "sk-yVvFfJmS5Gg8wLNY4kOHvbr0H2ZAGi8VxfSLp2wQbHr9UPZp",
          "base_url": "http://172.31.18.247:13000",
          "supports_vision": true,
          "max_input_tokens": 256000,
          "supports_thinking": true,
          "when_thinking_enabled": {
            "thinking": {
              "type": "enabled"
            }
          },
          "supports_reasoning_effort": false
        }$$::jsonb,
        true
    ),
    (
        'GLM-5',
        'GLM-5',
        'anthropic',
        $${
          "use": "langchain_anthropic:ChatAnthropic",
          "model": "glm-5",
          "api_key": "sk-yVvFfJmS5Gg8wLNY4kOHvbr0H2ZAGi8VxfSLp2wQbHr9UPZp",
          "base_url": "http://172.31.18.247:13000",
          "supports_vision": false,
          "max_input_tokens": 200000,
          "supports_thinking": true,
          "when_thinking_enabled": {
            "thinking": {
              "type": "enabled"
            }
          },
          "supports_reasoning_effort": false
        }$$::jsonb,
        false
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
