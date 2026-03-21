"""Retry model output when a final text draft materially overshoots a stated length target."""

from __future__ import annotations

import logging
from pathlib import PurePosixPath
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from src.agents.middlewares.model_response_utils import last_ai_message, system_message_text

logger = logging.getLogger(__name__)

_RETRY_TAG = "<target_length_recovery>"
_MAX_RETRIES = 3
_APPROX_CN_RE = re.compile(
    r"(?:(?:约|大约|大概|差不多|控制在)\s*)?(\d{2,5})\s*字\s*(?:左右|上下|以内|内)?",
    re.IGNORECASE,
)
_MAX_CN_RE = re.compile(
    r"(?:不超过|不多于|最多|至多|控制在)\s*(\d{2,5})\s*字",
    re.IGNORECASE,
)
_APPROX_EN_RE = re.compile(
    r"(?:about|around|roughly|approximately)\s*(\d{2,5})\s*words?",
    re.IGNORECASE,
)
_MAX_EN_RE = re.compile(
    r"(?:within|under|fewer than|less than|no more than|at most)\s*(\d{2,5})\s*words?",
    re.IGNORECASE,
)
_DELIVERABLE_LINE_RE = re.compile(
    r"`(?P<file>[^`]+)`\s*[—\-–:：]\s*(?P<desc>.+)$"
)
_WORD_RE = re.compile(r"\b[\w'-]+\b", re.UNICODE)
_CJK_RE = re.compile(r"[\u3400-\u9FFF]")
_TEXT_OUTPUT_SUFFIXES = (".md", ".markdown", ".txt", ".rst")
_CLAUSE_BOUNDARY_CHARS = "\n。！？!?；;，,:："
_MARKDOWN_SEPARATOR_RE = re.compile(r"[-*_]{3,}")
_CATEGORY_ALIASES: dict[str, tuple[str, ...]] = {
    "copy": ("文案", "copy", "广告"),
    "report": ("报告", "report", "analysis"),
    "article": ("文章", "essay", "议论文", "辩论", "debate"),
    "script": ("脚本", "script"),
    "plan": ("行程", "计划", "itinerary", "trip"),
}


@dataclass(frozen=True)
class LengthConstraint:
    """Normalized user length guidance extracted from the latest human turn."""

    target: int
    unit: Literal["chars", "words"]
    kind: Literal["approx", "max"]
    categories: frozenset[str]


@dataclass(frozen=True)
class LengthViolation:
    """A draft that materially exceeds the user's explicit target length."""

    file_path: str
    actual: int
    allowed: int
    constraint: LengthConstraint
    file_categories: frozenset[str] = field(default_factory=frozenset)
    prefer_cjk_prompt: bool = False


def _retry_count(system_text: str) -> int:
    return system_text.count(_RETRY_TAG)


def _can_retry(system_text: str) -> bool:
    return _retry_count(system_text) < _MAX_RETRIES


def _text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
            continue
        if not isinstance(block, dict):
            continue
        if block.get("type") != "text":
            continue
        text = block.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts)


