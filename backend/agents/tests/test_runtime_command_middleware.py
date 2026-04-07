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


def test_build_runtime_command_prompt_renders_create_agent_target_runtime_root():
    prompt = build_runtime_command_prompt(
        {
            "command_name": "create-agent",
            "command_kind": "soft",
            "command_args": "请更新 landing-copy-agent-0318",
            "command_prompt": "先检查已有归档，再修复。",
            "authoring_actions": ["setup_agent"],
            "agent_status": "dev",
            "target_agent_name": "landing-copy-agent-0318",
        }
    )

    assert "canonical_target_agent_runtime_root" in prompt
    assert "/mnt/user-data/agents/dev/landing-copy-agent-0318" in prompt
    assert "/mnt/user-data/agentz" in prompt


def test_runtime_command_middleware_appends_command_prompt_to_messages():
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
    assert captured[0].system_message.text == "You are helpful."
    assert captured[0].messages[-1].text is not None
    assert "runtime_command" in captured[0].messages[-1].text
    assert "create-skill" in captured[0].messages[-1].text
