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
        "supports_thinking": True,
        "supports_reasoning_effort": False,
        "when_thinking_enabled": {"thinking": {"type": "enabled"}},
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
        "supports_thinking": True,
        "supports_reasoning_effort": True,
    }
    payload.update(extra)
    return ModelConfig.model_validate(payload)


def test_create_chat_model_raises_anthropic_thinking_budget_when_unspecified(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(),
    )

    model = factory_module.create_chat_model(name="glm-5", thinking_enabled=True)

    assert model.max_tokens == factory_module.DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS
    assert model.thinking == {"type": "enabled"}


def test_create_chat_model_preserves_explicit_anthropic_budget(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: _anthropic_model_config(max_tokens=6144),
    )

    model = factory_module.create_chat_model(name="glm-5", thinking_enabled=True)

    assert model.max_tokens == 6144


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


def test_create_chat_model_defaults_reasoning_effort_when_supported(monkeypatch):
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

    assert model.reasoning_effort == factory_module.DEFAULT_REASONING_EFFORT


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


def test_create_chat_model_disables_extra_body_thinking_when_not_requested(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    model_config = _openai_model_config(
        when_thinking_enabled={"extra_body": {"thinking": {"type": "enabled"}}},
    )
    monkeypatch.setattr(
        factory_module,
        "require_enabled_model",
        lambda _name: model_config,
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=False)

    assert model.extra_body == {"thinking": {"type": "disabled"}}
    assert model.reasoning_effort == factory_module.MINIMAL_REASONING_EFFORT


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
