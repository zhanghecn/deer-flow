from __future__ import annotations

import json
from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from src.agents.middlewares.question_discipline_middleware import (
    QuestionDisciplineMiddleware,
)


def test_question_discipline_middleware_appends_policy_prompt():
    middleware = QuestionDisciplineMiddleware()
    model = MagicMock()
    model.model = "glm-5"

    request = ModelRequest(
        model=model,
        messages=[HumanMessage(content="帮我收集大量案例并整理理论。")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(context={}),
        state={"messages": []},
    )

    captured: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        captured.append(next_request)
        return ModelResponse(result=[AIMessage(content="ok")])

    middleware.wrap_model_call(request, handler)

    assert len(captured) == 1
    assert "question_discipline" in captured[0].system_message.text
    assert "Do not ask clarifying questions in normal assistant prose" in captured[0].system_message.text
    assert "There is no single-question cap" in captured[0].system_message.text
    assert "highest-leverage blocker questions first" in captured[0].system_message.text
    assert "offer 2-4 concrete answer choices" in captured[0].system_message.text
    assert "bundle the material blocker questions together up front" in captured[0].system_message.text


def test_question_discipline_middleware_adds_resume_prompt_after_answered_question():
    middleware = QuestionDisciplineMiddleware()
    model = MagicMock()
    model.model = "glm-5"

    question_result = json.dumps(
        {
            "kind": "question_result",
            "request_id": "call-1",
            "status": "answered",
            "answers": [["按理论分类输出"], ["近十年案例"]],
            "message": "User has answered your questions.",
        },
        ensure_ascii=False,
    )
    request = ModelRequest(
        model=model,
        messages=[
            HumanMessage(content="帮我收集大量案例并整理理论。"),
            ToolMessage(content=question_result, tool_call_id="call-1"),
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(context={}),
        state={
            "messages": [
                HumanMessage(content="帮我收集大量案例并整理理论。"),
                ToolMessage(content=question_result, tool_call_id="call-1"),
            ]
        },
    )

    captured: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        captured.append(next_request)
        return ModelResponse(result=[AIMessage(content="ok")])

    middleware.wrap_model_call(request, handler)

    assert len(captured) == 1
    assert "question_resume" in captured[0].system_message.text
    assert "Continue the task now using those answers" in captured[0].system_message.text
    assert "Do not call `question` again for secondary scoping details" in captured[0].system_message.text


def test_question_discipline_does_not_heuristically_block_tools_from_user_text():
    middleware = QuestionDisciplineMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[
            HumanMessage(
                content=(
                    "帮我收集所有盲派实战案例和理论，数量尽量上万，"
                    "最后按不同 markdown 分类整理输出。"
                )
            )
        ],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(context={}),
        state={"messages": []},
    )

    captured: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        captured.append(next_request)
        return ModelResponse(result=[AIMessage(content="ok")])

    response = middleware.wrap_model_call(request, handler)

    assert response.result[-1].content == "ok"
    assert len(captured) == 1
    assert "question_discipline" in captured[0].system_message.text
