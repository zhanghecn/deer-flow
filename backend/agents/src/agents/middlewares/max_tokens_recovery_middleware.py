"""Recover from model responses that stop at max_tokens before taking action."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse

from src.agents.middlewares.model_response_utils import (
    has_visible_response,
    last_ai_message,
    message_stop_reason,
)

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

    def _should_retry(self, response: ModelResponse[Any]) -> bool:
        message = last_ai_message(response.result)
        if message is None:
            return False
        stop_reason = message_stop_reason(message)
        if stop_reason not in {"max_tokens", "length"}:
            return False
        return not has_visible_response(message)

    def _recovery_failure_message(self, response: ModelResponse[Any]) -> str:
        """Explain why a max-tokens recovery attempt still failed visibly.

        Some providers return HTTP 200 with an empty or reasoning-only payload.
        That is not a transport failure, so the retry middleware and trace error
        hooks never fire unless we surface a concrete runtime error here.
        """

        message = last_ai_message(response.result)
        if message is None:
            return (
                "Model ended max_tokens recovery without returning any assistant "
                "message."
            )

        stop_reason = message_stop_reason(message) or "unknown"
        return (
            "Model still produced no visible assistant response after "
            f"max_tokens recovery (stop_reason={stop_reason})."
        )

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
        retry_response = handler(retry_request)
        if self._should_retry(retry_response) or last_ai_message(retry_response.result) is None:
            message = self._recovery_failure_message(retry_response)
            logger.warning(
                message,
                extra={"model": getattr(request.model, "model", None)},
            )
            raise RuntimeError(message)
        return retry_response

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
        retry_response = await handler(retry_request)
        if self._should_retry(retry_response) or last_ai_message(retry_response.result) is None:
            message = self._recovery_failure_message(retry_response)
            logger.warning(
                message,
                extra={"model": getattr(request.model, "model", None)},
            )
            raise RuntimeError(message)
        return retry_response
