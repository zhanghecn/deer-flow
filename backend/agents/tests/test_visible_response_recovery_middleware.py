"""Tests for visible response recovery middleware."""

from __future__ import annotations

from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agents.middlewares.visible_response_recovery_middleware import (
    VisibleResponseRecoveryMiddleware,
)


def test_wrap_model_call_retries_when_model_returns_reasoning_only_without_visible_output():
    middleware = VisibleResponseRecoveryMiddleware()
    model = MagicMock()
    model.thinking = {"type": "enabled"}
    model.model = "gpt-test"

    request = ModelRequest(
        model=model,
        messages=[HumanMessage(content="帮我做一个关于 AI 的东西。")],
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
                        content=[{"type": "thinking", "thinking": "先想一想"}],
                        response_metadata={"stop_reason": "stop"},
                    )
                ]
            )
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "question",
                            "args": {
                                "questions": [
                                    {
                                        "header": "交付物",
                                        "question": "你想让我做哪种类型的 AI 内容？",
                                        "options": [
                                            {"label": "报告"},
                                            {"label": "PPT"},
                                            {"label": "视频脚本"},
                                            {"label": "代码项目"},
                                        ],
                                    }
                                ],
                            },
                            "id": "tc-1",
                        }
                    ],
                    response_metadata={"stop_reason": "tool_use"},
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert len(calls) == 2
    assert calls[1].model_settings["thinking"] == {"type": "disabled"}
    assert "visible_response_recovery" in calls[1].system_message.text
    assert response.result[0].tool_calls[0]["name"] == "question"


def test_wrap_model_call_skips_retry_when_visible_text_exists():
    middleware = VisibleResponseRecoveryMiddleware()
    model = MagicMock()
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
                    content="你好",
                    response_metadata={"stop_reason": "stop"},
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert calls == 1
    assert response.result[0].content == "你好"


def test_wrap_model_call_retries_when_provider_returns_no_ai_message():
    middleware = VisibleResponseRecoveryMiddleware()
    model = MagicMock()
    model.thinking = {"type": "enabled"}
    model.model = "glm-5.1"

    request = ModelRequest(
        model=model,
        messages=[HumanMessage(content="继续执行")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        calls.append(next_request)
        if len(calls) == 1:
            return ModelResponse(result=[])
        return ModelResponse(
            result=[
                AIMessage(
                    content="继续执行中。",
                    response_metadata={"stop_reason": "stop"},
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert len(calls) == 2
    assert "visible_response_recovery" in calls[1].system_message.text
    assert response.result[0].content == "继续执行中。"


def test_wrap_model_call_omits_question_instruction_when_question_tool_unavailable():
    middleware = VisibleResponseRecoveryMiddleware(question_tool_enabled=False)
    model = MagicMock()
    model.thinking = {"type": "enabled"}
    model.model = "mcp-only-model"

    request = ModelRequest(
        model=model,
        messages=[HumanMessage(content="继续执行")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        calls.append(next_request)
        if len(calls) == 1:
            return ModelResponse(result=[])
        return ModelResponse(
            result=[
                AIMessage(
                    content="我会基于当前可用信息继续回答。",
                    response_metadata={"stop_reason": "stop"},
                )
            ]
        )

    middleware.wrap_model_call(request, handler)

    assert len(calls) == 2
    assert "call `question`" not in calls[1].system_message.text
    assert "Do not call tools that are not available" in calls[1].system_message.text


def test_wrap_model_call_raises_when_recovery_retry_still_has_no_visible_response():
    middleware = VisibleResponseRecoveryMiddleware()
    model = MagicMock()
    model.thinking = {"type": "enabled"}
    model.model = "glm-5.1"

    request = ModelRequest(
        model=model,
        messages=[HumanMessage(content="继续执行")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    calls: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        calls.append(next_request)
        return ModelResponse(result=[])

    try:
        middleware.wrap_model_call(request, handler)
    except RuntimeError as exc:
        assert "no visible assistant response after recovery retry" in str(exc)
        assert "no assistant message" in str(exc)
    else:
        raise AssertionError("Expected recovery failure to raise RuntimeError")

    assert len(calls) == 2
