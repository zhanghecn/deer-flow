"""Recover from model responses that stop at max_tokens before taking action."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, BaseMessage

logger = logging.getLogger(__name__)

RECOVERY_SYSTEM_PROMPT = """
<max_tokens_recovery>
- The previous model attempt hit the output token limit before it produced a visible answer or tool call.
- Resume the same task immediately from the existing conversation state.
- Do not repeat prior analysis.
- Do not emit more internal thinking.
- Either call the next tool right away or answer the user directly.
</max_tokens_recovery>
""".strip()


class MaxTokensRecoveryMiddleware(AgentMiddleware):
    """Retry once when the model only emits thinking and stops at max_tokens.

    Some Anthropic-compatible reasoning models spend their entire output budget on
    thinking blocks and return no user-visible text or tool call. In that case the
    agent appears stuck on "Thinking" even though the run has already ended.
    """

    def __init__(self, *, retry_max_tokens: int = 16384) -> None:
        self._retry_max_tokens = retry_max_tokens

    @staticmethod
    def _last_ai_message(messages: list[BaseMessage]) -> AIMessage | None:
        for message in reversed(messages):
            if isinstance(message, AIMessage):
                return message
        return None

    @staticmethod
    def _message_stop_reason(message: AIMessage) -> str | None:
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

    @staticmethod
    def _has_visible_response(message: AIMessage) -> bool:
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

    def _should_retry(self, response: ModelResponse[Any]) -> bool:
        message = self._last_ai_message(response.result)
        if message is None:
            return False
        stop_reason = self._message_stop_reason(message)
        if stop_reason not in {"max_tokens", "length"}:
            return False
        return not self._has_visible_response(message)

    def _retry_request(self, request: ModelRequest[Any]) -> ModelRequest[Any]:
        model_settings = dict(request.model_settings)
        current_max_tokens = model_settings.get("max_tokens", getattr(request.model, "max_tokens", None))
        if isinstance(current_max_tokens, str) and current_max_tokens.isdigit():
            current_max_tokens = int(current_max_tokens)
        if not isinstance(current_max_tokens, int):
            current_max_tokens = 0

        model_settings["max_tokens"] = max(current_max_tokens, self._retry_max_tokens)

        if getattr(request.model, "thinking", None) is not None:
            model_settings["thinking"] = {"type": "disabled"}

        new_system_message = append_to_system_message(
            request.system_message,
            RECOVERY_SYSTEM_PROMPT,
        )
        return request.override(
            system_message=new_system_message,
            model_settings=model_settings,
        )

    def _handle_retry(
        self,
        request: ModelRequest[Any],
        response: ModelResponse[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        if not self._should_retry(response):
            return response

        logger.info(
            "Retrying model call after max_tokens with no visible response",
            extra={"model": getattr(request.model, "model", None)},
        )
        retry_request = self._retry_request(request)
        return handler(retry_request)

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        response = handler(request)
        return self._handle_retry(request, response, handler)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        response = await handler(request)
        if not self._should_retry(response):
            return response

        logger.info(
            "Retrying async model call after max_tokens with no visible response",
            extra={"model": getattr(request.model, "model", None)},
        )
        retry_request = self._retry_request(request)
        return await handler(retry_request)
