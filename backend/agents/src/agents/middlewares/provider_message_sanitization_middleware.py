"""Normalize provider-specific message blocks before they reach model APIs."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from typing import Any, override

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import BaseMessage


class ProviderMessageSanitizationMiddleware(AgentMiddleware):
    """Remove malformed provider-native blocks from model request history.

    Anthropic-compatible providers may stream a final ``thinking`` block that
    contains only metadata such as ``signature`` and ``index``. That block is not
    valid when replayed as conversation history: the API requires a ``thinking``
    field for every ``type=thinking`` block. Sanitizing at the model boundary
    lets existing corrupted checkpoints continue while also preventing newly
    returned malformed blocks from being persisted.
    """

    @override
    def wrap_model_call[ResponseT](
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[ResponseT]],
    ) -> ModelResponse[ResponseT]:
        sanitized_request = request.override(messages=sanitize_messages(request.messages))
        response = handler(sanitized_request)
        return _sanitize_model_response(response)

    @override
    async def awrap_model_call[ResponseT](
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[ResponseT]]],
    ) -> ModelResponse[ResponseT]:
        sanitized_request = request.override(messages=sanitize_messages(request.messages))
        response = await handler(sanitized_request)
        return _sanitize_model_response(response)


def sanitize_messages(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
    """Return messages with malformed provider content blocks removed."""

    return [sanitize_message(message) for message in messages]


def sanitize_message(message: BaseMessage) -> BaseMessage:
    """Return a copy of ``message`` if provider-native blocks need cleanup."""

    content = message.content
    if not isinstance(content, list):
        return message

    sanitized_content: list[Any] = []
    changed = False
    for block in content:
        if _is_malformed_thinking_block(block):
            changed = True
            continue
        sanitized_content.append(block)

    if not changed:
        return message

    return message.model_copy(update={"content": sanitized_content})


def _sanitize_model_response[ResponseT](response: ModelResponse[ResponseT]) -> ModelResponse[ResponseT]:
    sanitized_result = sanitize_messages(response.result)
    if all(original is sanitized for original, sanitized in zip(response.result, sanitized_result, strict=True)):
        return response
    return ModelResponse(
        result=sanitized_result,
        structured_response=response.structured_response,
    )


def _is_malformed_thinking_block(block: Any) -> bool:
    if not isinstance(block, dict) or block.get("type") != "thinking":
        return False
    thinking = block.get("thinking")
    return not isinstance(thinking, str) or not thinking.strip()
