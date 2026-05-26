from __future__ import annotations

from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agents.middlewares.provider_message_sanitization_middleware import (
    ProviderMessageSanitizationMiddleware,
    sanitize_message,
)


def _request(messages):
    return ModelRequest(
        model=MagicMock(),
        messages=messages,
        system_message=SystemMessage(content="You are helpful."),
        tools=[],
        runtime=MagicMock(),
        state={"messages": list(messages)},
    )


def test_sanitize_message_removes_malformed_thinking_block() -> None:
    message = AIMessage(
        content=[
            {"type": "thinking", "signature": "sig-1", "index": 0},
            {
                "type": "tool_use",
                "id": "call-1",
                "name": "execute",
                "input": {},
            },
        ],
        tool_calls=[
            {
                "name": "execute",
                "args": {"command": "echo ok"},
                "id": "call-1",
            }
        ],
    )

    sanitized = sanitize_message(message)

    assert sanitized is not message
    assert sanitized.content == [
        {
            "type": "tool_use",
            "id": "call-1",
            "name": "execute",
            "input": {},
        }
    ]
    assert sanitized.tool_calls == message.tool_calls


def test_sanitize_message_keeps_valid_thinking_block() -> None:
    message = AIMessage(
        content=[
            {
                "type": "thinking",
                "thinking": "Valid provider reasoning transcript.",
                "signature": "sig-1",
                "index": 0,
            }
        ]
    )

    assert sanitize_message(message) is message


def test_wrap_model_call_sanitizes_request_history_before_provider_call() -> None:
    middleware = ProviderMessageSanitizationMiddleware()
    bad_ai_message = AIMessage(
        content=[
            {"type": "thinking", "signature": "sig-1", "index": 0},
            {"type": "text", "text": "visible"},
        ]
    )
    captured: list[ModelRequest] = []

    def handler(request: ModelRequest):
        captured.append(request)
        return ModelResponse(result=[AIMessage(content="ok")])

    middleware.wrap_model_call(_request([HumanMessage(content="hi"), bad_ai_message]), handler)

    assert captured[0].messages[1].content == [{"type": "text", "text": "visible"}]


def test_wrap_model_call_sanitizes_provider_response_before_state_persist() -> None:
    middleware = ProviderMessageSanitizationMiddleware()

    def handler(_request: ModelRequest):
        return ModelResponse(
            result=[
                AIMessage(
                    content=[
                        {"type": "thinking", "signature": "sig-1", "index": 0},
                        {"type": "text", "text": "done"},
                    ]
                )
            ]
        )

    response = middleware.wrap_model_call(_request([HumanMessage(content="hi")]), handler)

    assert response.result[0].content == [{"type": "text", "text": "done"}]
