"""Tests for the direct lead_agent debug runner."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

import debug as debug_module


def test_parse_args_uses_quick_edit_defaults(monkeypatch):
    monkeypatch.setattr(debug_module, "DEBUG_THREAD_ID", "thread-from-file")
    monkeypatch.setattr(debug_module, "DEBUG_USER_ID", "00000000-0000-0000-0000-000000000111")
    monkeypatch.setattr(debug_module, "DEBUG_MODEL_NAME", None)
    monkeypatch.setattr(debug_module, "DEBUG_THINKING_ENABLED", False)
    monkeypatch.setattr(debug_module, "DEBUG_PLAN_MODE", True)
    monkeypatch.setattr(debug_module, "DEBUG_SUBAGENT_ENABLED", True)
    monkeypatch.setattr(debug_module, "DEBUG_MESSAGE", "hello from file")
    monkeypatch.setattr(debug_module, "_default_model_name", lambda: "glm-5")

    options = debug_module.parse_args([])

    assert options.thread_id == "thread-from-file"
    assert options.user_id == "00000000-0000-0000-0000-000000000111"
    assert options.model_name == "glm-5"
    assert options.thinking_enabled is False
    assert options.plan_mode is True
    assert options.subagent_enabled is True
    assert options.message == "hello from file"


def test_parse_args_auto_resolves_existing_runtime_user(monkeypatch):
    fake_store = Mock()
    fake_store.get_user_id_by_name.return_value = "00000000-0000-0000-0000-000000000222"
    fake_store.get_any_user_id.return_value = None
    monkeypatch.setattr(debug_module, "DEBUG_USER_ID", None)
    monkeypatch.setattr(debug_module, "DEBUG_MODEL_NAME", None)
    monkeypatch.setattr(debug_module, "_default_model_name", lambda: "glm-5")
    monkeypatch.setattr(debug_module, "get_runtime_db_store", lambda: fake_store)

    options = debug_module.parse_args([])

    assert options.user_id == "00000000-0000-0000-0000-000000000222"
    fake_store.get_user_id_by_name.assert_called_once_with(debug_module.DEFAULT_DEBUG_USER_NAME)
    fake_store.get_any_user_id.assert_not_called()


def test_build_runnable_config_includes_runtime_identity():
    options = debug_module.DebugOptions(
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


def test_new_debug_thread_id_is_unique():
    first = debug_module._new_debug_thread_id()
    second = debug_module._new_debug_thread_id()

    assert first.startswith("debug-thread-")
    assert second.startswith("debug-thread-")
    assert first != second


def test_extract_text_reads_only_plain_text_blocks():
    content = [
        "line one",
        {"type": "text", "text": "line two"},
        {"type": "image", "url": "https://example.com/image.png"},
        123,
    ]

    assert debug_module._extract_text(content) == "line one\nline two"


def test_strip_text_returns_none_for_blank_values():
    assert debug_module._strip_text(None) is None
    assert debug_module._strip_text("   ") is None
    assert debug_module._strip_text(" value ") == "value"


def test_debug_session_runs_runtime_turn(monkeypatch):
    options = debug_module.DebugOptions(
        thread_id="thread-123",
        user_id="00000000-0000-0000-0000-000000000099",
        model_name="glm-5",
        thinking_enabled=True,
        plan_mode=False,
        subagent_enabled=False,
        message=None,
    )
    runtime_agent = Mock()
    run_runtime_turn = AsyncMock()
    monkeypatch.setattr(debug_module, "_run_runtime_turn", run_runtime_turn)

    session = debug_module.DebugSession(options=options, runtime_agent=runtime_agent)

    asyncio.run(session.run_turn("hello"))

    run_runtime_turn.assert_awaited_once_with(runtime_agent, options, "hello")


def test_build_debug_session_uses_runtime_agent(monkeypatch):
    options = debug_module.DebugOptions(
        thread_id="thread-123",
        user_id="00000000-0000-0000-0000-000000000099",
        model_name="glm-5",
        thinking_enabled=True,
        plan_mode=False,
        subagent_enabled=False,
        message=None,
    )
    initialize_mcp_tools = AsyncMock()
    runtime_agent = Mock()
    build_runtime_agent = AsyncMock(return_value=runtime_agent)
    monkeypatch.setattr(debug_module, "_initialize_mcp_tools", initialize_mcp_tools)
    monkeypatch.setattr(debug_module, "_build_runtime_agent", build_runtime_agent)

    session = asyncio.run(debug_module._build_debug_session(options))

    assert session == debug_module.DebugSession(options=options, runtime_agent=runtime_agent)
    initialize_mcp_tools.assert_awaited_once_with()
    build_runtime_agent.assert_awaited_once_with(options)


def test_validate_runtime_options_rejects_non_uuid_user_id():
    options = debug_module.DebugOptions(
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
