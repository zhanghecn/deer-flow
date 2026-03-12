"""Tests for max_tokens recovery middleware."""

from __future__ import annotations

from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agents.middlewares.max_tokens_recovery_middleware import (
    MaxTokensRecoveryMiddleware,
)


def test_wrap_model_call_retries_reasoning_only_max_tokens_response():
    middleware = MaxTokensRecoveryMiddleware(retry_max_tokens=8192)
    model = MagicMock()
    model.max_tokens = 4096
    model.thinking = {"type": "enabled"}
    model.model = "glm-5"

    request = ModelRequest(
        model=model,
        messages=[HumanMessage(content="Build the artifact")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        calls.append(next_request)
        if len(calls) == 1:
            return ModelResponse(
                result=[
                    AIMessage(
                        content=[{"type": "thinking", "thinking": "Long reasoning"}],
                        response_metadata={"stop_reason": "max_tokens"},
                    )
                ]
            )
        return ModelResponse(
            result=[
                AIMessage(
                    content="Created the file.",
                    tool_calls=[{"name": "write_file", "args": {"path": "/tmp/a"}, "id": "tc-1"}],
                    response_metadata={"stop_reason": "tool_use"},
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert len(calls) == 2
    assert calls[1].model_settings["max_tokens"] == 8192
    assert calls[1].model_settings["thinking"] == {"type": "disabled"}
    assert "max_tokens_recovery" in calls[1].system_message.text
    assert response.result[0].tool_calls[0]["name"] == "write_file"


def test_wrap_model_call_skips_retry_when_text_is_visible():
    middleware = MaxTokensRecoveryMiddleware()
    model = MagicMock()
    model.max_tokens = 4096
    model.thinking = {"type": "enabled"}

    request = ModelRequest(
        model=model,
        messages=[HumanMessage(content="Say hi")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls = 0

    def handler(next_request: ModelRequest):
        nonlocal calls
        calls += 1
        return ModelResponse(
            result=[
                AIMessage(
                    content="Partial answer",
                    response_metadata={"stop_reason": "max_tokens"},
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert calls == 1
    assert response.result[0].content == "Partial answer"