def _latest_human_text(messages: Sequence[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            text = _text_from_content(message.content).strip()
            if text:
                return text
    return ""


def _categories_from_text(text: str) -> frozenset[str]:
    lowered = text.lower()
    categories = {
        category
        for category, aliases in _CATEGORY_ALIASES.items()
        if any(alias.lower() in lowered for alias in aliases)
    }
    return frozenset(categories)


def _extract_deliverable_descriptions(text: str) -> dict[str, str]:
    descriptions: dict[str, str] = {}
    for line in text.splitlines():
        match = _DELIVERABLE_LINE_RE.search(line.strip())
        if not match:
            continue
        descriptions[match.group("file").strip().lower()] = match.group("desc").strip()
    return descriptions


def _context_slice(text: str, start: int, end: int, *, radius: int = 120) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    return text[left:right]


def _clause_slice(text: str, start: int, end: int) -> str:
    left = start
    while left > 0 and text[left - 1] not in _CLAUSE_BOUNDARY_CHARS:
        left -= 1

    right = end
    while right < len(text) and text[right] not in _CLAUSE_BOUNDARY_CHARS:
        right += 1

    snippet = text[left:right].strip()
    if snippet:
        return snippet
    return _context_slice(text, start, end)


def _merge_constraints(constraints: list[LengthConstraint]) -> list[LengthConstraint]:
    merged: dict[tuple[str, str, frozenset[str]], LengthConstraint] = {}
    for constraint in constraints:
        key = (constraint.unit, constraint.kind, constraint.categories)
        existing = merged.get(key)
        if existing is None:
            merged[key] = constraint
            continue
        if constraint.kind == "max":
            merged[key] = LengthConstraint(
                target=min(existing.target, constraint.target),
                unit=constraint.unit,
                kind=constraint.kind,
                categories=constraint.categories,
            )
            continue
        merged[key] = LengthConstraint(
            target=existing.target + constraint.target,
            unit=constraint.unit,
            kind=constraint.kind,
            categories=constraint.categories,
        )
    return list(merged.values())


def _extract_length_constraints(text: str) -> list[LengthConstraint]:
    if not text:
        return []

    constraints: list[LengthConstraint] = []
    for match in _MAX_CN_RE.finditer(text):
        constraints.append(
            LengthConstraint(
                target=int(match.group(1)),
                unit="chars",
                kind="max",
                categories=_categories_from_text(
                    _clause_slice(text, match.start(), match.end())
                ),
            )
        )
    for match in _MAX_EN_RE.finditer(text):
        constraints.append(
            LengthConstraint(
                target=int(match.group(1)),
                unit="words",
                kind="max",
                categories=_categories_from_text(
                    _clause_slice(text, match.start(), match.end())
                ),
            )
        )

    if constraints:
        return _merge_constraints(constraints)

    for match in _APPROX_CN_RE.finditer(text):
        constraints.append(
            LengthConstraint(
                target=int(match.group(1)),
                unit="chars",
                kind="approx",
                categories=_categories_from_text(
                    _clause_slice(text, match.start(), match.end())
                ),
            )
        )
    for match in _APPROX_EN_RE.finditer(text):
        constraints.append(
            LengthConstraint(
                target=int(match.group(1)),
                unit="words",
                kind="approx",
                categories=_categories_from_text(
                    _clause_slice(text, match.start(), match.end())
                ),
            )
        )

    return _merge_constraints(constraints)


def _iter_write_file_payloads(message: AIMessage) -> Sequence[tuple[str, str]]:
    payloads: list[tuple[str, str]] = []
    for tool_call in message.tool_calls or []:
        if not isinstance(tool_call, dict):
            continue
        if str(tool_call.get("name") or "").strip() != "write_file":
            continue
        args = tool_call.get("args")
        if not isinstance(args, dict):
            continue
        file_path = str(args.get("file_path") or args.get("path") or "").strip()
        content = args.get("content")
        if file_path and isinstance(content, str):
            payloads.append((file_path, content))
    return payloads


def _is_text_output(file_path: str, content: str) -> bool:
    normalized_path = file_path.lower()
    if not normalized_path.startswith("/mnt/user-data/outputs/"):
        return False
    if not normalized_path.endswith(_TEXT_OUTPUT_SUFFIXES):
        return False

    snippet = content.lstrip().lower()
    return not (snippet.startswith("<!doctype html") or snippet.startswith("<html"))


def _measure_content(content: str, unit: Literal["chars", "words"]) -> int:
    if unit == "words":
        return len(_WORD_RE.findall(content))
    return len(re.sub(r"\s+", "", content))


def _contains_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text))


def _allowed_upper_bound(
    constraint: LengthConstraint,
    file_categories: frozenset[str],
) -> int:
    if constraint.kind == "max":
        buffer = 20 if constraint.unit == "chars" else 5
        return max(constraint.target + buffer, int(constraint.target * 1.10))

    if constraint.unit == "chars" and "copy" in file_categories:
        return max(constraint.target + 50, int(constraint.target * 1.20))

    if constraint.unit == "chars":
        return max(constraint.target + 100, int(constraint.target * 1.30))
    return max(constraint.target + 25, int(constraint.target * 1.20))


