from __future__ import annotations

import asyncio
import errno
import logging
from typing import Any

from langchain.agents.middleware import ModelRetryMiddleware, ToolRetryMiddleware

logger = logging.getLogger(__name__)

DEFAULT_MODEL_RETRY_ATTEMPTS = 3
DEFAULT_TOOL_RETRY_ATTEMPTS = 2
DEFAULT_PROVIDER_MAX_RETRIES = 6
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
    "too many requests",
)


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


def build_model_retry_middleware(
    *,
    max_retries: int = DEFAULT_MODEL_RETRY_ATTEMPTS,
) -> ModelRetryMiddleware:
    return ModelRetryMiddleware(
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
    return ToolRetryMiddleware(
        max_retries=max_retries,
        retry_on=should_retry,
        on_failure="error",
        initial_delay=DEFAULT_RETRY_INITIAL_DELAY,
        max_delay=DEFAULT_RETRY_MAX_DELAY,
    )
