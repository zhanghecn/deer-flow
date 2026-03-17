from __future__ import annotations

from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agents.middlewares.runtime_command_middleware import (
    RuntimeCommandMiddleware,
    build_runtime_command_prompt,
)


def test_build_runtime_command_prompt_renders_backend_instruction():
    prompt = build_runtime_command_prompt(
        {
            "command_name": "create-skill",
            "command_kind": "soft",
            "command_args": "合同审查",
            "command_prompt": "先起草一个最小可测 skill。",
            "authoring_actions": [],
        }
    )

    assert "<runtime_command>" in prompt
    assert "command_name: create-skill" in prompt
    assert "<runtime_command_instruction>" in prompt
    assert "最小可测 skill" in prompt


def test_runtime_command_middleware_appends_command_prompt_to_system_message():
    middleware = RuntimeCommandMiddleware()
    model = MagicMock()
    model.model = "glm-5"

    request = ModelRequest(
        model=model,
        messages=[HumanMessage(content="/create-skill 合同审查")],
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(
            context={
                "command_name": "create-skill",
                "command_kind": "soft",
                "command_args": "合同审查",
                "command_prompt": "先起草一个最小可测 skill。",
                "authoring_actions": [],
            }
        ),
        state={"messages": []},
    )

    captured: list[ModelRequest] = []

    def handler(next_request: ModelRequest):
        captured.append(next_request)
        return ModelResponse(result=[AIMessage(content="ok")])

    middleware.wrap_model_call(request, handler)

    assert len(captured) == 1
    assert "runtime_command" in captured[0].system_message.text
    assert "create-skill" in captured[0].system_message.text
