#!/usr/bin/env python
"""Direct lead_agent debug runner without frontend.

Examples:
    uv run python debug.py
    uv run python debug.py --message "Reply with OK"
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol, TypedDict, cast

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

# Ensure we can import from src when launched directly.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.agents import make_lead_agent
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
# - set DEBUG_USER_ID to an existing UUID, or leave it as None to auto-pick one from the DB.
# - DEBUG_THREAD_ID is generated once per process to avoid cross-run collisions.
# - set DEBUG_MESSAGE = None to enter interactive REPL mode.

type MessageKey = tuple[object, ...]


class DebugConfigurable(TypedDict):
    thread_id: str
    user_id: str
    model_name: str | None
    thinking_enabled: bool
    is_plan_mode: bool
    subagent_enabled: bool


class RuntimeContext(TypedDict):
    thread_id: str
    user_id: str


class RuntimeState(TypedDict):
    messages: list[BaseMessage]


class RuntimeChunk(TypedDict, total=False):
    messages: list[BaseMessage]


class RuntimeAgent(Protocol):
    def astream(
        self,
        state: RuntimeState,
        *,
        config: RunnableConfig,
        context: RuntimeContext,
        stream_mode: Literal["values"],
    ) -> AsyncIterator[RuntimeChunk]: ...


DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_DEBUG_USER_NAME = "admin"


def _new_debug_thread_id() -> str:
    return f"debug-thread-{uuid.uuid4().hex[:12]}"


DEFAULT_THREAD_ID = _new_debug_thread_id()
DEBUG_THREAD_ID = DEFAULT_THREAD_ID
DEBUG_USER_ID: str | None = None
DEBUG_MODEL_NAME: str | None = "kimi-k2.5-1"
DEBUG_THINKING_ENABLED = True
DEBUG_PLAN_MODE = True
DEBUG_SUBAGENT_ENABLED = True
DEBUG_MESSAGE: str | None = "给我一个惊喜"


@dataclass(frozen=True)
class DebugOptions:
    thread_id: str
    user_id: str
    model_name: str | None
    thinking_enabled: bool
    plan_mode: bool
    subagent_enabled: bool
    message: str | None


@dataclass(frozen=True)
class DebugSession:
    options: DebugOptions
    runtime_agent: RuntimeAgent

    async def run_turn(self, message: str) -> None:
        await _run_runtime_turn(self.runtime_agent, self.options, message)


def _default_model_name() -> str | None:
    try:
        app_config = get_app_config()
    except Exception:
        return None

    if not app_config.models:
        return None
    return app_config.models[0].name


def _default_user_id() -> str:
    configured_user_id = _strip_text(DEBUG_USER_ID)
    if configured_user_id is not None:
        return configured_user_id

    try:
        db_store = get_runtime_db_store()
    except Exception:
        return DEFAULT_USER_ID

    return (
        db_store.get_user_id_by_name(DEFAULT_DEBUG_USER_NAME)
        or db_store.get_any_user_id()
        or DEFAULT_USER_ID
    )


def _strip_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _strip_text_or_default(value: object, fallback: str) -> str:
    return _strip_text(value) or fallback


def _default_options() -> DebugOptions:
    model_name = DEBUG_MODEL_NAME
    if model_name is None:
        model_name = _default_model_name()

    return DebugOptions(
        thread_id=DEBUG_THREAD_ID,
        user_id=_default_user_id(),
        model_name=model_name,
        thinking_enabled=DEBUG_THINKING_ENABLED,
        plan_mode=DEBUG_PLAN_MODE,
        subagent_enabled=DEBUG_SUBAGENT_ENABLED,
        message=_strip_text(DEBUG_MESSAGE) if DEBUG_MESSAGE is not None else None,
    )


def parse_args(argv: Sequence[str] | None = None) -> DebugOptions:
    defaults = _default_options()
    parser = argparse.ArgumentParser(description="Direct lead_agent debug runner")
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
        thread_id=_strip_text_or_default(args.thread_id, defaults.thread_id or DEFAULT_THREAD_ID),
        user_id=_strip_text_or_default(args.user_id, defaults.user_id or DEFAULT_USER_ID),
        model_name=_strip_text(args.model_name) if args.model_name is not None else None,
        thinking_enabled=bool(args.thinking_enabled),
        plan_mode=bool(args.plan_mode),
        subagent_enabled=bool(args.subagent_enabled),
        message=_strip_text(args.message) if args.message is not None else None,
    )


def build_runnable_config(options: DebugOptions) -> RunnableConfig:
    configurable: DebugConfigurable = {
        "thread_id": options.thread_id,
        "user_id": options.user_id,
        "model_name": options.model_name,
        "thinking_enabled": options.thinking_enabled,
        "is_plan_mode": options.plan_mode,
        "subagent_enabled": options.subagent_enabled,
    }
    return RunnableConfig(configurable=configurable)


def validate_runtime_options(options: DebugOptions) -> None:
    try:
        uuid.UUID(options.user_id)
    except ValueError as exc:
        raise ValueError(
            f"Runtime mode requires a valid UUID user_id, got: {options.user_id!r}"
        ) from exc

    db_store = get_runtime_db_store()
    if options.model_name is None:
        return

    model = db_store.get_model(options.model_name)
    if model is None:
        raise ValueError(
            f"Model {options.model_name!r} was not found in the runtime database. "
            "Use --model-name with a seeded DB model."
        )


async def _initialize_mcp_tools() -> None:
    try:
        from src.mcp import initialize_mcp_tools

        await initialize_mcp_tools()
    except Exception as exc:
        print(f"Warning: Failed to initialize MCP tools: {exc}")


def _extract_text_block(block: object) -> str | None:
    if isinstance(block, str):
        return block
    if not isinstance(block, Mapping):
        return None

    block_type = block.get("type")
    text = block.get("text")
    if block_type == "text" and isinstance(text, str) and text:
        return text
    return None


def _extract_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            text = _extract_text_block(block)
            if text:
                parts.append(text)
        return "\n".join(parts)
    return str(content)


def _extract_reasoning_block(block: object) -> str | None:
    if not isinstance(block, Mapping):
        return None

    block_type = block.get("type")
    if block_type not in {"thinking", "reasoning"}:
        return None

    for key in ("thinking", "reasoning", "reasoning_content", "text"):
        value = block.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _extract_reasoning(content: object) -> str:
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for block in content:
        reasoning = _extract_reasoning_block(block)
        if reasoning:
            parts.append(reasoning)
    return "\n".join(parts)


def _print_ai_message(message: AIMessage) -> None:
    if message.tool_calls:
        for tool_call in message.tool_calls:
            print(f"\nTool Call [{tool_call['name']}]: {tool_call['args']}")

    reasoning = (
        message.additional_kwargs.get("reasoning_content")
        if isinstance(message.additional_kwargs, dict)
        else None
    )
    if not isinstance(reasoning, str) or not reasoning.strip():
        reasoning = _extract_reasoning(message.content)
    if isinstance(reasoning, str) and reasoning.strip():
        print(f"\nReasoning: {reasoning.strip()}")

    text = _extract_text(message.content).strip()
    if text:
        print(f"\nAgent: {text}")


def _print_tool_message(message: ToolMessage) -> None:
    name = getattr(message, "name", None) or "tool"
    print(f"\nTool Result [{name}]: {message.content}")


def _message_key(message: BaseMessage) -> MessageKey:
    message_id = getattr(message, "id", None)
    if message_id:
        return ("id", message_id)
    return (
        type(message).__name__,
        getattr(message, "name", None),
        getattr(message, "tool_call_id", None),
        _extract_text(getattr(message, "content", "")),
    )


def _print_new_langchain_messages(messages: Sequence[BaseMessage], seen: set[MessageKey]) -> None:
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

async def _run_runtime_turn(agent: RuntimeAgent, options: DebugOptions, message: str) -> None:
    config = build_runnable_config(options)
    messages: list[BaseMessage] = [HumanMessage(content=message)]
    state: RuntimeState = {"messages": messages}
    context: RuntimeContext = {
        "thread_id": options.thread_id,
        "user_id": options.user_id,
    }
    seen: set[MessageKey] = set()

    async for chunk in agent.astream(
        state,
        config=config,
        context=context,
        stream_mode="values",
    ):
        _print_new_langchain_messages(chunk.get("messages") or [], seen)

async def _build_runtime_agent(options: DebugOptions) -> RuntimeAgent:
    validate_runtime_options(options)
    config = build_runnable_config(options)
    return cast(RuntimeAgent, await make_lead_agent(config))


async def _build_debug_session(options: DebugOptions) -> DebugSession:
    await _initialize_mcp_tools()
    return DebugSession(options=options, runtime_agent=await _build_runtime_agent(options))


def _print_session_banner(options: DebugOptions) -> None:
    print("=" * 60)
    print("Lead Agent Debug Mode")
    print(f"Thread ID: {options.thread_id}")
    print(f"User ID: {options.user_id}")
    print(f"Model: {options.model_name or '<runtime-resolved>'}")
    print("Type 'quit' or 'exit' to stop")
    print("=" * 60)


def _read_prompt() -> str | None:
    try:
        prompt = input("\nYou: ").strip()
    except EOFError:
        print("\nGoodbye!")
        return None

    if prompt.lower() in {"quit", "exit"}:
        print("Goodbye!")
        return None
    return prompt


async def _interactive_loop(options: DebugOptions) -> None:
    session = await _build_debug_session(options)
    _print_session_banner(options)

    while True:
        prompt = _read_prompt()
        if prompt is None:
            return
        if not prompt:
            continue

        try:
            await session.run_turn(prompt)
        except Exception as exc:
            print(f"\nError: {exc}")
            logging.exception("Lead agent debug turn failed")


async def _run_single_message(options: DebugOptions, message: str) -> None:
    session = await _build_debug_session(options)
    await session.run_turn(message)


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
