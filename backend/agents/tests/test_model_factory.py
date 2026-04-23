"""Tests for model factory defaults."""

from __future__ import annotations

from src.config.model_config import ModelConfig
from src.models import factory as factory_module


def _anthropic_model_config(**extra) -> ModelConfig:
    payload = {
        "name": "glm-5",
        "display_name": "GLM-5",
        "description": None,
        "use": "langchain_anthropic:ChatAnthropic",
        "model": "glm-5",
        "api_key": "test-key",
        "base_url": "https://example.invalid/anthropic",
        "reasoning": {
            "contract": "anthropic_thinking",
            "default_level": "auto",
        },
    }
    payload.update(extra)
    return ModelConfig.model_validate(payload)


def _openai_model_config(**extra) -> ModelConfig:
    payload = {
        "name": "gpt-5-mini",
        "display_name": "GPT-5 mini",
        "description": None,
        "use": "langchain_openai:ChatOpenAI",
        "model": "gpt-5-mini",
        "api_key": "test-key",
        "base_url": "https://example.invalid/openai",
        "reasoning": {
            "contract": "openai_responses",
            "default_level": "auto",
        },
    }
    payload.update(extra)
    return ModelConfig.model_validate(payload)


def _gemini_budget_model_config(**extra) -> ModelConfig:
    payload = {
        "name": "gemini-2.5-pro",
        "display_name": "Gemini 2.5 Pro",
        "description": None,
        "use": "langchain_google_genai:ChatGoogleGenerativeAI",
        "model": "gemini-2.5-pro",
        "api_key": "test-key",
        "reasoning": {
            "contract": "gemini_budget",
            "default_level": "auto",
        },
    }
    payload.update(extra)
    return ModelConfig.model_validate(payload)


def _gemini_level_model_config(**extra) -> ModelConfig:
    payload = {
        "name": "gemini-3-pro",
        "display_name": "Gemini 3 Pro",
        "description": None,
        "use": "langchain_google_genai:ChatGoogleGenerativeAI",
        "model": "gemini-3-pro",
        "api_key": "test-key",
        "reasoning": {
            "contract": "gemini_level",
            "default_level": "auto",
        },
    }
    payload.update(extra)
    return ModelConfig.model_validate(payload)


def test_create_chat_model_enables_anthropic_thinking_with_default_budget(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(),
    )

    model = factory_module.create_chat_model(name="glm-5", thinking_enabled=True)

    assert model.max_tokens == factory_module.DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS
    assert model.thinking == {"type": "enabled"}


def test_create_chat_model_scales_anthropic_budget_for_max_effort(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(max_tokens=6_144),
    )

    model = factory_module.create_chat_model(
        name="glm-5",
        thinking_enabled=True,
        effort="max",
    )

    assert model.max_tokens == 6_144
    assert model.thinking == {"type": "enabled", "budget_tokens": 5_120}


def test_create_chat_model_attaches_anthropic_retry_observers(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(),
    )

    model = factory_module.create_chat_model(name="glm-5", thinking_enabled=True)

    assert model.max_retries == factory_module.DEFAULT_PROVIDER_MAX_RETRIES
    assert len(model._client._client.event_hooks["request"]) >= 1
    assert len(model._client._client.event_hooks["response"]) >= 1
    assert len(model._async_client._client.event_hooks["request"]) >= 1
    assert len(model._async_client._client.event_hooks["response"]) >= 1


def test_resolve_anthropic_timeout_keeps_missing_value_unset():
    assert factory_module._resolve_anthropic_timeout(None) is None


def test_resolve_anthropic_timeout_preserves_explicit_value():
    assert factory_module._resolve_anthropic_timeout(25.0) == 25.0


def test_should_bypass_env_proxy_for_private_base_url():
    assert factory_module._should_bypass_env_proxy_for_base_url("http://localhost:13000") is True
    assert factory_module._should_bypass_env_proxy_for_base_url("http://model-gateway:3000") is True
    assert factory_module._should_bypass_env_proxy_for_base_url("http://172.31.18.247:13000") is True
    assert factory_module._should_bypass_env_proxy_for_base_url("http://127.0.0.1:13000") is True
    assert factory_module._should_bypass_env_proxy_for_base_url("https://example.invalid/anthropic") is False


def test_create_chat_model_bypasses_env_proxy_for_private_anthropic_base_url(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(base_url="http://model-gateway:3000"),
    )

    sync_calls: list[dict] = []
    async_calls: list[dict] = []
    sync_client_calls: list[dict] = []
    async_client_calls: list[dict] = []

    class _FakeSyncHttpClient:
        def __init__(self, **kwargs) -> None:
            sync_calls.append(kwargs)
            self.event_hooks = {"request": [], "response": []}

    class _FakeAsyncHttpClient:
        def __init__(self, **kwargs) -> None:
            async_calls.append(kwargs)
            self.event_hooks = {"request": [], "response": []}

    monkeypatch.setattr(factory_module.httpx, "Client", _FakeSyncHttpClient)
    monkeypatch.setattr(factory_module.httpx, "AsyncClient", _FakeAsyncHttpClient)
    monkeypatch.setattr(
        factory_module.anthropic,
        "Client",
        lambda **kwargs: sync_client_calls.append(kwargs) or object(),
    )
    monkeypatch.setattr(
        factory_module.anthropic,
        "AsyncClient",
        lambda **kwargs: async_client_calls.append(kwargs) or object(),
    )

    factory_module.create_chat_model(name="glm-5", thinking_enabled=False)

    assert sync_calls
    assert async_calls
    assert sync_client_calls
    assert async_client_calls
    assert sync_calls[0]["trust_env"] is False
    assert async_calls[0]["trust_env"] is False
    # Missing timeout must stay unset so Anthropic-compatible long requests can
    # run past the old 120s fallback when the provider legitimately needs it.
    assert sync_calls[0]["timeout"] is None
    assert async_calls[0]["timeout"] is None
    assert sync_client_calls[0]["timeout"] is None
    assert async_client_calls[0]["timeout"] is None