def _preferred_retry_window(violation: LengthViolation) -> tuple[int, int] | None:
    if violation.constraint.kind == "max":
        return None

    target = violation.constraint.target
    allowed = violation.allowed
    if violation.constraint.unit == "chars":
        lower = max(1, max(int(target * 0.80), target - 80))
        upper = max(lower, min(allowed, int(target * 1.15), target + 80))
        return lower, upper

    lower = max(1, max(int(target * 0.85), target - 40))
    upper = max(lower, min(allowed, int(target * 1.12), target + 35))
    return lower, upper


def _file_categories(file_path: str, prompt_text: str) -> frozenset[str]:
    basename = PurePosixPath(file_path).name.lower()
    descriptions = _extract_deliverable_descriptions(prompt_text)
    description = descriptions.get(basename, "")
    return _categories_from_text(f"{basename} {description}")


def _find_violation(
    request: ModelRequest[Any],
    response: ModelResponse[Any],
) -> LengthViolation | None:
    message = last_ai_message(response.result)
    if message is None or not message.tool_calls:
        return None

    prompt_text = _latest_human_text(request.messages)
    constraints = _extract_length_constraints(prompt_text)
    if not constraints:
        return None
    deliverable_descriptions = _extract_deliverable_descriptions(prompt_text)

    payloads = list(_iter_write_file_payloads(message))
    for file_path, content in payloads:
        if not _is_text_output(file_path, content):
            continue

        file_categories = _file_categories(file_path, prompt_text)
        matching_constraints = [
            constraint
            for constraint in constraints
            if not constraint.categories or constraint.categories & file_categories
        ]
        if (
            not matching_constraints
            and len(payloads) == 1
            and len(constraints) == 1
            and len(deliverable_descriptions) <= 1
        ):
            matching_constraints = constraints
        if not matching_constraints:
            continue

        constraint = matching_constraints[0]
        allowed = _allowed_upper_bound(constraint, file_categories)
        actual = _measure_content(content, constraint.unit)
        if actual > allowed:
            return LengthViolation(
                file_path=file_path,
                actual=actual,
                allowed=allowed,
                constraint=constraint,
                file_categories=file_categories,
                prefer_cjk_prompt=_contains_cjk(prompt_text),
            )
    return None


def _is_better_violation(
    candidate: LengthViolation,
    current_best: LengthViolation | None,
) -> bool:
    if current_best is None:
        return True
    candidate_score = (candidate.actual - candidate.allowed, candidate.actual)
    best_score = (current_best.actual - current_best.allowed, current_best.actual)
    return candidate_score < best_score


def _should_compact_copy_markdown(violation: LengthViolation) -> bool:
    return (
        violation.constraint.unit == "chars"
        and "copy" in violation.file_categories
        and violation.file_path.lower().endswith((".md", ".markdown"))
    )


def _looks_like_ascii_translation_line(line: str) -> bool:
    if _contains_cjk(line):
        return False
    return len(_WORD_RE.findall(line)) >= 3


def _compact_short_copy_markdown(
    content: str,
    *,
    prefer_cjk_prompt: bool,
) -> str:
    compacted_lines: list[str] = []
    saw_title = False

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or _MARKDOWN_SEPARATOR_RE.fullmatch(line):
            continue

        line = re.sub(r"^>+\s*", "", line)
        if line.startswith("#"):
            heading_text = line.lstrip("#").strip()
            if saw_title:
                continue
            line = heading_text
            saw_title = True

        line = re.sub(r"^[-*+]\s+", "", line)
        line = (
            line.replace("**", "")
            .replace("__", "")
            .replace("*", "")
            .replace("`", "")
        ).strip()
        if not line:
            continue
        if prefer_cjk_prompt and _looks_like_ascii_translation_line(line):
            continue
        compacted_lines.append(line)

    compacted = "\n".join(compacted_lines).strip()
    return compacted or content


