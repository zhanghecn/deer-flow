from __future__ import annotations

import asyncio
from contextvars import ContextVar, Token
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import errno
import logging
import time
from typing import Any

from langchain.agents.middleware import ModelRetryMiddleware, ToolRetryMiddleware
from langchain.agents.middleware._retry import (
    calculate_delay,
    should_retry_exception,
)
from langchain.agents.middleware.types import (
    ContextT,
    ModelRequest,
    ModelResponse,
    ResponseT,
    ToolCallRequest,
)
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.runtime import Runtime

logger = logging.getLogger(__name__)

RETRY_STATUS_EVENT_TYPE = "retry_status"
DEFAULT_MODEL_RETRY_ATTEMPTS = 5
DEFAULT_TOOL_RETRY_ATTEMPTS = 5
DEFAULT_PROVIDER_MAX_RETRIES = 0
DEFAULT_RETRY_INITIAL_DELAY = 0.5
DEFAULT_RETRY_MAX_DELAY = 4.0
RETRYABLE_STATUS_CODES = {408, 429}
RETRYABLE_ERRNOS = {
    errno.ECONNABORTED,
    errno.ECONNREFUSED,
    errno.ECONNRESET,
    errno.EHOSTUNREACH,
    errno.ENETDOWN,
    errno.ENETRESET,
    errno.ENETUNREACH,
    errno.ETIMEDOUT,
}
RETRYABLE_MESSAGE_FRAGMENTS = (
    "connection aborted",
    "connection closed",
    "connection error",
    "connection refused",
    "connection reset",
    "gateway timeout",
    "internal server error",
    "network is unreachable",
    "rate limit",
    "server disconnected",
    "service unavailable",
    "temporarily unavailable",
    "timed out",
    "timeout",
    "no generations found in stream",
    "too many requests",
)


@dataclass
class ProviderRetryContext:
    stream_writer: Any
    max_retries: int
    request_attempts: int = 0
    emitted_retry_count: int = 0
    last_error: str | None = None
    last_error_type: str | None = None


_provider_retry_context: ContextVar[ProviderRetryContext | None] = ContextVar(
    "provider_retry_context",
    default=None,
)


def _format_retry_error(exc: BaseException) -> str:
    message = str(exc).strip()
    return message or type(exc).__name__


def _resolve_stream_writer(runtime: Runtime[Any] | None) -> Any:
    if runtime is None:
        return None
    return getattr(runtime, "stream_writer", None)


def _emit_retry_status(
    stream_writer: Any,
    *,
    scope: str,
    status: str,
    retry_count: int,
    max_retries: int,
    exc: BaseException | None,
    error_message: str | None = None,
    error_type: str | None = None,
    delay_seconds: float | None = None,
    tool_name: str | None = None,
) -> None:
    if not callable(stream_writer):
        return

    occurred_at = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "type": RETRY_STATUS_EVENT_TYPE,
        "scope": scope,
        "status": status,
        "retry_count": retry_count,
        "max_retries": max_retries,
        "occurred_at": occurred_at.isoformat(),
    }
    if exc is not None:
        payload["error"] = _format_retry_error(exc)
        payload["error_type"] = type(exc).__name__
    elif error_message is not None:
        payload["error"] = error_message
        if error_type is not None:
            payload["error_type"] = error_type
    if tool_name:
        payload["tool_name"] = tool_name
    if delay_seconds is not None:
        payload["delay_seconds"] = delay_seconds
        payload["next_retry_at"] = (occurred_at + timedelta(seconds=max(delay_seconds, 0.0))).isoformat()

    log_error = payload.get("error")
    if status == "retrying":
        logger.warning(
            "Retrying %s request %s/%s%s%s",
            scope,
            retry_count,
            max_retries,
            f" for tool '{tool_name}'" if tool_name else "",
            f": {log_error}" if log_error else "",
        )
    elif status == "failed":
        logger.warning(
            "%s retry sequence failed after %s/%s%s%s",
            scope.capitalize(),
            retry_count,
            max_retries,
            f" for tool '{tool_name}'" if tool_name else "",
            f": {log_error}" if log_error else "",
        )
    elif status == "completed":
        logger.info(
            "%s retry sequence completed after %s/%s%s",
            scope.capitalize(),
            retry_count,
            max_retries,
            f" for tool '{tool_name}'" if tool_name else "",
        )

    try:
        stream_writer(payload)
    except Exception:
        logger.debug("Failed to emit retry status event", exc_info=True)