def test_create_chat_model_preserves_explicit_anthropic_timeout_over_120_seconds(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(
            base_url="http://model-gateway:3000",
            timeout=180.0,
        ),
    )

    sync_calls: list[dict] = []
    async_calls: list[dict] = []
    sync_client_calls: list[dict] = []
    async_client_calls: list[dict] = []

    class _FakeSyncHttpClient:
        def __init__(self, **kwargs) -> None:
            sync_calls.append(kwargs)
            self.event_hooks = {"request": [], "response": []}

    class _FakeAsyncHttpClient:
        def __init__(self, **kwargs) -> None:
            async_calls.append(kwargs)
            self.event_hooks = {"request": [], "response": []}

    monkeypatch.setattr(factory_module.httpx, "Client", _FakeSyncHttpClient)
    monkeypatch.setattr(factory_module.httpx, "AsyncClient", _FakeAsyncHttpClient)
    monkeypatch.setattr(
        factory_module.anthropic,
        "Client",
        lambda **kwargs: sync_client_calls.append(kwargs) or object(),
    )
    monkeypatch.setattr(
        factory_module.anthropic,
        "AsyncClient",
        lambda **kwargs: async_client_calls.append(kwargs) or object(),
    )

    factory_module.create_chat_model(name="glm-5", thinking_enabled=False)

    assert sync_calls[0]["timeout"] == 180.0
    assert async_calls[0]["timeout"] == 180.0
    assert sync_client_calls[0]["timeout"] == 180.0
    assert async_client_calls[0]["timeout"] == 180.0


def test_create_chat_model_does_not_force_disable_streaming_for_kimi_tool_calls(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(
            name="kimi-k2.5",
            model="kimi-k2.5",
        ),
    )

    model = factory_module.create_chat_model(name="kimi-k2.5", thinking_enabled=False)

    assert getattr(model, "disable_streaming", None) != "tool_calling"


def test_create_chat_model_preserves_explicit_disable_streaming_override(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(
            name="kimi-k2.5",
            model="kimi-k2.5",
            disable_streaming=False,
        ),
    )

    model = factory_module.create_chat_model(name="kimi-k2.5", thinking_enabled=False)

    assert model.disable_streaming is False


def test_create_chat_model_uses_openai_reasoning_effort_for_explicit_override(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(
        name="gpt-5-mini",
        thinking_enabled=True,
        effort="max",
    )

    # Custom OpenAI-compatible endpoints stay on the conservative enum set.
    assert model.reasoning_effort == "high"


def test_create_chat_model_uses_openai_xhigh_for_official_openai_max(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(base_url="https://api.openai.com/v1"),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(
        name="gpt-5-mini",
        thinking_enabled=True,
        effort="max",
    )

    assert model.reasoning_effort == "xhigh"


def test_create_chat_model_keeps_openai_auto_reasoning_default_when_no_override(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=True)

    assert getattr(model, "reasoning_effort", None) is None
    assert getattr(model, "reasoning", None) is None


def test_create_chat_model_disables_reasoning_for_official_openai_endpoints(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(base_url=None),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=False)

    assert model.reasoning == {"effort": "none"}


def test_create_chat_model_omits_openai_disable_payload_for_custom_compatible_endpoints(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(base_url="https://example.invalid/openai"),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=False)

    assert getattr(model, "reasoning", None) is None
    assert getattr(model, "reasoning_effort", None) is None


def test_create_chat_model_maps_gemini_budget_contract(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _gemini_budget_model_config(),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(
        name="gemini-2.5-pro",
        thinking_enabled=True,
        effort="max",
    )

    assert model.thinking_budget == 16_384


def test_create_chat_model_maps_gemini_level_contract(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _gemini_level_model_config(),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(
        name="gemini-3-pro",
        thinking_enabled=False,
    )

    assert model.thinking_level == "minimal"


def test_create_chat_model_maps_explicit_runtime_overrides_to_provider_kwargs(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(
        name="gpt-5-mini",
        thinking_enabled=False,
        max_output_tokens=512,
        temperature=0,
    )

    assert model.max_tokens == 512
    assert model.temperature == 0


def test_create_chat_model_defaults_provider_retry_budget(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=True)

    assert model.max_retries == factory_module.DEFAULT_PROVIDER_MAX_RETRIES
    assert model.max_retries == 0


def test_create_chat_model_drops_injected_retry_budget_when_provider_rejects_it(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            if "max_retries" in kwargs:
                raise TypeError("__init__() got an unexpected keyword argument 'max_retries'")
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=True)

    assert getattr(model, "max_retries", None) is None


def test_create_chat_model_attaches_explicit_max_input_tokens(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            self.profile = {}
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _openai_model_config(max_input_tokens=200_000),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=False)

    assert model.profile["max_input_tokens"] == 200_000
