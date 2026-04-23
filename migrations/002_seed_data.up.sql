-- Deterministic bootstrap data only.
-- Runtime/user-generated rows stay in the live database and are intentionally
-- excluded from migrations. Model rows are synced from the current database
-- snapshot so the baseline does not drift behind deployed configuration.
-- WARNING: this migration still contains bootstrap credentials in config_json.
-- Keep shared constants centralized so operators can rotate them in one place.

BEGIN;

-- Shared seed constants keep bootstrap-only credentials and endpoints in one
-- place instead of copying them into every row payload.
WITH shared_seed AS (
    SELECT
        'sk-yVvFfJmS5Gg8wLNY4kOHvbr0H2ZAGi8VxfSLp2wQbHr9UPZp'::TEXT AS api_key,
        'http://172.31.18.247:13000'::TEXT AS base_url
),
model_seed AS (
    SELECT
        'kimi-k2.6'::TEXT AS name,
        'Kimi K2.6'::TEXT AS display_name,
        'anthropic'::TEXT AS provider,
        jsonb_build_object(
            'use', 'langchain_anthropic:ChatAnthropic',
            'model', 'kimi-k2.6',
            'api_key', shared_seed.api_key,
            'base_url', 'http://model-gateway:3000',
            'supports_vision', TRUE,
            'max_input_tokens', 200000,
            'reasoning', jsonb_build_object(
                'contract', 'anthropic_thinking',
                'default_level', 'auto'
            )
        ) AS config_json,
        TRUE AS enabled
    FROM shared_seed

    UNION ALL

    SELECT
        'GLM-5.1'::TEXT AS name,
        'GLM-5.1'::TEXT AS display_name,
        'anthropic'::TEXT AS provider,
        jsonb_build_object(
            'use', 'langchain_anthropic:ChatAnthropic',
            'model', 'glm-5.1',
            'api_key', shared_seed.api_key,
            'base_url', 'http://model-gateway:3000',
            'supports_vision', FALSE,
            'max_input_tokens', 200000,
            'reasoning', jsonb_build_object(
                'contract', 'anthropic_thinking',
                'default_level', 'auto'
            )
        ) AS config_json,
        TRUE AS enabled
    FROM shared_seed
)
INSERT INTO models (name, display_name, provider, config_json, enabled)
SELECT
    name,
    display_name,
    provider,
    config_json,
    enabled
FROM model_seed
ON CONFLICT (name) DO UPDATE
SET
    display_name = EXCLUDED.display_name,
    provider = EXCLUDED.provider,
    config_json = EXCLUDED.config_json,
    enabled = EXCLUDED.enabled;

-- Default admin account:
-- account: admin
-- password: admin123
WITH admin_seed AS (
    SELECT
        'admin@163.com'::TEXT AS email,
        'admin'::TEXT AS name,
        '$2a$10$c.57yAjkgO031eInR.91Vurdh9BZm2re7OrWk2Gx06tlngnJdyMYi'::TEXT AS password_hash,
        'admin'::TEXT AS role
)
UPDATE users
SET
    password_hash = admin_seed.password_hash,
    role = admin_seed.role,
    updated_at = NOW()
FROM admin_seed
WHERE LOWER(users.name) = LOWER(admin_seed.name);

WITH admin_seed AS (
    SELECT
        'admin@163.com'::TEXT AS email,
        'admin'::TEXT AS name,
        '$2a$10$c.57yAjkgO031eInR.91Vurdh9BZm2re7OrWk2Gx06tlngnJdyMYi'::TEXT AS password_hash,
        'admin'::TEXT AS role
)
INSERT INTO users (email, name, password_hash, role)
SELECT
    admin_seed.email,
    admin_seed.name,
    admin_seed.password_hash,
    admin_seed.role
FROM admin_seed
WHERE NOT EXISTS (
    SELECT 1
    FROM users
    WHERE LOWER(name) = LOWER(admin_seed.name)
);

COMMIT;