def begin_provider_retry_tracking(
    runtime: Runtime[Any] | None,
    *,
    max_retries: int,
) -> Token[ProviderRetryContext | None] | None:
    stream_writer = _resolve_stream_writer(runtime)
    if not callable(stream_writer):
        return None

    return _provider_retry_context.set(
        ProviderRetryContext(
            stream_writer=stream_writer,
            max_retries=max_retries,
        )
    )


def finish_provider_retry_tracking(
    token: Token[ProviderRetryContext | None] | None,
    *,
    succeeded: bool,
    exc: BaseException | None = None,
) -> None:
    if token is None:
        return

    context = _provider_retry_context.get()
    try:
        if context is not None and context.emitted_retry_count > 0:
            _emit_retry_status(
                context.stream_writer,
                scope="model",
                status="completed" if succeeded else "failed",
                retry_count=context.emitted_retry_count,
                max_retries=context.max_retries,
                exc=exc if not succeeded else None,
                error_message=None if succeeded else context.last_error,
                error_type=None if succeeded else context.last_error_type,
            )
    finally:
        _provider_retry_context.reset(token)


def _provider_retry_context_for_request() -> ProviderRetryContext | None:
    return _provider_retry_context.get()


def note_provider_retry_request(method: str, url: str) -> None:
    context = _provider_retry_context_for_request()
    if context is None:
        return

    context.request_attempts += 1
    if context.request_attempts <= 1:
        return

    retry_count = context.request_attempts - 1
    context.emitted_retry_count = max(context.emitted_retry_count, retry_count)
    context.last_error = context.last_error or f"{method} {url} retried"
    _emit_retry_status(
        context.stream_writer,
        scope="model",
        status="retrying",
        retry_count=retry_count,
        max_retries=context.max_retries,
        exc=None,
        error_message=context.last_error,
        error_type=context.last_error_type,
    )


def note_provider_retry_response(status_code: int, reason_phrase: str | None = None) -> None:
    context = _provider_retry_context_for_request()
    if context is None:
        return

    if status_code in RETRYABLE_STATUS_CODES or 500 <= status_code < 600:
        detail = f"HTTP {status_code}"
        normalized_reason = (reason_phrase or "").strip()
        if normalized_reason:
            detail = f"{detail} {normalized_reason}"
        context.last_error = detail
        context.last_error_type = "HTTPStatusError"


def note_provider_retry_exception(exc: BaseException) -> None:
    context = _provider_retry_context_for_request()
    if context is None:
        return

    context.last_error = _format_retry_error(exc)
    context.last_error_type = type(exc).__name__


def _normalize_status_code(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _extract_status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "status", "http_status", "statusCode"):
        status_code = _normalize_status_code(getattr(exc, attr, None))
        if status_code is not None:
            return status_code

    response = getattr(exc, "response", None)
    if response is not None:
        for attr in ("status_code", "status"):
            status_code = _normalize_status_code(getattr(response, attr, None))
            if status_code is not None:
                return status_code

    return None


def _message_looks_retryable(exc: BaseException) -> bool:
    message = str(exc).strip().lower()
    if not message:
        return False

    return any(fragment in message for fragment in RETRYABLE_MESSAGE_FRAGMENTS)


def should_retry(exc: BaseException) -> bool:
    status_code = _extract_status_code(exc)
    if status_code is not None:
        return status_code in RETRYABLE_STATUS_CODES or 500 <= status_code < 600

    if isinstance(exc, (TimeoutError, asyncio.TimeoutError, ConnectionError)):
        return True

    if isinstance(exc, OSError) and exc.errno in RETRYABLE_ERRNOS:
        return True

    if _message_looks_retryable(exc):
        return True

    cause = getattr(exc, "__cause__", None)
    if isinstance(cause, BaseException) and cause is not exc:
        return should_retry(cause)

    context = getattr(exc, "__context__", None)
    if isinstance(context, BaseException) and context is not exc:
        return should_retry(context)

    return False


