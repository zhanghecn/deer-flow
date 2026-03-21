"""Recover when the model finishes without any visible answer or tool call."""

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
    system_message_text,
)

logger = logging.getLogger(__name__)

_RETRY_TAG = "<visible_response_recovery>"
_RECOVERY_SYSTEM_PROMPT = """
<visible_response_recovery>
- Your previous attempt ended without any user-visible text or tool call.
- Produce a visible next action now.
- If the request is ambiguous, contradictory, or underspecified, call `ask_clarification` immediately.
- Keep `ask_clarification.question` short and focused.
- Put concrete choices in `ask_clarification.options` instead of embedding the option list inside `question`.
- Do not emit more internal thinking.
</visible_response_recovery>
""".strip()


class VisibleResponseRecoveryMiddleware(AgentMiddleware):
    """Retry once when the model ends with invisible reasoning-only output."""

    def _should_retry(self, request: ModelRequest[Any], response: ModelResponse[Any]) -> bool:
        if _RETRY_TAG in system_message_text(request.system_message):
            return False

        message = last_ai_message(response.result)
        if message is None:
            return False

        stop_reason = message_stop_reason(message)
        if stop_reason in {"max_tokens", "length"}:
            return False

        return not has_visible_response(message)

    def _retry_request(self, request: ModelRequest[Any]) -> ModelRequest[Any]:
        model_settings = dict(request.model_settings)
        if getattr(request.model, "thinking", None) is not None:
            model_settings["thinking"] = {"type": "disabled"}

        return request.override(
            system_message=append_to_system_message(
                request.system_message,
                _RECOVERY_SYSTEM_PROMPT,
            ),
            model_settings=model_settings,
        )

    def _handle_retry(
        self,
        request: ModelRequest[Any],
        response: ModelResponse[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        if not self._should_retry(request, response):
            return response

        logger.info(
            "Retrying model call after invisible response with no user-visible output",
            extra={"model": getattr(request.model, "model", None)},
        )
        return handler(self._retry_request(request))

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
        if not self._should_retry(request, response):
            return response

        logger.info(
            "Retrying async model call after invisible response with no user-visible output",
            extra={"model": getattr(request.model, "model", None)},
        )
        return await handler(self._retry_request(request))