def _compact_copy_violation_response(
    response: ModelResponse[Any],
    violation: LengthViolation,
) -> ModelResponse[Any]:
    if not _should_compact_copy_markdown(violation):
        return response

    compacted_actual = violation.actual
    response_changed = False
    updated_messages: list[BaseMessage] = []

    for message in response.result:
        if not isinstance(message, AIMessage) or not message.tool_calls:
            updated_messages.append(message)
            continue

        message_changed = False
        updated_tool_calls: list[Any] = []
        for tool_call in message.tool_calls:
            if not isinstance(tool_call, dict):
                updated_tool_calls.append(tool_call)
                continue
            if str(tool_call.get("name") or "").strip() != "write_file":
                updated_tool_calls.append(tool_call)
                continue

            args = tool_call.get("args")
            if not isinstance(args, dict):
                updated_tool_calls.append(tool_call)
                continue

            file_path = str(args.get("file_path") or args.get("path") or "").strip()
            content = args.get("content")
            if file_path != violation.file_path or not isinstance(content, str):
                updated_tool_calls.append(tool_call)
                continue

            compacted_content = _compact_short_copy_markdown(
                content,
                prefer_cjk_prompt=violation.prefer_cjk_prompt,
            )
            candidate_actual = _measure_content(
                compacted_content,
                violation.constraint.unit,
            )
            if candidate_actual >= compacted_actual:
                updated_tool_calls.append(tool_call)
                continue

            compacted_actual = candidate_actual
            message_changed = True
            updated_tool_calls.append(
                {
                    **tool_call,
                    "args": {
                        **args,
                        "content": compacted_content,
                    },
                }
            )

        if message_changed:
            response_changed = True
            updated_messages.append(
                message.model_copy(update={"tool_calls": updated_tool_calls})
            )
            continue

        updated_messages.append(message)

    if not response_changed:
        return response

    logger.info(
        "Compacted oversized marketing copy markdown before retry",
        extra={
            "file_path": violation.file_path,
            "actual": violation.actual,
            "compacted_actual": compacted_actual,
            "allowed": violation.allowed,
        },
    )
    return ModelResponse(
        result=updated_messages,
        structured_response=response.structured_response,
    )


def _normalize_response_for_length_violation(
    request: ModelRequest[Any],
    response: ModelResponse[Any],
) -> ModelResponse[Any]:
    violation = _find_violation(request, response)
    if violation is None:
        return response
    return _compact_copy_violation_response(response, violation)