class StreamingModelRetryMiddleware(ModelRetryMiddleware):
    def _emit_status(
        self,
        request: ModelRequest[ContextT],
        *,
        status: str,
        retry_count: int,
        exc: BaseException | None,
        delay_seconds: float | None = None,
    ) -> None:
        _emit_retry_status(
            _resolve_stream_writer(request.runtime),
            scope="model",
            status=status,
            retry_count=retry_count,
            max_retries=self.max_retries,
            exc=exc,
            delay_seconds=delay_seconds,
        )

    def wrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler,
    ) -> ModelResponse[ResponseT] | AIMessage:
        last_retry_count: int | None = None

        for attempt in range(self.max_retries + 1):
            provider_retry_token = begin_provider_retry_tracking(
                request.runtime,
                max_retries=getattr(request.model, "max_retries", 0),
            )
            try:
                response = handler(request)
                finish_provider_retry_tracking(
                    provider_retry_token,
                    succeeded=True,
                )
                if last_retry_count is not None:
                    self._emit_status(
                        request,
                        status="completed",
                        retry_count=last_retry_count,
                        exc=None,
                    )
                return response
            except Exception as exc:
                finish_provider_retry_tracking(
                    provider_retry_token,
                    succeeded=False,
                    exc=exc,
                )
                attempts_made = attempt + 1

                if not should_retry_exception(exc, self.retry_on):
                    if last_retry_count is not None:
                        self._emit_status(
                            request,
                            status="failed",
                            retry_count=last_retry_count,
                            exc=exc,
                        )
                    return self._handle_failure(exc, attempts_made)

                if attempt < self.max_retries:
                    retry_count = attempt + 1
                    delay = calculate_delay(
                        attempt,
                        backoff_factor=self.backoff_factor,
                        initial_delay=self.initial_delay,
                        max_delay=self.max_delay,
                        jitter=self.jitter,
                    )
                    last_retry_count = retry_count
                    self._emit_status(
                        request,
                        status="retrying",
                        retry_count=retry_count,
                        exc=exc,
                        delay_seconds=delay,
                    )
                    if delay > 0:
                        time.sleep(delay)
                else:
                    if self.max_retries > 0:
                        self._emit_status(
                            request,
                            status="failed",
                            retry_count=self.max_retries,
                            exc=exc,
                        )
                    return self._handle_failure(exc, attempts_made)

        msg = "Unexpected: retry loop completed without returning"
        raise RuntimeError(msg)

    async def awrap_model_call(
        self,
        request: ModelRequest[ContextT],
        handler,
    ) -> ModelResponse[ResponseT] | AIMessage:
        last_retry_count: int | None = None

        for attempt in range(self.max_retries + 1):
            provider_retry_token = begin_provider_retry_tracking(
                request.runtime,
                max_retries=getattr(request.model, "max_retries", 0),
            )
            try:
                response = await handler(request)
                finish_provider_retry_tracking(
                    provider_retry_token,
                    succeeded=True,
                )
                if last_retry_count is not None:
                    self._emit_status(
                        request,
                        status="completed",
                        retry_count=last_retry_count,
                        exc=None,
                    )
                return response
            except Exception as exc:
                finish_provider_retry_tracking(
                    provider_retry_token,
                    succeeded=False,
                    exc=exc,
                )
                attempts_made = attempt + 1

                if not should_retry_exception(exc, self.retry_on):
                    if last_retry_count is not None:
                        self._emit_status(
                            request,
                            status="failed",
                            retry_count=last_retry_count,
                            exc=exc,
                        )
                    return self._handle_failure(exc, attempts_made)

                if attempt < self.max_retries:
                    retry_count = attempt + 1
                    delay = calculate_delay(
                        attempt,
                        backoff_factor=self.backoff_factor,
                        initial_delay=self.initial_delay,
                        max_delay=self.max_delay,
                        jitter=self.jitter,
                    )
                    last_retry_count = retry_count
                    self._emit_status(
                        request,
                        status="retrying",
                        retry_count=retry_count,
                        exc=exc,
                        delay_seconds=delay,
                    )
                    if delay > 0:
                        await asyncio.sleep(delay)
                else:
                    if self.max_retries > 0:
                        self._emit_status(
                            request,
                            status="failed",
                            retry_count=self.max_retries,
                            exc=exc,
                        )
                    return self._handle_failure(exc, attempts_made)

        msg = "Unexpected: retry loop completed without returning"
        raise RuntimeError(msg)


