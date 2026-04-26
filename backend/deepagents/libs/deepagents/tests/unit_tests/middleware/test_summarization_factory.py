"""Unit tests for the summarization middleware factory."""

import sys
import types
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from langchain_core.messages import AIMessage

from deepagents.middleware.summarization import create_summarization_middleware
from tests.unit_tests.chat_model import GenericFakeChatModel


def _make_model(*, with_profile_limit: int | None) -> GenericFakeChatModel:
    """Create a fake model optionally configured with a max input token limit."""
    model = GenericFakeChatModel(messages=iter([AIMessage(content="ok")]))
    if with_profile_limit is None:
        model.profile = None
    else:
        model.profile = {"max_input_tokens": with_profile_limit}
    return model


def test_factory_uses_profile_based_defaults() -> None:
    """Uses fraction-based defaults when model profile has `max_input_tokens`."""
    model = _make_model(with_profile_limit=120_000)
    middleware = create_summarization_middleware(model, cast("Any", MagicMock()))

    assert middleware._lc_helper.trigger == ("fraction", 0.85)
    assert middleware._lc_helper.keep == ("fraction", 0.10)
    assert middleware._lc_helper.trim_tokens_to_summarize is None
    assert middleware._truncate_args_trigger == ("fraction", 0.85)
    assert middleware._truncate_args_keep == ("fraction", 0.10)


def test_factory_uses_fallback_defaults_without_profile() -> None:
    """Uses fixed token/message defaults when no model profile is available."""
    model = _make_model(with_profile_limit=None)
    middleware = create_summarization_middleware(model, cast("Any", MagicMock()))

    assert middleware._lc_helper.trigger == ("tokens", 170000)
    assert middleware._lc_helper.keep == ("messages", 6)
    assert middleware._truncate_args_trigger == ("messages", 20)
    assert middleware._truncate_args_keep == ("messages", 20)


def test_factory_rejects_string_model() -> None:
    """Raises `TypeError` when called with a string model name."""
    with pytest.raises(TypeError, match="BaseChatModel"):
        create_summarization_middleware("openai:gpt-5", cast("Any", MagicMock()))  # type: ignore[arg-type]


def test_factory_uses_openagents_overrides_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    """OpenAgents runtime config should override model-derived defaults."""
    model = _make_model(with_profile_limit=120_000)

    class _ContextSize:
        def __init__(self, type_: str, value: float) -> None:
            self.type = type_
            self.value = value

        def to_tuple(self) -> tuple[str, int | float]:
            return (self.type, self.value)

    config_module = types.ModuleType("src.config.summarization_config")
    config_module.CLAUDE_CODE_COMPACTION_PROMPT = "Default OpenAgents compact prompt: {messages}"
    config_module.get_summarization_config = lambda: types.SimpleNamespace(
        enabled=True,
        model_name=None,
        trigger=[_ContextSize("messages", 24), _ContextSize("tokens", 12_000)],
        keep=_ContextSize("messages", 8),
        trim_tokens_to_summarize=6000,
        summary_prompt="Keep only durable context.",
    )

    src_module = types.ModuleType("src")
    src_config_module = types.ModuleType("src.config")
    monkeypatch.setitem(sys.modules, "src", src_module)
    monkeypatch.setitem(sys.modules, "src.config", src_config_module)
    monkeypatch.setitem(sys.modules, "src.config.summarization_config", config_module)

    middleware = create_summarization_middleware(model, cast("Any", MagicMock()))

    assert middleware._lc_helper.trigger == [("messages", 24), ("tokens", 12_000)]
    assert middleware._lc_helper.keep == ("messages", 8)
    assert middleware._lc_helper.trim_tokens_to_summarize == 6000
    assert middleware._lc_helper.summary_prompt == "Keep only durable context."
