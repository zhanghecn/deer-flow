from __future__ import annotations

from types import SimpleNamespace

from langchain.agents.middleware.types import ModelRequest, ModelResponse, ToolCallRequest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.runtime import Runtime

from src.agents.middlewares.retry_utils import (
    DEFAULT_MODEL_RETRY_ATTEMPTS,
    DEFAULT_TOOL_RETRY_ATTEMPTS,
    EXECUTION_EVENT_TYPE,
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
    stream_writer = events.append
    middleware = build_model_retry_middleware(max_retries=2)
    middleware.initial_delay = 0.0
    middleware.max_delay = 0.0
    middleware.jitter = False
    attempts = 0

    request = ModelRequest(
        model=object(),
        messages=[],
        state={"messages": []},
        runtime=Runtime(context=None, store=None, stream_writer=stream_writer),
    )

    def handler(_request: ModelRequest[object]) -> ModelResponse[object]:
        nonlocal attempts
        if attempts == 0:
            attempts += 1
            raise ConnectionError("Connection error")
        return ModelResponse(result=[AIMessage(content="ok")])

    response = middleware.wrap_model_call(request, handler)

    assert response.result[0].content == "ok"
    assert [event["event"] for event in events] == [
        "run_started",
        "phase_started",
        "retrying",
        "retry_completed",
        "phase_finished",
    ]
    assert events[1]["phase"] == "thinking_initial"
    assert events[2]["type"] == EXECUTION_EVENT_TYPE
    assert events[2]["phase"] == "retry_wait"
    assert events[2]["phase_kind"] == "retry"
    assert events[2]["retry_count"] == 1
    assert events[2]["max_retries"] == 2
    assert events[2]["delay_seconds"] == 0.0
    assert events[2]["error"] == "Connection error"
    assert events[2]["error_type"] == "ConnectionError"
    assert events[3]["event"] == "retry_completed"
    assert events[4]["event"] == "phase_finished"
    assert events[4]["phase"] == "thinking_initial"
    assert events[4]["duration_ms"] >= 0


def test_tool_retry_middleware_emits_retry_progress_events():
    events: list[dict[str, object]] = []
    stream_writer = events.append
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
        runtime=SimpleNamespace(stream_writer=stream_writer),
    )

    def handler(_request: ToolCallRequest) -> ToolMessage:
        nonlocal attempts
        if attempts == 0:
            attempts += 1
            raise TimeoutError("Request timed out")
        return ToolMessage(content="ok", tool_call_id="tool-1", name="search")

    response = middleware.wrap_tool_call(request, handler)

    assert response.content == "ok"
    assert [event["event"] for event in events] == [
        "run_started",
        "phase_started",
        "retrying",
        "retry_completed",
        "phase_finished",
    ]
    assert events[1]["phase"] == "tool_running"
    assert events[1]["tool_name"] == "search"
    assert events[2]["event"] == "retrying"
    assert events[2]["tool_name"] == "search"
    assert events[3]["event"] == "retry_completed"
    assert events[4]["event"] == "phase_finished"
    assert events[4]["tool_name"] == "search"
    assert events[4]["duration_ms"] >= 0


def test_provider_retry_tracking_emits_custom_events_for_internal_http_retries():
    events: list[dict[str, object]] = []
    runtime = Runtime(context=None, store=None, stream_writer=events.append)

    token = begin_provider_retry_tracking(runtime, max_retries=2)
    note_provider_retry_request("POST", "http://example.com/v1/messages")
    note_provider_retry_response(502, "Bad Gateway")
    note_provider_retry_request("POST", "http://example.com/v1/messages")
    finish_provider_retry_tracking(token, succeeded=True)

    assert [event["event"] for event in events] == [
        "retrying",
        "retry_completed",
    ]
    assert events[0]["phase"] == "retry_wait"
    assert events[0]["error"] == "HTTP 502 Bad Gateway"
    assert events[1]["phase"] == "retry_wait"


def test_execution_events_classify_model_tool_model_sequence():
    events: list[dict[str, object]] = []
    stream_writer = events.append
    runtime = Runtime(context=None, store=None, stream_writer=stream_writer)
    model_request = ModelRequest(
        model=object(),
        messages=[],
        state={"messages": []},
        runtime=runtime,
    )
    tool_request = ToolCallRequest(
        tool_call={"id": "tool-1", "name": "write_file", "args": {"path": "/tmp/x.txt"}},
        tool=SimpleNamespace(name="write_file"),
        state={"messages": []},
        runtime=SimpleNamespace(stream_writer=stream_writer),
    )
    model_middleware = build_model_retry_middleware(max_retries=0)
    tool_middleware = build_tool_retry_middleware(max_retries=0)

    model_middleware.wrap_model_call(
        model_request,
        lambda _request: ModelResponse(result=[AIMessage(content="first")]),
    )
    tool_middleware.wrap_tool_call(
        tool_request,
        lambda _request: ToolMessage(
            content="ok",
            tool_call_id="tool-1",
            name="write_file",
        ),
    )
    model_middleware.wrap_model_call(
        model_request,
        lambda _request: ModelResponse(result=[AIMessage(content="second")]),
    )

    phase_starts = [
        event for event in events if event.get("event") == "phase_started"
    ]
    assert [event["phase"] for event in phase_starts] == [
        "thinking_initial",
        "tool_running",
        "thinking_finalize",
    ]


def test_model_retry_middleware_retries_structured_multilingual_provider_errors():
    events: list[dict[str, object]] = []
    stream_writer = events.append
    middleware = build_model_retry_middleware(max_retries=2)
    middleware.initial_delay = 0.0
    middleware.max_delay = 0.0
    middleware.jitter = False
    attempts = 0

    request = ModelRequest(
        model=object(),
        messages=[],
        state={"messages": []},
        runtime=Runtime(context=None, store=None, stream_writer=stream_writer),
    )

    def handler(_request: ModelRequest[object]) -> ModelResponse[object]:
        nonlocal attempts
        if attempts == 0:
            attempts += 1
            raise RuntimeError(
                "{'type': 'error', 'error': {'message': '网络错误，错误id：202604162004385dab114c4ec9494e，请稍后重试', 'code': '1234'}, 'request_id': '202604162004385dab114c4ec9494e'}"
            )
        return ModelResponse(result=[AIMessage(content="ok")])

    response = middleware.wrap_model_call(request, handler)

    assert response.result[0].content == "ok"
    assert [event["event"] for event in events] == [
        "run_started",
        "phase_started",
        "retrying",
        "retry_completed",
        "phase_finished",
    ]
