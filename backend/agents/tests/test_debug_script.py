"""Tests for the direct lead_agent debug runner."""

from __future__ import annotations

from unittest.mock import Mock

import pytest

import debug as debug_module


def test_parse_args_uses_quick_edit_defaults(monkeypatch):
    monkeypatch.setattr(debug_module, "DEBUG_MODE", "embedded")
    monkeypatch.setattr(debug_module, "DEBUG_THREAD_ID", "thread-from-file")
    monkeypatch.setattr(debug_module, "DEBUG_USER_ID", "00000000-0000-0000-0000-000000000111")
    monkeypatch.setattr(debug_module, "DEBUG_MODEL_NAME", None)
    monkeypatch.setattr(debug_module, "DEBUG_THINKING_ENABLED", False)
    monkeypatch.setattr(debug_module, "DEBUG_PLAN_MODE", True)
    monkeypatch.setattr(debug_module, "DEBUG_SUBAGENT_ENABLED", True)
    monkeypatch.setattr(debug_module, "DEBUG_MESSAGE", "hello from file")
    monkeypatch.setattr(debug_module, "_default_model_name", lambda: "glm-5")

    options = debug_module.parse_args([])

    assert options.mode == "embedded"
    assert options.thread_id == "thread-from-file"
    assert options.user_id == "00000000-0000-0000-0000-000000000111"
    assert options.model_name == "glm-5"
    assert options.thinking_enabled is False
    assert options.plan_mode is True
    assert options.subagent_enabled is True
    assert options.message == "hello from file"


def test_build_runnable_config_includes_runtime_identity():
    options = debug_module.DebugOptions(
        mode="runtime",
        thread_id="thread-123",
        user_id="00000000-0000-0000-0000-000000000099",
        model_name="glm-5",
        thinking_enabled=False,
        plan_mode=True,
        subagent_enabled=True,
        message="hello",
    )

    config = debug_module.build_runnable_config(options)

    assert config == {
        "configurable": {
            "thread_id": "thread-123",
            "user_id": "00000000-0000-0000-0000-000000000099",
            "model_name": "glm-5",
            "thinking_enabled": False,
            "is_plan_mode": True,
            "subagent_enabled": True,
        }
    }


def test_validate_runtime_options_rejects_non_uuid_user_id():
    options = debug_module.DebugOptions(
        mode="runtime",
        thread_id="thread-123",
        user_id="not-a-uuid",
        model_name="glm-5",
        thinking_enabled=True,
        plan_mode=False,
        subagent_enabled=False,
        message=None,
    )

    with pytest.raises(ValueError, match="valid UUID"):
        debug_module.validate_runtime_options(options)


def test_validate_runtime_options_requires_seeded_runtime_model(monkeypatch):
    fake_store = Mock()
    fake_store.get_model.return_value = None
    monkeypatch.setattr(debug_module, "get_runtime_db_store", lambda: fake_store)

    options = debug_module.DebugOptions(
        mode="runtime",
        thread_id="thread-123",
        user_id=debug_module.DEFAULT_USER_ID,
        model_name="missing-model",
        thinking_enabled=True,
        plan_mode=False,
        subagent_enabled=False,
        message=None,
    )

    with pytest.raises(ValueError, match="runtime database"):
        debug_module.validate_runtime_options(options)
