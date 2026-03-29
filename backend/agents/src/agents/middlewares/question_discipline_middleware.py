"""Keep user-input collection on the structured `question` tool path."""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain.tools.tool_node import ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

_QUESTION_DISCIPLINE_PROMPT = """
<question_discipline>
- If you are waiting on user input, use the `question` tool. Do not ask clarifying questions in normal assistant prose.
- Ask `question` before any `web_search`, `web_fetch`, filesystem, authoring, or subagent work when the task still depends on unresolved user choices.
- Large research, crawling, collection, evaluation, or batch-authoring requests are blocked until source boundaries, inclusion/exclusion rules, quality bar, and output structure are clear enough to execute safely.
- Treat missing scope or acceptance criteria as blockers, not as details you can guess by starting research first.
- If several blockers must be answered together, collect them in one `question` tool call as multiple `questions[]` entries. There is no single-question cap.
- Start with the highest-leverage blocker questions first. Do not dump every secondary uncertainty into the first question call when the first few answers will narrow the rest.
- When a reasonable shortlist exists, offer 2-4 concrete answer choices in `questions[].options` and keep typed custom input as the fallback. Do not default to pure free-text questions for common scoping decisions.
- Put concrete answer choices in `questions[].options`; never put follow-up questions there.
- For broad tasks, bundle the material blocker questions together up front instead of serializing intake one question at a time.
- After the user answers a blocking `question`, continue execution with those answers unless a genuinely new hard blocker appears.
</question_discipline>
""".strip()

_QUESTION_RESUME_PROMPT = """
<question_resume>
- The user has already answered your blocking `question` request in this same turn.
- Continue the task now using those answers.
- Do not call `question` again for secondary scoping details that could have been included in the previous question set.
- Only ask a follow-up `question` if the user's answer introduced a genuinely new blocker, contradiction, or safety issue that could not reasonably have been bundled earlier.
- If the remaining uncertainty is non-critical, choose a reasonable default and proceed.
- Keep internal execution strategy internal. Do not expose plan/build stage terminology to the user unless they explicitly ask about it.
</question_resume>
""".strip()

_QUESTION_FIRST_REQUIRED_TOOL_ERROR = (
    "Error: this request still needs an upfront `question` call before using other tools. "
    "Ask the user the highest-leverage 2-4 blocking questions now, keep each `questions[].question` short, "
    "and put concrete choices into `questions[].options`."
)
_LARGE_SCALE_RESEARCH_KEYWORDS = (
    "collect",
    "collection",
    "compile",
    "crawl",
    "evaluate",
    "gather",
    "inventory",
    "map",
    "organize",
    "research",
    "scrape",
    "survey",
    "整理",
    "收集",
    "汇总",
    "爬",
    "爬取",
    "抓取",
    "调研",
    "研究",
    "评估",
    "分类",
)
_LARGE_SCALE_VOLUME_KEYWORDS = (
    "all",
    "every",
    "hundreds",
    "thousands",
    "大量",
    "海量",
    "全部",
    "所有",
    "上千",
    "上万",
    "成百上千",
)
_LARGE_SCALE_STRUCTURE_KEYWORDS = (
    ".md",
    "markdown",
    "report",
    "zip",
    "分类",
    "理论",
    "案例",
    "文件",
    "知识体系",
    "输出",
)
_MULTISPACE_RE = re.compile(r"\s+")


def _message_type(message: Any) -> str | None:
    value = getattr(message, "type", None)
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    return None


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return str(content or "")


def _has_recent_answered_question(messages: Any) -> bool:
    if not isinstance(messages, list):
        return False

    for message in reversed(messages):
        message_type = _message_type(message)
        if message_type == "human":
            return False
        if message_type != "tool":
            continue

        text = _content_text(getattr(message, "content", ""))
        if not text.lstrip().startswith("{"):
            continue
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            continue

        if (
            isinstance(payload, dict)
            and payload.get("kind") == "question_result"
            and payload.get("status") == "answered"
        ):
            return True

    return False


def _latest_human_text(messages: Any) -> str:
    if not isinstance(messages, list):
        return ""

    for message in reversed(messages):
        if _message_type(message) != "human":
            continue
        return _content_text(getattr(message, "content", ""))
    return ""


def _normalized_match_text(value: str) -> str:
    return _MULTISPACE_RE.sub(" ", value).strip().lower()


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def _requires_large_scale_intake_question(messages: Any) -> bool:
    if _has_recent_answered_question(messages):
        return False

    latest_human = _normalized_match_text(_latest_human_text(messages))
    if not latest_human:
        return False

    research_like = _contains_any(latest_human, _LARGE_SCALE_RESEARCH_KEYWORDS)
    if not research_like:
        return False

    scale_like = _contains_any(latest_human, _LARGE_SCALE_VOLUME_KEYWORDS)
    structure_like = _contains_any(latest_human, _LARGE_SCALE_STRUCTURE_KEYWORDS)
    return scale_like and structure_like


def _blocked_question_gate_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    tool_name = ""
    if isinstance(request.tool_call, dict):
        tool_name = str(request.tool_call.get("name") or "").strip()
    if tool_name == "question":
        return None

    raw_messages = request.state
    if isinstance(request.state, dict):
        raw_messages = request.state.get("messages", request.state)
    if not _requires_large_scale_intake_question(raw_messages):
        return None

    return ToolMessage(
        content=_QUESTION_FIRST_REQUIRED_TOOL_ERROR,
        tool_call_id=request.tool_call["id"],
    )


class QuestionDisciplineMiddleware(AgentMiddleware):
    """Append a compact policy block that keeps clarification on the tool path."""

    @staticmethod
    def _override_request(request: ModelRequest[Any]) -> ModelRequest[Any]:
        prompt = _QUESTION_DISCIPLINE_PROMPT
        raw_messages = request.messages
        if isinstance(request.state, dict):
            raw_messages = request.state.get("messages", request.messages)
        if _has_recent_answered_question(raw_messages):
            prompt = f"{prompt}\n\n{_QUESTION_RESUME_PROMPT}"

        return request.override(
            system_message=append_to_system_message(
                request.system_message,
                prompt,
            )
        )

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        return handler(self._override_request(request))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        return await handler(self._override_request(request))

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command | Any],
    ) -> ToolMessage | Command | Any:
        blocked = _blocked_question_gate_tool_message(request)
        if blocked is not None:
            return blocked
        return handler(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command | Any]],
    ) -> ToolMessage | Command | Any:
        blocked = _blocked_question_gate_tool_message(request)
        if blocked is not None:
            return blocked
        return await handler(request)
