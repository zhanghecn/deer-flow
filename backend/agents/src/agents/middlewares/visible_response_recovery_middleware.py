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
- If the request is ambiguous, contradictory, or underspecified, call `question` immediately.
- Ask the smallest set of focused questions needed to continue safely.
- If multiple answers are tightly related, keep them as multiple `question.questions[]` entries in one request instead of collapsing them unnaturally.
- Start with the highest-leverage questions first instead of dumping every secondary uncertainty into the same request.
- Put the prompt under each `question.questions[].question` entry and keep it short and focused.
- Do not turn the question into a long memo, feasibility report, or multi-paragraph option dump.
- Put concrete choices in `question.questions[].options` as `{label, description}` objects instead of embedding the option list inside the question text.
- When you can enumerate sensible defaults, provide 2-4 concrete options instead of making the question pure free text.
- Keep option labels short and move supporting detail into `description`.
- Do not add an "Other" option; typed custom input is handled by the UI when `custom` stays enabled.
- Do not emit more internal thinking.
</visible_response_recovery>
""".strip()


class VisibleResponseRecoveryMiddleware(AgentMiddleware):
    """Retry once when the model ends with invisible reasoning-only output."""

    def _response_gap_reason(
        self,
        response: ModelResponse[Any],
        *,
        allow_max_tokens: bool,
    ) -> str | None:
        message = last_ai_message(response.result)
        if message is None:
            return "provider returned no assistant message"

        stop_reason = message_stop_reason(message)
        if not allow_max_tokens and stop_reason in {"max_tokens", "length"}:
            return None

        if has_visible_response(message):
            return None

        normalized_stop_reason = stop_reason or "unknown"
        return (
            "assistant message had no visible text or tool call "
            f"(stop_reason={normalized_stop_reason})"
        )

    def _should_retry(self, request: ModelRequest[Any], response: ModelResponse[Any]) -> bool:
        if _RETRY_TAG in system_message_text(request.system_message):
            return False

        return self._response_gap_reason(response, allow_max_tokens=False) is not None

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
        retry_response = handler(self._retry_request(request))
        remaining_gap = self._response_gap_reason(
            retry_response,
            allow_max_tokens=True,
        )
        if remaining_gap is not None:
            message = (
                "Model produced no visible assistant response after recovery "
                f"retry: {remaining_gap}."
            )
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
        if not self._should_retry(request, response):
            return response

        logger.info(
            "Retrying async model call after invisible response with no user-visible output",
            extra={"model": getattr(request.model, "model", None)},
        )
        retry_response = await handler(self._retry_request(request))
        remaining_gap = self._response_gap_reason(
            retry_response,
            allow_max_tokens=True,
        )
        if remaining_gap is not None:
            message = (
                "Model produced no visible assistant response after recovery "
                f"retry: {remaining_gap}."
            )
            logger.warning(
                message,
                extra={"model": getattr(request.model, "model", None)},
            )
            raise RuntimeError(message)
        return retry_response
