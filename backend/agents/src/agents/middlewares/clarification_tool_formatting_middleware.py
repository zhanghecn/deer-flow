"""Normalize ask_clarification tool payloads for structured UI rendering."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any, override

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, BaseMessage

_OPTION_LINE_RE = re.compile(
    r"^\s*(?:[-*•]\s+|\d+[.)]\s+|[一二三四五六七八九十]+[、.)]\s*)(.+?)\s*$"
)
_CLARIFICATION_CUE_RE = re.compile(
    r"(请(?:您|你)?确认|请选择|请告诉我|你想|您希望|哪种类型|什么类型|以下哪种|哪个标准|which option|which approach|which type|please confirm|please choose|let me know)",
    re.IGNORECASE,
)
_CONFLICT_RE = re.compile(r"(冲突|矛盾|无法同时满足|conflict|contradict|incompatible)", re.IGNORECASE)


def _collapse_blank_lines(lines: list[str]) -> list[str]:
    collapsed: list[str] = []
    for line in lines:
        if line == "" and collapsed and collapsed[-1] == "":
            continue
        collapsed.append(line)
    while collapsed and collapsed[0] == "":
        collapsed.pop(0)
    while collapsed and collapsed[-1] == "":
        collapsed.pop()
    return collapsed


def _strip_wrapping_markdown(text: str) -> str:
    normalized = text.strip()
    while True:
        updated = normalized
        if updated.startswith("**") and updated.endswith("**") and len(updated) > 4:
            updated = updated[2:-2].strip()
        if updated.startswith("`") and updated.endswith("`") and len(updated) > 2:
            updated = updated[1:-1].strip()
        if updated == normalized:
            return updated
        normalized = updated


def _extract_options_from_question(question: str) -> tuple[str, list[str]]:
    if not question.strip():
        return "", []

    question_lines: list[str] = []
    options: list[str] = []
    option_block_started = False
    option_block_closed = False

    for raw_line in question.splitlines():
        stripped = raw_line.strip()
        match = _OPTION_LINE_RE.match(raw_line)
        if match and not option_block_closed:
            option_block_started = True
            options.append(match.group(1).strip())
            continue

        if not option_block_started:
            question_lines.append(stripped)
            continue

        if stripped:
            option_block_closed = True

    normalized_options = [_strip_wrapping_markdown(item) for item in options if item]
    if len(normalized_options) < 2:
        return question.strip(), []

    normalized_question = _strip_wrapping_markdown(
        "\n".join(_collapse_blank_lines(question_lines)).strip()
    )
    return normalized_question or question.strip(), normalized_options


def _extract_text_content(message: AIMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for block in content:
        if isinstance(block, str) and block.strip():
            parts.append(block.strip())
            continue
        if not isinstance(block, dict):
            continue
        if block.get("type") != "text":
            continue
        text = block.get("text")
        if isinstance(text, str) and text.strip():
            parts.append(text.strip())
    return "\n".join(parts).strip()


def _build_clarification_tool_call_from_text(message: AIMessage) -> dict[str, Any] | None:
    if message.tool_calls:
        return None

    text = _extract_text_content(message)
    if not text:
        return None

    lines = [line.strip() for line in text.splitlines()]
    for index, line in enumerate(lines):
        if not _CLARIFICATION_CUE_RE.search(line):
            continue

        question, options = _extract_options_from_question("\n".join(lines[index:]))
        if len(options) < 2:
            continue

        context = "\n".join(_collapse_blank_lines(lines[:index])).strip()
        clarification_type = (
            "ambiguous_requirement"
            if _CONFLICT_RE.search(f"{context}\n{question}")
            else "approach_choice"
        )
        return {
            "name": "ask_clarification",
            "args": {
                "question": question,
                "clarification_type": clarification_type,
                "context": context or None,
                "options": options,
            },
            "id": "ask_clarification_from_text",
        }

    return None


def _normalize_ask_clarification_tool_call(
    tool_call: dict[str, Any],
    *,
    fallback_context: str | None = None,
) -> dict[str, Any]:
    if tool_call.get("name") != "ask_clarification":
        return tool_call

    args = tool_call.get("args")
    if not isinstance(args, dict):
        return tool_call

    raw_options = args.get("options")
    if isinstance(raw_options, list):
        normalized_existing_options = [str(item).strip() for item in raw_options if str(item).strip()]
    else:
        normalized_existing_options = []

    updated_args = dict(args)
    changed = False

    raw_context = args.get("context")
    normalized_context = str(raw_context).strip() if isinstance(raw_context, str) else ""
    if not normalized_context and fallback_context:
        updated_args["context"] = fallback_context
        changed = True

    if normalized_existing_options:
        if normalized_existing_options != raw_options:
            updated_args["options"] = normalized_existing_options
            changed = True
        return {
            **tool_call,
            "args": updated_args,
        } if changed else tool_call

    question = str(args.get("question") or "").strip()
    normalized_question, normalized_options = _extract_options_from_question(question)
    if not normalized_options:
        return {
            **tool_call,
            "args": updated_args,
        } if changed else tool_call

    updated_args["question"] = normalized_question
    updated_args["options"] = normalized_options
    return {
        **tool_call,
        "args": updated_args,
    }


def _normalize_message(message: BaseMessage) -> BaseMessage:
    if not isinstance(message, AIMessage):
        return message

    synthesized_tool_call = _build_clarification_tool_call_from_text(message)
    if synthesized_tool_call is not None:
        return message.model_copy(
            update={
                "content": "",
                "tool_calls": [synthesized_tool_call],
            }
        )

    if not message.tool_calls:
        return message

    fallback_context = _extract_text_content(message) or None
    updated_tool_calls = [
        _normalize_ask_clarification_tool_call(
            tool_call,
            fallback_context=fallback_context,
        )
        if isinstance(tool_call, dict)
        else tool_call
        for tool_call in message.tool_calls
    ]
    if updated_tool_calls == list(message.tool_calls):
        return message

    return message.model_copy(update={"tool_calls": updated_tool_calls})


class ClarificationToolFormattingMiddleware(AgentMiddleware):
    """Ensure ask_clarification choices are exposed in the structured options field."""

    @staticmethod
    def _normalize_response(response: ModelResponse[Any]) -> ModelResponse[Any]:
        normalized_messages = [_normalize_message(message) for message in response.result]
        if normalized_messages == response.result:
            return response
        return ModelResponse(
            result=normalized_messages,
            structured_response=response.structured_response,
        )

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        response = handler(request)
        return self._normalize_response(response)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        response = await handler(request)
        return self._normalize_response(response)
