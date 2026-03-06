-- Seed runtime models from repository apikeys data.
-- WARNING: this migration contains API credentials in config_json.
-- Use only in trusted environments and rotate keys if repository visibility changes.

BEGIN;

INSERT INTO models (name, display_name, provider, config_json, enabled)
VALUES
    (
        'glm-5',
        'GLM-5',
        'anthropic',
        '{
          "use": "langchain_anthropic:ChatAnthropic",
          "model": "glm-5",
          "api_key": "sk-sp-7f7dd6439d8e4af0a4241da5e4ea2e8c",
          "base_url": "https://coding.dashscope.aliyuncs.com/apps/anthropic",
          "supports_thinking": true,
          "supports_vision": false,
          "supports_reasoning_effort": false
        }'::jsonb,
        true
    ),
    (
        'kimi-k2.5-1',
        'Kimi K2.5 #1',
        'anthropic',
        '{
          "use": "langchain_anthropic:ChatAnthropic",
          "model": "kimi-k2.5",
          "api_key": "sk-kimi-iTmVzeQofVNhi0NVJVn0gY21zEdrbXpEMlSeX6QotEpYL4op46Fb8TWzsQbPSSn1",
          "base_url": "https://api.kimi.com/coding/",
          "supports_thinking": true,
          "supports_vision": false,
          "supports_reasoning_effort": false
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
          "supports_thinking": true,
          "supports_vision": false,
          "supports_reasoning_effort": false
        }'::jsonb,
        true
    )
ON CONFLICT (name) DO UPDATE
SET
    display_name = EXCLUDED.display_name,
    provider = EXCLUDED.provider,
    config_json = EXCLUDED.config_json,
    enabled = EXCLUDED.enabled;

COMMIT;