def _retry_prompt(violation: LengthViolation, *, attempt: int) -> str:
    if violation.prefer_cjk_prompt:
        return _retry_prompt_zh(violation, attempt=attempt)

    unit_label = "words" if violation.constraint.unit == "words" else "compact characters"
    if violation.constraint.kind == "max":
        target_text = f"at most {violation.constraint.target} {unit_label}"
        range_text = (
            f"Keep the rewritten draft under {violation.constraint.target} {unit_label} if possible, "
            f"and never let it drift past {violation.allowed} {unit_label}."
        )
    else:
        target_text = f"around {violation.constraint.target} {unit_label}"
        preferred_window = _preferred_retry_window(violation)
        if preferred_window is None:
            range_text = f"Keep the rewritten draft much closer to {target_text}."
        else:
            lower, upper = preferred_window
            range_text = (
                f"Aim for a compact {lower}-{upper} {unit_label} range and err shorter rather than longer."
            )

    structure_note = ""
    if violation.constraint.unit == "chars":
        structure_note = (
            "- Prefer a plain, compact structure: at most one short title and a few tight paragraphs unless the user explicitly asked for more formatting.\n"
            "- Avoid decorative separators, tables, blockquotes, emoji, and long bullet lists unless the user explicitly required them.\n"
        )

    category_note = ""
    if "copy" in violation.file_categories and violation.constraint.unit == "chars":
        category_note = (
            "- For short marketing copy, use this compact shape unless the user explicitly required something else: one short title, one slogan line, two short prose paragraphs, and one closing CTA line.\n"
            "- Mention the differentiator and competitor weakness inside prose. Include at most one short voice-command example.\n"
            "- Do not add extra section headings, English taglines, bullet lists, pricing ladders, spec lists, or feature matrices unless the user explicitly asked for them.\n"
        )

    escalation_note = ""
    if attempt >= 2:
        escalation_note = (
            "- Compress structure as well as wording: merge sections, keep only the strongest details, and cut examples, specs, or pricing grids that are not explicitly required.\n"
        )

    final_retry_note = ""
    if attempt >= _MAX_RETRIES:
        final_retry_note = (
            "- This is the final retry. Keep only the minimum required deliverable content and compress aggressively. Remove bonus details, repeated persuasion, and ornamental formatting.\n"
        )

    return f"""
<target_length_recovery>
- Your draft for `{violation.file_path}` is about {violation.actual} {unit_label}, but the user asked for {target_text}.
- {range_text}
- Emit only the final deliverable content for that file. Do not add process headings, "步骤" labels, meta commentary, or repeated summaries unless the user explicitly asked for them.
- Keep required filenames, keywords, and deliverable structure, but remove repetition, filler, and overly long examples.
- If you are unsure, prefer a slightly shorter draft over a longer one.
{structure_note}{category_note}{escalation_note}{final_retry_note}- Emit a shorter replacement `write_file` call for the same final output file.
</target_length_recovery>
""".strip()


def _retry_prompt_zh(violation: LengthViolation, *, attempt: int) -> str:
    unit_label = "单词" if violation.constraint.unit == "words" else "紧凑字符"
    if violation.constraint.kind == "max":
        target_text = f"不超过 {violation.constraint.target} {unit_label}"
        range_text = (
            f"请尽量压到 {violation.constraint.target} {unit_label} 以内，绝对不要再超过 {violation.allowed} {unit_label}。"
        )
    else:
        target_text = f"约 {violation.constraint.target} {unit_label}"
        preferred_window = _preferred_retry_window(violation)
        if preferred_window is None:
            range_text = f"请把成稿明显压回到接近 {target_text} 的范围。"
        else:
            lower, upper = preferred_window
            range_text = (
                f"目标区间控制在 {lower}-{upper} {unit_label}，宁可略短，也不要再写长。"
            )

    structure_note = ""
    if violation.constraint.unit == "chars":
        structure_note = (
            "- 结构必须压平：默认只保留 1 行短标题和少量紧凑段落，除非用户明确要求更多格式。\n"
            "- 不要再出现分隔线、表格、引用、emoji、长项目列表、'## 正文' 之类的二级标题，除非用户明确要求。\n"
        )

    category_note = ""
    if "copy" in violation.file_categories and violation.constraint.unit == "chars":
        category_note = (
            "- 对于短营销文案，默认使用这个紧凑骨架：1 行短标题 + 1 行口号 + 2 段短正文 + 1 行收束 CTA。\n"
            "- 口号必须是 8-20 个字或字符的短句，单独成一行，不要加副标题、破折号解释、英文翻译或第二层口号。\n"
            "- 差异化优势和竞品不足直接写进正文里；语音控制示例最多保留 1 条短句。\n"
            "- 禁止额外小标题、英文副标题、项目符号、价格阶梯、参数清单、功能矩阵，除非用户明确要求。\n"
        )

    escalation_note = ""
    if attempt >= 2:
        escalation_note = (
            "- 这次不仅要压措辞，还要压结构：合并段落，删掉冗余示例、规格、价格说明和装饰性表达。\n"
        )

    final_retry_note = ""
    if attempt >= _MAX_RETRIES:
        final_retry_note = (
            "- 这是最后一次软重试。只保留完成任务所必需的内容，优先删除英文附加句、第二个以上的示例、装饰性标题和额外卖点扩写。\n"
        )

    return f"""
<target_length_recovery>
- `{violation.file_path}` 当前约有 {violation.actual} {unit_label}，但用户要求是 {target_text}。
- {range_text}
- 只输出这个文件的最终交付内容，不要再加“步骤”“过程说明”“字数统计”“元叙述”或重复总结。
- 必须保留用户明确要求的关键词、文件名和交付目标，但要删除重复、填充句和过长示例。
- 如果拿不准，优先写得更短，而不是更长。
{structure_note}{category_note}{escalation_note}{final_retry_note}- 请重新发出一个更短的、指向同一最终文件的 `write_file` 调用。
</target_length_recovery>
""".strip()