class StreamingToolRetryMiddleware(ToolRetryMiddleware):
    def _emit_status(
        self,
        request: ToolCallRequest,
        *,
        tool_name: str,
        status: str,
        retry_count: int,
        exc: BaseException | None,
        delay_seconds: float | None = None,
    ) -> None:
        _emit_retry_status(
            _resolve_stream_writer(request.runtime),
            scope="tool",
            status=status,
            retry_count=retry_count,
            max_retries=self.max_retries,
            exc=exc,
            delay_seconds=delay_seconds,
            tool_name=tool_name,
        )

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler,
    ) -> ToolMessage | Any:
        tool_name = request.tool.name if request.tool else request.tool_call["name"]
        if not self._should_retry_tool(tool_name):
            return handler(request)

        tool_call_id = request.tool_call["id"]
        last_retry_count: int | None = None

        for attempt in range(self.max_retries + 1):
            try:
                response = handler(request)
                if last_retry_count is not None:
                    self._emit_status(
                        request,
                        tool_name=tool_name,
                        status="completed",
                        retry_count=last_retry_count,
                        exc=None,
                    )
                return response
            except Exception as exc:
                attempts_made = attempt + 1

                if not should_retry_exception(exc, self.retry_on):
                    if last_retry_count is not None:
                        self._emit_status(
                            request,
                            tool_name=tool_name,
                            status="failed",
                            retry_count=last_retry_count,
                            exc=exc,
                        )
                    return self._handle_failure(
                        tool_name,
                        tool_call_id,
                        exc,
                        attempts_made,
                    )

                if attempt < self.max_retries:
                    retry_count = attempt + 1
                    delay = calculate_delay(
                        attempt,
                        backoff_factor=self.backoff_factor,
                        initial_delay=self.initial_delay,
                        max_delay=self.max_delay,
                        jitter=self.jitter,
                    )
                    last_retry_count = retry_count
                    self._emit_status(
                        request,
                        tool_name=tool_name,
                        status="retrying",
                        retry_count=retry_count,
                        exc=exc,
                        delay_seconds=delay,
                    )
                    if delay > 0:
                        time.sleep(delay)
                else:
                    if self.max_retries > 0:
                        self._emit_status(
                            request,
                            tool_name=tool_name,
                            status="failed",
                            retry_count=self.max_retries,
                            exc=exc,
                        )
                    return self._handle_failure(
                        tool_name,
                        tool_call_id,
                        exc,
                        attempts_made,
                    )

        msg = "Unexpected: retry loop completed without returning"
        raise RuntimeError(msg)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler,
    ) -> ToolMessage | Any:
        tool_name = request.tool.name if request.tool else request.tool_call["name"]
        if not self._should_retry_tool(tool_name):
            return await handler(request)

        tool_call_id = request.tool_call["id"]
        last_retry_count: int | None = None

        for attempt in range(self.max_retries + 1):
            try:
                response = await handler(request)
                if last_retry_count is not None:
                    self._emit_status(
                        request,
                        tool_name=tool_name,
                        status="completed",
                        retry_count=last_retry_count,
                        exc=None,
                    )
                return response
            except Exception as exc:
                attempts_made = attempt + 1

                if not should_retry_exception(exc, self.retry_on):
                    if last_retry_count is not None:
                        self._emit_status(
                            request,
                            tool_name=tool_name,
                            status="failed",
                            retry_count=last_retry_count,
                            exc=exc,
                        )
                    return self._handle_failure(
                        tool_name,
                        tool_call_id,
                        exc,
                        attempts_made,
                    )

                if attempt < self.max_retries:
                    retry_count = attempt + 1
                    delay = calculate_delay(
                        attempt,
                        backoff_factor=self.backoff_factor,
                        initial_delay=self.initial_delay,
                        max_delay=self.max_delay,
                        jitter=self.jitter,
                    )
                    last_retry_count = retry_count
                    self._emit_status(
                        request,
                        tool_name=tool_name,
                        status="retrying",
                        retry_count=retry_count,
                        exc=exc,
                        delay_seconds=delay,
                    )
                    if delay > 0:
                        await asyncio.sleep(delay)
                else:
                    if self.max_retries > 0:
                        self._emit_status(
                            request,
                            tool_name=tool_name,
                            status="failed",
                            retry_count=self.max_retries,
                            exc=exc,
                        )
                    return self._handle_failure(
                        tool_name,
                        tool_call_id,
                        exc,
                        attempts_made,
                    )

        msg = "Unexpected: retry loop completed without returning"
        raise RuntimeError(msg)


def build_model_retry_middleware(
    *,
    max_retries: int = DEFAULT_MODEL_RETRY_ATTEMPTS,
) -> ModelRetryMiddleware:
    return StreamingModelRetryMiddleware(
        max_retries=max_retries,
        retry_on=should_retry,
        on_failure="error",
        initial_delay=DEFAULT_RETRY_INITIAL_DELAY,
        max_delay=DEFAULT_RETRY_MAX_DELAY,
    )


def build_tool_retry_middleware(
    *,
    max_retries: int = DEFAULT_TOOL_RETRY_ATTEMPTS,
) -> ToolRetryMiddleware:
    return StreamingToolRetryMiddleware(
        max_retries=max_retries,
        retry_on=should_retry,
        on_failure="error",
        initial_delay=DEFAULT_RETRY_INITIAL_DELAY,
        max_delay=DEFAULT_RETRY_MAX_DELAY,
    )
