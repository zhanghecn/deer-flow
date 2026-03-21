"""Tests for clarification tool formatting middleware."""

from __future__ import annotations

from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agents.middlewares.clarification_tool_formatting_middleware import (
    ClarificationToolFormattingMiddleware,
)


def test_wrap_model_call_extracts_structured_options_from_question_body():
    middleware = ClarificationToolFormattingMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="Q")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    def handler(_request: ModelRequest):
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ask_clarification",
                            "args": {
                                "question": "您希望如何调整这个矛盾的要求？\n\n1. 放宽总字数限制\n2. 降低单章字数要求\n3. 其他方案",
                                "clarification_type": "approach_choice",
                                "context": "存在冲突",
                                "options": [],
                            },
                            "id": "tc-1",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    tool_call = response.result[0].tool_calls[0]
    assert tool_call["args"]["question"] == "您希望如何调整这个矛盾的要求？"
    assert tool_call["args"]["options"] == [
        "放宽总字数限制",
        "降低单章字数要求",
        "其他方案",
    ]


def test_wrap_model_call_keeps_existing_structured_options():
    middleware = ClarificationToolFormattingMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="Q")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    def handler(_request: ModelRequest):
        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ask_clarification",
                            "args": {
                                "question": "请选择方向",
                                "clarification_type": "approach_choice",
                                "options": ["A", "B"],
                            },
                            "id": "tc-1",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    tool_call = response.result[0].tool_calls[0]
    assert tool_call["args"]["question"] == "请选择方向"
    assert tool_call["args"]["options"] == ["A", "B"]


def test_wrap_model_call_converts_textual_clarification_into_tool_call():
    middleware = ClarificationToolFormattingMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="Q")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    def handler(_request: ModelRequest):
        return ModelResponse(
            result=[
                AIMessage(
                    content="""我注意到您的要求存在矛盾：

- 全文不超过 100 字
- 4 个章节，每章不少于 80 字

请确认您希望采用哪种方案：

1. 放宽总字数限制
2. 降低单章字数要求
3. 其他方案

请告诉我您偏好的方案。"""
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    tool_call = response.result[0].tool_calls[0]
    assert response.result[0].content == ""
    assert tool_call["name"] == "ask_clarification"
    assert tool_call["args"]["clarification_type"] == "ambiguous_requirement"
    assert "要求存在矛盾" in tool_call["args"]["context"]
    assert tool_call["args"]["question"] == "请确认您希望采用哪种方案："
    assert tool_call["args"]["options"] == [
        "放宽总字数限制",
        "降低单章字数要求",
        "其他方案",
    ]


def test_wrap_model_call_prefers_primary_choice_block_over_follow_up_bullets():
    middleware = ClarificationToolFormattingMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="Q")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    def handler(_request: ModelRequest):
        return ModelResponse(
            result=[
                AIMessage(
                    content="""你好！我可以帮你创建与 AI 相关的项目，但这个范围非常广。

**你更倾向于以下哪种类型？**

1. **AI 聊天机器人/助手**
2. **AI 工具/应用**
3. **AI 教学内容**
4. **AI 集成方案**

**另外请告诉我：**
- 主要用途或目标是什么？
- 有偏好的技术栈吗？
- 希望是完整项目还是演示？"""
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    tool_call = response.result[0].tool_calls[0]
    assert tool_call["args"]["question"] == "你更倾向于以下哪种类型？"
    assert tool_call["args"]["options"] == [
        "AI 聊天机器人/助手",
        "AI 工具/应用",
        "AI 教学内容",
        "AI 集成方案",
    ]
    assert "这个范围非常广" in tool_call["args"]["context"]


def test_wrap_model_call_backfills_context_from_visible_text_before_tool_call():
    middleware = ClarificationToolFormattingMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="Q")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": []},
    )

    def handler(_request: ModelRequest):
        return ModelResponse(
            result=[
                AIMessage(
                    content=[
                        {"type": "text", "text": "这些要求存在冲突，无法同时满足。"},
                        {"type": "text", "text": "请确认你更倾向于哪个方向。"},
                    ],
                    tool_calls=[
                        {
                            "name": "ask_clarification",
                            "args": {
                                "question": "请问您希望如何调整字数要求？",
                                "clarification_type": "approach_choice",
                                "options": ["方案 A", "方案 B"],
                            },
                            "id": "tc-1",
                        }
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    tool_call = response.result[0].tool_calls[0]
    assert "存在冲突" in tool_call["args"]["context"]
