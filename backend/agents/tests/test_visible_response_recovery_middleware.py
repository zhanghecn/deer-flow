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
                            "name": "ask_clarification",
                            "args": {
                                "question": "你想让我做哪种类型的 AI 内容？",
                                "clarification_type": "ambiguous_requirement",
                                "options": ["报告", "PPT", "视频脚本", "代码项目"],
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
    assert response.result[0].tool_calls[0]["name"] == "ask_clarification"


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
