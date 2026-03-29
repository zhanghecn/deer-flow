from __future__ import annotations

import json
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.types import interrupt
from langgraph.typing import ContextT

from src.agents.thread_state import ThreadState
from src.questions.types import (
    QuestionInfo,
    QuestionInput,
    QuestionReply,
    QuestionRequest,
    QuestionToolResult,
)
from src.utils.runtime_context import runtime_context_value


def _normalize_question_payload(questions: list[QuestionInput | dict[str, object]]) -> list[QuestionInfo]:
    payload_questions: list[QuestionInfo] = []
    for raw_question in questions:
        question = QuestionInput.model_validate(raw_question)
        payload_questions.append(
            QuestionInfo(
                header=question.header,
                question=question.question,
                options=question.options,
                multiple=question.multiple,
                custom=True,
            )
        )
    return payload_questions


def _normalize_reply(
    raw_reply: object,
    *,
    request_id: str,
    question_count: int,
) -> QuestionReply:
    if isinstance(raw_reply, list):
        candidate = {
            "request_id": request_id,
            "answers": raw_reply,
        }
    elif isinstance(raw_reply, dict):
        candidate = dict(raw_reply)
    else:
        raise ValueError("Question replies must be a reply object or an answers array.")

    reply = QuestionReply.model_validate(candidate)
    if reply.request_id != request_id:
        raise ValueError(
            f"Question reply request_id {reply.request_id!r} does not match {request_id!r}.",
        )

    if reply.rejected:
        if len(reply.answers) == 0:
            reply.answers = [[] for _ in range(question_count)]
        return reply

    if len(reply.answers) != question_count:
        raise ValueError(
            f"Question reply answer count {len(reply.answers)} does not match expected count {question_count}.",
        )
    return reply


def _format_answer(answer: list[str]) -> str:
    if len(answer) == 0:
        return "Unanswered"
    return ", ".join(answer)


@tool("question", parse_docstring=True)
def question_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    questions: list[QuestionInput],
    tool_call_id: Annotated[str, InjectedToolCallId],
) -> str:
    """Ask the user one or more structured questions during execution.

    Use this tool when you need user choices or missing information before you can continue.

    Usage notes:
    - Ask the smallest set of focused questions needed to continue safely.
    - Use multiple questions when they are tightly related or need to be answered together.
    - If you need the user's answer, use this tool instead of asking in normal assistant prose.
    - For broad research, collection, or batch authoring tasks, ask before searching when source scope, quality bar, or deliverable structure is still unclear.
    - For broad tasks, bundle the material blocker questions together instead of asking one question, waiting, and then asking the next predictable question.
    - Start with the highest-leverage questions first; do not dump every secondary uncertainty into the first question request.
    - Put concrete choices in `options` instead of embedding them into the question text.
    - When you can enumerate sensible defaults, provide 2-4 concrete options instead of making the question pure free text.
    - Options must be real answer choices, not follow-up questions.
    - The UI automatically offers typed custom input; do not add catch-all options like "Other".
    - If one option is the pragmatic default, put it first and append `(Recommended)` to its label.
    - After the user answers, continue execution unless their answer creates a genuinely new blocker.
    - Answers are returned in question order as arrays of selected labels.

    Args:
        questions: Questions to ask the user.
    """

    payload_questions = _normalize_question_payload(questions)
    request = QuestionRequest(
        request_id=tool_call_id,
        questions=payload_questions,
        origin_agent_name=runtime_context_value(getattr(runtime, "context", None), "agent_name"),
    )
    raw_reply = interrupt(request.model_dump(mode="json"))
    reply = _normalize_reply(
        raw_reply,
        request_id=tool_call_id,
        question_count=len(payload_questions),
    )

    if reply.rejected:
        result = QuestionToolResult(
            request_id=tool_call_id,
            status="rejected",
            answers=reply.answers,
            message=(
                "The user dismissed this question request without answering. "
                "Decide whether you can proceed with defaults or whether you must explain the remaining blocker."
            ),
        )
        return result.model_dump_json()

    formatted_answers = ", ".join(
        f'"{question.question}"="{_format_answer(reply.answers[index] if index < len(reply.answers) else [])}"'
        for index, question in enumerate(payload_questions)
    )
    result = QuestionToolResult(
        request_id=tool_call_id,
        status="answered",
        answers=reply.answers,
        message=(
            f"User has answered your questions: {formatted_answers}. "
            "You can now continue with the user's answers in mind."
        ),
    )
    return json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
