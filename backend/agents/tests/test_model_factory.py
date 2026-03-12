"""Tests for model factory defaults."""

from __future__ import annotations

from src.config.model_config import ModelConfig
from src.models import factory as factory_module


class _Store:
    def __init__(self, model: ModelConfig) -> None:
        self._model = model

    def get_model(self, name: str) -> ModelConfig | None:
        if name == self._model.name:
            return self._model
        return None


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
        "get_runtime_db_store",
        lambda: _Store(_anthropic_model_config()),
    )

    model = factory_module.create_chat_model(name="glm-5", thinking_enabled=True)

    assert model.max_tokens == factory_module.DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS
    assert model.thinking == {"type": "enabled"}


def test_create_chat_model_preserves_explicit_anthropic_budget(monkeypatch):
    monkeypatch.setattr(
        factory_module,
        "get_runtime_db_store",
        lambda: _Store(_anthropic_model_config(max_tokens=6144)),
    )

    model = factory_module.create_chat_model(name="glm-5", thinking_enabled=True)

    assert model.max_tokens == 6144


def test_create_chat_model_defaults_reasoning_effort_when_supported(monkeypatch):
    class FakeModel:
        def __init__(self, **kwargs) -> None:
            self.callbacks = None
            for key, value in kwargs.items():
                setattr(self, key, value)

    monkeypatch.setattr(
        factory_module,
        "get_runtime_db_store",
        lambda: _Store(_openai_model_config()),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=True)

    assert model.reasoning_effort == factory_module.DEFAULT_REASONING_EFFORT


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
        "get_runtime_db_store",
        lambda: _Store(model_config),
    )
    monkeypatch.setattr(factory_module, "resolve_class", lambda *_args, **_kwargs: FakeModel)

    model = factory_module.create_chat_model(name="gpt-5-mini", thinking_enabled=False)

    assert model.extra_body == {"thinking": {"type": "disabled"}}
    assert model.reasoning_effort == factory_module.MINIMAL_REASONING_EFFORT
