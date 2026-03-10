#!/usr/bin/env python
"""Direct lead_agent debug runner without frontend.

Supports two execution modes:

- runtime: create the real lead_agent via ``make_lead_agent()``.
- embedded: use ``OpenAgentsClient`` for a lighter in-process smoke test.

Examples:
    uv run python debug.py
    uv run python debug.py --message "Reply with OK"
    uv run python debug.py --mode embedded --message "List available skills"
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

# Ensure we can import from src when launched directly.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.agents import make_lead_agent
from src.client import OpenAgentsClient, StreamEvent
from src.config.app_config import get_app_config
from src.config.runtime_db import get_runtime_db_store

# ---------------------------------------------------------------------------
# Quick Edit
# ---------------------------------------------------------------------------
# Change these variables directly, then run:
#   cd backend/agents
#   uv run python debug.py
#
# Notes:
# - runtime mode requires DEBUG_USER_ID to exist in the `users` table.
# - set DEBUG_MESSAGE = None to enter interactive REPL mode.

DEFAULT_MODE: Literal["runtime", "embedded"] = "runtime"
DEFAULT_THREAD_ID = "debug-thread-001"
DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"

DEBUG_MODE: Literal["runtime", "embedded"] = "runtime"
DEBUG_THREAD_ID = "real-test-001"
DEBUG_USER_ID = "79533825-1bb8-435d-9256-049691b655e0"
DEBUG_MODEL_NAME: str | None = "glm-5"
DEBUG_THINKING_ENABLED = True
DEBUG_PLAN_MODE = False
DEBUG_SUBAGENT_ENABLED = False
DEBUG_MESSAGE: str | None = "Reply with exactly: REAL_TEST_OK"


@dataclass(frozen=True)
class DebugOptions:
    mode: Literal["runtime", "embedded"]
    thread_id: str
    user_id: str
    model_name: str | None
    thinking_enabled: bool
    plan_mode: bool
    subagent_enabled: bool
    message: str | None


def _default_model_name() -> str | None:
    try:
        app_config = get_app_config()
    except Exception:
        return None

    if not app_config.models:
        return None
    return app_config.models[0].name


def _default_options() -> DebugOptions:
    model_name = DEBUG_MODEL_NAME
    if model_name is None:
        model_name = _default_model_name()

    return DebugOptions(
        mode=DEBUG_MODE,
        thread_id=DEBUG_THREAD_ID,
        user_id=DEBUG_USER_ID,
        model_name=model_name,
        thinking_enabled=DEBUG_THINKING_ENABLED,
        plan_mode=DEBUG_PLAN_MODE,
        subagent_enabled=DEBUG_SUBAGENT_ENABLED,
        message=DEBUG_MESSAGE.strip() if isinstance(DEBUG_MESSAGE, str) and DEBUG_MESSAGE.strip() else None,
    )


def parse_args(argv: Sequence[str] | None = None) -> DebugOptions:
    defaults = _default_options()
    parser = argparse.ArgumentParser(description="Direct lead_agent debug runner")
    parser.add_argument(
        "--mode",
        choices=("runtime", "embedded"),
        default=defaults.mode,
        help="runtime: call make_lead_agent directly; embedded: use OpenAgentsClient",
    )
    parser.add_argument(
        "--thread-id",
        default=defaults.thread_id,
        help="Thread ID used for workspace isolation",
    )
    parser.add_argument(
        "--user-id",
        default=defaults.user_id,
        help="User ID. Runtime mode should use a valid UUID because thread bindings are stored in PostgreSQL.",
    )
    parser.add_argument(
        "--model-name",
        default=defaults.model_name,
        help="Model name to use. Defaults to the first configured model when available.",
    )
    parser.add_argument(
        "--message",
        default=defaults.message,
        help="Run one prompt and exit. If omitted, start an interactive REPL.",
    )
    parser.add_argument(
        "--thinking-enabled",
        action=argparse.BooleanOptionalAction,
        default=defaults.thinking_enabled,
        help="Enable or disable thinking mode for this session.",
    )
    parser.add_argument(
        "--plan-mode",
        action=argparse.BooleanOptionalAction,
        default=defaults.plan_mode,
        help="Enable or disable plan/todo mode.",
    )
    parser.add_argument(
        "--subagent-enabled",
        action=argparse.BooleanOptionalAction,
        default=defaults.subagent_enabled,
        help="Enable or disable subagent delegation.",
    )

    args = parser.parse_args(argv)
    return DebugOptions(
        mode=args.mode,
        thread_id=str(args.thread_id).strip() or defaults.thread_id or DEFAULT_THREAD_ID,
        user_id=str(args.user_id).strip() or defaults.user_id or DEFAULT_USER_ID,
        model_name=str(args.model_name).strip() if args.model_name else None,
        thinking_enabled=bool(args.thinking_enabled),
        plan_mode=bool(args.plan_mode),
        subagent_enabled=bool(args.subagent_enabled),
        message=str(args.message).strip() if args.message else None,
    )


def build_runnable_config(options: DebugOptions) -> dict[str, Any]:
    return {
        "configurable": {
            "thread_id": options.thread_id,
            "user_id": options.user_id,
            "model_name": options.model_name,
            "thinking_enabled": options.thinking_enabled,
            "is_plan_mode": options.plan_mode,
            "subagent_enabled": options.subagent_enabled,
        }
    }


def validate_runtime_options(options: DebugOptions) -> None:
    try:
        uuid.UUID(options.user_id)
    except ValueError as exc:
        raise ValueError(
            f"Runtime mode requires a valid UUID user_id, got: {options.user_id!r}"
        ) from exc

    if options.model_name is None:
        return

    model = get_runtime_db_store().get_model(options.model_name)
    if model is None:
        raise ValueError(
            f"Model {options.model_name!r} was not found in the runtime database. "
            "Use --model-name with a seeded DB model or switch to --mode embedded."
        )


async def _initialize_mcp_tools() -> None:
    try:
        from src.mcp import initialize_mcp_tools

        await initialize_mcp_tools()
    except Exception as exc:
        print(f"Warning: Failed to initialize MCP tools: {exc}")


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
                continue
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text:
                    parts.append(text)
        return "\n".join(parts)
    return str(content)


def _print_ai_message(message: AIMessage) -> None:
    if message.tool_calls:
        for tool_call in message.tool_calls:
            print(f"\nTool Call [{tool_call['name']}]: {tool_call['args']}")

    text = _extract_text(message.content).strip()
    if text:
        print(f"\nAgent: {text}")


def _print_tool_message(message: ToolMessage) -> None:
    name = getattr(message, "name", None) or "tool"
    print(f"\nTool Result [{name}]: {message.content}")


def _message_key(message: Any) -> tuple[Any, ...]:
    message_id = getattr(message, "id", None)
    if message_id:
        return ("id", message_id)
    return (
        type(message).__name__,
        getattr(message, "name", None),
        getattr(message, "tool_call_id", None),
        _extract_text(getattr(message, "content", "")),
    )


def _print_new_langchain_messages(messages: list[Any], seen: set[tuple[Any, ...]]) -> None:
    for message in messages:
        if isinstance(message, HumanMessage):
            continue
        key = _message_key(message)
        if key in seen:
            continue
        seen.add(key)

        if isinstance(message, AIMessage):
            _print_ai_message(message)
            continue
        if isinstance(message, ToolMessage):
            _print_tool_message(message)


def _print_stream_event(event: StreamEvent) -> None:
    if event.type != "messages-tuple":
        return

    event_type = event.data.get("type")
    if event_type == "ai":
        for tool_call in event.data.get("tool_calls", []):
            print(f"\nTool Call [{tool_call['name']}]: {tool_call['args']}")
        content = str(event.data.get("content", "")).strip()
        if content:
            print(f"\nAgent: {content}")
        return

    if event_type == "tool":
        name = event.data.get("name") or "tool"
        content = event.data.get("content", "")
        print(f"\nTool Result [{name}]: {content}")


async def _run_runtime_turn(agent: Any, options: DebugOptions, message: str) -> None:
    config = build_runnable_config(options)
    state = {"messages": [HumanMessage(content=message)]}
    context = {
        "thread_id": options.thread_id,
        "user_id": options.user_id,
    }
    seen: set[tuple[Any, ...]] = set()

    async for chunk in agent.astream(
        state,
        config=config,
        context=context,
        stream_mode="values",
    ):
        _print_new_langchain_messages(chunk.get("messages", []), seen)


def _run_embedded_turn(client: OpenAgentsClient, options: DebugOptions, message: str) -> None:
    for event in client.stream(
        message,
        thread_id=options.thread_id,
        user_id=options.user_id,
        model_name=options.model_name,
        thinking_enabled=options.thinking_enabled,
        plan_mode=options.plan_mode,
        subagent_enabled=options.subagent_enabled,
    ):
        _print_stream_event(event)


async def _build_runtime_agent(options: DebugOptions) -> Any:
    validate_runtime_options(options)
    config = build_runnable_config(options)
    return await make_lead_agent(config)


def _build_embedded_client(options: DebugOptions) -> OpenAgentsClient:
    return OpenAgentsClient(
        model_name=options.model_name,
        thinking_enabled=options.thinking_enabled,
        subagent_enabled=options.subagent_enabled,
        plan_mode=options.plan_mode,
    )


async def _interactive_loop(options: DebugOptions) -> None:
    await _initialize_mcp_tools()

    runtime_agent = None
    embedded_client = None
    if options.mode == "runtime":
        runtime_agent = await _build_runtime_agent(options)
    else:
        embedded_client = _build_embedded_client(options)

    print("=" * 60)
    print("Lead Agent Debug Mode")
    print(f"Mode: {options.mode}")
    print(f"Thread ID: {options.thread_id}")
    print(f"User ID: {options.user_id}")
    print(f"Model: {options.model_name or '<runtime-resolved>'}")
    print("Type 'quit' or 'exit' to stop")
    print("=" * 60)

    while True:
        try:
            prompt = input("\nYou: ").strip()
        except EOFError:
            print("\nGoodbye!")
            return

        if not prompt:
            continue
        if prompt.lower() in {"quit", "exit"}:
            print("Goodbye!")
            return

        try:
            if runtime_agent is not None:
                await _run_runtime_turn(runtime_agent, options, prompt)
            else:
                assert embedded_client is not None
                _run_embedded_turn(embedded_client, options, prompt)
        except Exception as exc:
            print(f"\nError: {exc}")
            logging.exception("Lead agent debug turn failed")


async def _run_single_message(options: DebugOptions, message: str) -> None:
    await _initialize_mcp_tools()

    if options.mode == "runtime":
        runtime_agent = await _build_runtime_agent(options)
        await _run_runtime_turn(runtime_agent, options, message)
        return

    embedded_client = _build_embedded_client(options)
    _run_embedded_turn(embedded_client, options, message)


async def main(argv: Sequence[str] | None = None) -> int:
    options = parse_args(argv)

    if options.message:
        await _run_single_message(options, options.message)
        return 0

    await _interactive_loop(options)
    return 0


if __name__ == "__main__":
    load_dotenv()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    try:
        raise SystemExit(asyncio.run(main()))
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
