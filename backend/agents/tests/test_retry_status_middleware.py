from __future__ import annotations

from types import SimpleNamespace

from langchain.agents.middleware.types import ModelRequest, ModelResponse, ToolCallRequest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.runtime import Runtime

from src.agents.middlewares.retry_utils import (
    DEFAULT_MODEL_RETRY_ATTEMPTS,
    DEFAULT_TOOL_RETRY_ATTEMPTS,
    RETRY_STATUS_EVENT_TYPE,
    begin_provider_retry_tracking,
    build_model_retry_middleware,
    build_tool_retry_middleware,
    finish_provider_retry_tracking,
    note_provider_retry_request,
    note_provider_retry_response,
)


def test_build_retry_middleware_defaults_to_five_retries():
    assert build_model_retry_middleware().max_retries == DEFAULT_MODEL_RETRY_ATTEMPTS
    assert DEFAULT_MODEL_RETRY_ATTEMPTS == 5
    assert build_tool_retry_middleware().max_retries == DEFAULT_TOOL_RETRY_ATTEMPTS
    assert DEFAULT_TOOL_RETRY_ATTEMPTS == 5


def test_model_retry_middleware_emits_retry_progress_events():
    events: list[dict[str, object]] = []
    middleware = build_model_retry_middleware(max_retries=2)
    middleware.initial_delay = 0.0
    middleware.max_delay = 0.0
    middleware.jitter = False
    attempts = 0

    request = ModelRequest(
        model=object(),
        messages=[],
        state={"messages": []},
        runtime=Runtime(context=None, store=None, stream_writer=events.append),
    )

    def handler(_request: ModelRequest[object]) -> ModelResponse[object]:
        nonlocal attempts
        if attempts == 0:
            attempts += 1
            raise ConnectionError("Connection error")
        return ModelResponse(result=[AIMessage(content="ok")])

    response = middleware.wrap_model_call(request, handler)

    assert response.result[0].content == "ok"
    assert events == [
        {
            "type": RETRY_STATUS_EVENT_TYPE,
            "scope": "model",
            "status": "retrying",
            "retry_count": 1,
            "max_retries": 2,
            "occurred_at": events[0]["occurred_at"],
            "error": "Connection error",
            "error_type": "ConnectionError",
            "delay_seconds": 0.0,
            "next_retry_at": events[0]["next_retry_at"],
        },
        {
            "type": RETRY_STATUS_EVENT_TYPE,
            "scope": "model",
            "status": "completed",
            "retry_count": 1,
            "max_retries": 2,
            "occurred_at": events[1]["occurred_at"],
        },
    ]


def test_tool_retry_middleware_emits_retry_progress_events():
    events: list[dict[str, object]] = []
    middleware = build_tool_retry_middleware(max_retries=2)
    middleware.initial_delay = 0.0
    middleware.max_delay = 0.0
    middleware.jitter = False
    attempts = 0
    tool = SimpleNamespace(name="search")

    request = ToolCallRequest(
        tool_call={"id": "tool-1", "name": "search", "args": {}},
        tool=tool,
        state={"messages": []},
        runtime=SimpleNamespace(stream_writer=events.append),
    )

    def handler(_request: ToolCallRequest) -> ToolMessage:
        nonlocal attempts
        if attempts == 0:
            attempts += 1
            raise TimeoutError("Request timed out")
        return ToolMessage(content="ok", tool_call_id="tool-1", name="search")

    response = middleware.wrap_tool_call(request, handler)

    assert response.content == "ok"
    assert events == [
        {
            "type": RETRY_STATUS_EVENT_TYPE,
            "scope": "tool",
            "status": "retrying",
            "retry_count": 1,
            "max_retries": 2,
            "occurred_at": events[0]["occurred_at"],
            "error": "Request timed out",
            "error_type": "TimeoutError",
            "tool_name": "search",
            "delay_seconds": 0.0,
            "next_retry_at": events[0]["next_retry_at"],
        },
        {
            "type": RETRY_STATUS_EVENT_TYPE,
            "scope": "tool",
            "status": "completed",
            "retry_count": 1,
            "max_retries": 2,
            "occurred_at": events[1]["occurred_at"],
            "tool_name": "search",
        },
    ]


def test_provider_retry_tracking_emits_custom_events_for_internal_http_retries():
    events: list[dict[str, object]] = []
    runtime = Runtime(context=None, store=None, stream_writer=events.append)

    token = begin_provider_retry_tracking(runtime, max_retries=2)
    note_provider_retry_request("POST", "http://example.com/v1/messages")
    note_provider_retry_response(502, "Bad Gateway")
    note_provider_retry_request("POST", "http://example.com/v1/messages")
    finish_provider_retry_tracking(token, succeeded=True)

    assert events == [
        {
            "type": RETRY_STATUS_EVENT_TYPE,
            "scope": "model",
            "status": "retrying",
            "retry_count": 1,
            "max_retries": 2,
            "occurred_at": events[0]["occurred_at"],
            "error": "HTTP 502 Bad Gateway",
            "error_type": "HTTPStatusError",
        },
        {
            "type": RETRY_STATUS_EVENT_TYPE,
            "scope": "model",
            "status": "completed",
            "retry_count": 1,
            "max_retries": 2,
            "occurred_at": events[1]["occurred_at"],
        },
    ]
