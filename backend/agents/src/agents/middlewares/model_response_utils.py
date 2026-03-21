"""Helpers for inspecting model responses emitted by agent middlewares."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage


def last_ai_message(messages: Sequence[BaseMessage]) -> AIMessage | None:
    """Return the most recent AI message in a response payload."""

    for message in reversed(messages):
        if isinstance(message, AIMessage):
            return message
    return None


def message_stop_reason(message: AIMessage) -> str | None:
    """Return the normalized stop reason from provider metadata if available."""

    response_metadata = getattr(message, "response_metadata", None)
    if not isinstance(response_metadata, dict):
        return None
    for key in ("stop_reason", "finish_reason"):
        value = response_metadata.get(key)
        if value is None:
            continue
        text = str(value).strip().lower()
        if text:
            return text
    return None


def has_visible_response(message: AIMessage) -> bool:
    """Return whether the model produced user-visible text or any tool call."""

    if message.tool_calls:
        return True

    content = message.content
    if isinstance(content, str):
        return bool(content.strip())
    if not isinstance(content, list):
        return False

    for block in content:
        if isinstance(block, str) and block.strip():
            return True
        if not isinstance(block, dict):
            continue
        if block.get("type") != "text":
            continue
        text = block.get("text")
        if isinstance(text, str) and text.strip():
            return True
    return False


def system_message_text(system_message: Any) -> str:
    """Convert a system message payload into plain text for recovery guards."""

    return getattr(system_message, "text", None) or str(system_message or "")
