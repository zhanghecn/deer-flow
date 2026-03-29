from __future__ import annotations

import importlib
import json
import pytest

from langchain.tools import ToolRuntime

from src.questions.types import QuestionInput
from src.tools.builtins import question_tool

question_tool_module = importlib.import_module("src.tools.builtins.question_tool")


def _runtime() -> ToolRuntime:
    return ToolRuntime(
        state={"messages": []},
        context={"agent_name": "lead_agent"},
        config={"configurable": {"thread_id": "thread-1"}},
        stream_writer=lambda _value: None,
        tool_call_id="tool-call-1",
        store=None,
    )


def test_question_tool_interrupts_with_structured_payload(monkeypatch):
    captured_payload: dict[str, object] = {}

    def _fake_interrupt(payload: dict[str, object]):
        captured_payload.update(payload)
        return {
            "request_id": "tool-call-1",
            "answers": [["Markdown"]],
        }

    monkeypatch.setattr(question_tool_module, "interrupt", _fake_interrupt)

    result = question_tool.func(
        runtime=_runtime(),
        questions=[
            {
                "header": "Format",
                "question": "Which output should I prepare?",
                "options": [{"label": "Markdown"}],
            }
        ],
        tool_call_id="tool-call-1",
    )

    parsed = json.loads(result)
    assert captured_payload["kind"] == "question"
    assert captured_payload["request_id"] == "tool-call-1"
    assert captured_payload["origin_agent_name"] == "lead_agent"
    assert parsed["kind"] == "question_result"
    assert parsed["status"] == "answered"
    assert parsed["answers"] == [["Markdown"]]


def test_question_tool_handles_rejected_reply(monkeypatch):
    monkeypatch.setattr(
        question_tool_module,
        "interrupt",
        lambda _payload: {"request_id": "tool-call-1", "rejected": True},
    )

    result = question_tool.func(
        runtime=_runtime(),
        questions=[
            {
                "header": "Format",
                "question": "Which output should I prepare?",
                "options": [{"label": "Markdown"}],
            }
        ],
        tool_call_id="tool-call-1",
    )

    parsed = json.loads(result)
    assert parsed["status"] == "rejected"
    assert parsed["answers"] == [[]]


def test_question_input_rejects_catch_all_option_labels():
    with pytest.raises(ValueError, match="Do not use catch-all options"):
        QuestionInput.model_validate(
            {
                "question": "Which source set should I use?",
                "options": [{"label": "Other"}],
            }
        )


def test_question_input_requires_concise_option_labels():
    with pytest.raises(ValueError, match="must stay concise"):
        QuestionInput.model_validate(
            {
                "question": "Which output structure should I prepare?",
                "options": [
                    {
                        "label": "按盲派核心理论分类并把交叉知识体系全部合并进同一个按钮文案里",
                    }
                ],
            }
        )


def test_question_input_rejects_memo_style_question_bodies():
    with pytest.raises(ValueError, match="must stay short and focused|must not contain markdown sections"):
        QuestionInput.model_validate(
            {
                "header": "Scope",
                "question": (
                    "## 可行性评估\n\n"
                    "- 公开资料有限\n"
                    "- 近代案例不足\n"
                    "- 需要你先决定方案\n\n"
                    "你希望我采用哪个方案？"
                ),
                "options": [],
            }
        )


def test_question_input_requires_options_for_choice_prompts():
    with pytest.raises(ValueError, match="must include concrete `options`"):
        QuestionInput.model_validate(
            {
                "header": "Format",
                "question": "你希望我采用哪个输出方案？",
                "options": [],
            }
        )