class TargetLengthRetryMiddleware(AgentMiddleware):
    """Retry a small number of times when a final text draft clearly overshoots."""

    def _retry_request(
        self,
        request: ModelRequest[Any],
        violation: LengthViolation,
    ) -> ModelRequest[Any]:
        attempt = _retry_count(system_message_text(request.system_message)) + 1
        return request.override(
            system_message=append_to_system_message(
                request.system_message,
                _retry_prompt(violation, attempt=attempt),
            )
        )

    def _log_retry(
        self,
        request: ModelRequest[Any],
        violation: LengthViolation,
        *,
        async_mode: bool,
    ) -> None:
        attempt = _retry_count(system_message_text(request.system_message)) + 1
        logger.info(
            "Retrying %smodel call after oversized final draft",
            "async " if async_mode else "",
            extra={
                "attempt": attempt,
                "file_path": violation.file_path,
                "actual": violation.actual,
                "target": violation.constraint.target,
                "allowed": violation.allowed,
                "unit": violation.constraint.unit,
                "kind": violation.constraint.kind,
            },
        )

    def _log_budget_exhausted(
        self,
        request: ModelRequest[Any],
        violation: LengthViolation,
        *,
        best_violation: LengthViolation,
        async_mode: bool,
    ) -> None:
        logger.warning(
            "Length retry budget exhausted; returning best oversized draft seen so far",
            extra={
                "attempt": _retry_count(system_message_text(request.system_message)),
                "file_path": violation.file_path,
                "actual": violation.actual,
                "best_actual": best_violation.actual,
                "target": violation.constraint.target,
                "allowed": violation.allowed,
                "unit": violation.constraint.unit,
                "kind": violation.constraint.kind,
                "async_mode": async_mode,
            },
        )

    def _run_with_retry_loop(
        self,
        request: ModelRequest[Any],
        response: ModelResponse[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        current_request = request
        current_response = response
        best_response = response
        best_violation: LengthViolation | None = None
        while True:
            current_response = _normalize_response_for_length_violation(
                current_request,
                current_response,
            )
            violation = _find_violation(current_request, current_response)
            if violation is None:
                return current_response

            if _is_better_violation(violation, best_violation):
                best_response = current_response
                best_violation = violation

            if not _can_retry(system_message_text(current_request.system_message)):
                assert best_violation is not None
                self._log_budget_exhausted(
                    current_request,
                    violation,
                    best_violation=best_violation,
                    async_mode=False,
                )
                return best_response

            self._log_retry(current_request, violation, async_mode=False)
            current_request = self._retry_request(current_request, violation)
            current_response = handler(current_request)

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        response = handler(request)
        return self._run_with_retry_loop(request, response, handler)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        current_request = request
        current_response = await handler(current_request)
        best_response = current_response
        best_violation: LengthViolation | None = None
        while True:
            current_response = _normalize_response_for_length_violation(
                current_request,
                current_response,
            )
            violation = _find_violation(current_request, current_response)
            if violation is None:
                return current_response

            if _is_better_violation(violation, best_violation):
                best_response = current_response
                best_violation = violation

            if not _can_retry(system_message_text(current_request.system_message)):
                assert best_violation is not None
                self._log_budget_exhausted(
                    current_request,
                    violation,
                    best_violation=best_violation,
                    async_mode=True,
                )
                return best_response

            self._log_retry(current_request, violation, async_mode=True)
            current_request = self._retry_request(current_request, violation)
            current_response = await handler(current_request)
