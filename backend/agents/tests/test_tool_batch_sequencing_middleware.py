"""Tests for sequential tool-batch retry protection."""

from __future__ import annotations

from unittest.mock import MagicMock

from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agents.middlewares.tool_batch_sequencing_middleware import (
    ToolBatchSequencingMiddleware,
)


def test_wrap_model_call_retries_when_write_file_and_execute_are_batched():
    middleware = ToolBatchSequencingMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="生成文件并交付")],
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
                        content="",
                        tool_calls=[
                            {"name": "write_file", "args": {"file_path": "/mnt/user-data/workspace/a.md"}, "id": "tc-1"},
                            {"name": "execute", "args": {"command": "cp a.md /mnt/user-data/outputs/"}, "id": "tc-2"},
                        ],
                    )
                ]
            )

        return ModelResponse(
            result=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {"name": "write_file", "args": {"file_path": "/mnt/user-data/workspace/a.md"}, "id": "tc-3"},
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert len(calls) == 2
    assert "tool_batch_sequencing_recovery" in calls[1].system_message.text
    assert response.result[0].tool_calls[0]["name"] == "write_file"


def test_wrap_model_call_skips_retry_for_single_file_write():
    middleware = ToolBatchSequencingMiddleware()
    request = ModelRequest(
        model=MagicMock(),
        messages=[HumanMessage(content="只写一个文件")],
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
                    content="",
                    tool_calls=[
                        {"name": "write_file", "args": {"file_path": "/mnt/user-data/workspace/a.md"}, "id": "tc-1"},
                    ],
                )
            ]
        )

    response = middleware.wrap_model_call(request, handler)

    assert calls == 1
    assert response.result[0].tool_calls[0]["name"] == "write_file"
