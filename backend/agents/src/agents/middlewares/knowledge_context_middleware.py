from __future__ import annotations

import json

from collections.abc import Awaitable, Callable, Sequence
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain.tools.tool_node import ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from src.config.agents_config import load_agents_md
from src.knowledge import KnowledgeService
from src.knowledge.models import KnowledgeDocumentRecord
from src.knowledge.references import (
    ResolvedKnowledgeReferences,
    extract_knowledge_document_mentions,
    resolve_knowledge_document_mentions,
)
from src.knowledge.runtime import resolve_knowledge_runtime_identity
from src.utils.runtime_context import runtime_context_value
from src.agents.middlewares.model_response_utils import (
    has_visible_response,
    last_ai_message,
    message_stop_reason,
    system_message_text,
)

_KNOWLEDGE_TOOL_NAMES = frozenset(
    {
        "list_knowledge_documents",
        "get_document_tree",
        "get_document_evidence",
        "get_document_tree_node_detail",
        "get_document_image",
    }
)
_BLOCKED_KNOWLEDGE_BYPASS_TOOLS = frozenset(
    {
        "grep",
        "read_file",
        "glob",
        "ls",
        "list_dir",
        "execute",
        "bash",
        "task",
        "web_search",
    }
)
_KNOWLEDGE_DEBUG_HINTS = (
    "debug knowledge",
    "debug index",
    "debug parsing",
    "index debug",
    "raw parsing",
    "parsing debug",
    "source map",
    "canonical markdown",
    "large_tool_results",
    "调试索引",
    "索引调试",
    "调试解析",
    "解析调试",
    "原始解析",
    "构建索引",
    "source map",
    "canonical",
)
_KNOWLEDGE_BYPASS_ERROR = (
    "Error: attached knowledge-document retrieval for this turn must stay on the knowledge tools. "
    "Do not use `grep`, `read_file`, `glob`, `ls`, `execute`, `task`, or `web_search` over the same "
    "document path. Use `list_knowledge_documents` when needed, inspect the tree with "
    "`get_document_tree(document_name_or_id=..., max_depth=2)` or "
    "`get_document_tree(document_name_or_id=..., node_id=...)`, then read grounded evidence with "
    "`get_document_evidence(document_name_or_id=..., node_ids=...)`. "
    "If a knowledge tool spills to `/large_tool_results/...`, narrow the subtree instead of reading that spill file."
)
_KNOWLEDGE_VISUAL_SEQUENCE_ERROR = (
    "Error: for knowledge-base visual questions, do not call `get_document_image` or `view_image` before grounding the answer. "
    "First use `get_document_evidence(document_name_or_id=..., node_ids=...)` to retrieve the matching evidence bundle, "
    "then call `get_document_image(page_number=...)` or `view_image(image_path=...)` only if you still need visual inspection. "
    "A failed `get_document_evidence(...)` call does not count as grounding; narrow the subtree and retry. "
    "Your final answer must still use the exact `citation_markdown` from that knowledge evidence."
)
_KNOWLEDGE_VISUAL_EXACT_PATH_ERROR = (
    "Error: for knowledge-base visual inspection, only use the exact `image_path` returned in the current turn by "
    "`get_document_evidence(...)` or `get_document_image(...)`. Do not guess `/mnt/user-data/outputs/.knowledge/...` "
    "paths by hand. Retrieve the matching evidence bundle first, then pass its exact `image_path` to `view_image(...)`."
)
_KNOWLEDGE_VISUAL_PAGE_MATCH_ERROR = (
    "Error: `get_document_image(page_number=...)` must follow a matching current-turn `get_document_evidence(...)` bundle "
    "that covers the same page. Narrow the tree to the relevant branch, retrieve grounded evidence for that page, and then "
    "request the page image."
)
_KNOWLEDGE_VISUAL_HINTS = (
    "封面",
    "图片",
    "图像",
    "图表",
    "图",
    "场景",
    "展示",
    "外观",
    "看起来",
    "figure",
    "diagram",
    "chart",
    "visual",
    "layout",
    "cover",
)
_KNOWLEDGE_RESPONSE_RECOVERY_TAG = "<knowledge_response_recovery>"
_KNOWLEDGE_RESPONSE_RECOVERY_PROMPT = """
<knowledge_response_recovery>
- Your previous attempt was invalid for this knowledge-document turn.
- If you only inspected `get_document_tree(...)`, do not answer yet. Call `get_document_evidence(document_name_or_id=..., node_ids=...)` for the specific nodes you want to describe.
- If you already have a current-turn evidence bundle, rewrite the answer and include the exact `citation_markdown` on every substantive paragraph or bullet.
- If this is a visual question and the evidence bundle already includes `display_markdown`, include that grounded visual block directly in the answer instead of describing the image without showing it.
- Do not answer from tree summaries alone.
- Your next step should usually be a knowledge tool call, not visible prose, unless fresh evidence with exact citations is already present in the current turn.
</knowledge_response_recovery>
""".strip()


def _normalize_mentions(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()

    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = str(item or "").strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return tuple(normalized)


def _agent_document_mentions(runtime_context: object) -> tuple[str, ...]:
    agent_name = str(runtime_context_value(runtime_context, "agent_name") or "").strip()
    if not agent_name:
        return ()

    agent_status = str(runtime_context_value(runtime_context, "agent_status") or "dev").strip() or "dev"
    try:
        agents_md = load_agents_md(agent_name, status=agent_status)
    except Exception:
        return ()
    return extract_knowledge_document_mentions(agents_md)


def _document_prompt_line(document) -> str:
    summary = f" ({document.doc_description})" if document.doc_description else ""
    return f"  - {document.display_name} [{document.knowledge_base_name}]{summary}"


def _ready_documents(runtime_context: object) -> list[KnowledgeDocumentRecord]:
    try:
        user_id, thread_id = resolve_knowledge_runtime_identity(runtime_context)
    except ValueError:
        return []

    documents = KnowledgeService().get_thread_document_records(
        user_id=user_id,
        thread_id=thread_id,
    )
    return [document for document in documents if document.status == "ready"]


def _explicit_document_mentions(runtime_context: object) -> tuple[str, ...]:
    explicit_mentions = _normalize_mentions(runtime_context_value(runtime_context, "knowledge_document_mentions"))
    if explicit_mentions:
        return explicit_mentions
    return extract_knowledge_document_mentions(str(runtime_context_value(runtime_context, "original_user_input") or ""))


def _normalize_text(value: object) -> str:
    return str(value or "").strip().casefold()


def _state_messages(state: object) -> list[object]:
    if isinstance(state, dict):
        messages = state.get("messages")
    else:
        messages = getattr(state, "messages", None)
        if messages is None and hasattr(state, "get"):
            try:
                messages = state.get("messages")
            except Exception:
                messages = None
    if isinstance(messages, Sequence) and not isinstance(messages, (str, bytes)):
        return list(messages)
    return []


def _message_type(message: object) -> str:
    if isinstance(message, dict):
        return _normalize_text(message.get("type"))
    return _normalize_text(getattr(message, "type", None))


def _message_name(message: object) -> str:
    if isinstance(message, dict):
        return _normalize_text(message.get("name"))
    return _normalize_text(getattr(message, "name", None))


def _message_tool_call_names(message: object) -> tuple[str, ...]:
    tool_calls = message.get("tool_calls") if isinstance(message, dict) else getattr(message, "tool_calls", None)
    if not isinstance(tool_calls, Sequence):
        return ()

    normalized: list[str] = []
    seen: set[str] = set()
    for tool_call in tool_calls:
        if isinstance(tool_call, dict):
            name = tool_call.get("name")
        else:
            name = getattr(tool_call, "name", None)
        normalized_name = _normalize_text(name)
        if not normalized_name or normalized_name in seen:
            continue
        seen.add(normalized_name)
        normalized.append(normalized_name)
    return tuple(normalized)


def _message_text(message: object) -> str:
    content = message.get("content") if isinstance(message, dict) else getattr(message, "content", None)
    if isinstance(content, str):
        return content
    if not isinstance(content, Sequence):
        return ""

    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
            continue
        if isinstance(item, dict) and item.get("type") == "text":
            parts.append(str(item.get("text") or ""))
    return "".join(parts)


def _last_human_text(state: object) -> str:
    for message in reversed(_state_messages(state)):
        if _message_type(message) == "human":
            return _message_text(message)
    return ""


def _current_turn_messages(state: object) -> list[object]:
    messages = _state_messages(state)
    if not messages:
        return []

    last_human_index = -1
    for index, message in enumerate(messages):
        if _message_type(message) == "human":
            last_human_index = index

    if last_human_index < 0:
        return messages
    return messages[last_human_index:]


def _current_turn_has_knowledge_activity(state: object) -> bool:
    for message in _current_turn_messages(state):
        if _message_type(message) == "tool" and _message_name(message) in _KNOWLEDGE_TOOL_NAMES:
            return True
        if _message_type(message) == "ai":
            if any(tool_name in _KNOWLEDGE_TOOL_NAMES for tool_name in _message_tool_call_names(message)):
                return True
    return False


def _message_has_knowledge_citation(message: object) -> bool:
    return "(kb://citation" in _message_text(message)


def _message_has_knowledge_asset(message: object) -> bool:
    return "(kb://asset" in _message_text(message)


def _message_json_payload(message: object) -> dict[str, Any] | None:
    content = _message_text(message).strip()
    if not content or content.startswith("Error:"):
        return None
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _current_turn_has_successful_evidence_bundle(state: object) -> bool:
    for message in _current_turn_messages(state):
        if _message_type(message) != "tool" or _message_name(message) != "get_document_evidence":
            continue
        payload = _message_json_payload(message)
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            return True
    return False


def _current_turn_successful_evidence_payloads(state: object) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for message in _current_turn_messages(state):
        if _message_type(message) != "tool" or _message_name(message) != "get_document_evidence":
            continue
        payload = _message_json_payload(message)
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            payloads.append(payload)
    return payloads


def _payload_has_visual_display_markdown(payload: dict[str, Any]) -> bool:
    for item in payload.get("items", []):
        if not isinstance(item, dict):
            continue
        for block in item.get("evidence_blocks", []):
            if not isinstance(block, dict):
                continue
            if str(block.get("display_markdown") or block.get("image_markdown") or "").strip():
                return True
    return False


def _current_turn_has_visual_display_markdown(state: object) -> bool:
    return any(
        _payload_has_visual_display_markdown(payload)
        for payload in _current_turn_successful_evidence_payloads(state)
    )


def _parse_page_range_label(value: object) -> tuple[int, int] | None:
    text = str(value or "").strip()
    if not text:
        return None
    if "-" not in text:
        try:
            page = int(text)
        except ValueError:
            return None
        return page, page
    start_text, end_text = text.split("-", 1)
    try:
        start = int(start_text.strip())
        end = int(end_text.strip())
    except ValueError:
        return None
    if start > end:
        return None
    return start, end


def _payload_covers_page(payload: dict[str, Any], page_number: int) -> bool:
    returned_pages = _parse_page_range_label(payload.get("returned_pages"))
    if returned_pages is not None:
        start, end = returned_pages
        if start <= page_number <= end:
            return True

    for item in payload.get("items", []):
        if not isinstance(item, dict):
            continue
        for block in item.get("evidence_blocks", []):
            if not isinstance(block, dict):
                continue
            block_page = block.get("page_number")
            if isinstance(block_page, int) and block_page == page_number:
                return True
    return False


def _current_turn_has_matching_evidence_page(state: object, page_number: int) -> bool:
    return any(_payload_covers_page(payload, page_number) for payload in _current_turn_successful_evidence_payloads(state))


def _current_turn_allowed_knowledge_image_paths(state: object) -> set[str]:
    allowed: set[str] = set()

    for payload in _current_turn_successful_evidence_payloads(state):
        for item in payload.get("items", []):
            if not isinstance(item, dict):
                continue
            for block in item.get("evidence_blocks", []):
                if not isinstance(block, dict):
                    continue
                image_path = str(block.get("image_path") or "").strip()
                if image_path:
                    allowed.add(image_path)

    for message in _current_turn_messages(state):
        if _message_type(message) != "tool" or _message_name(message) != "get_document_image":
            continue
        payload = _message_json_payload(message)
        if not isinstance(payload, dict):
            continue
        image_path = str(payload.get("image_path") or "").strip()
        if image_path:
            allowed.add(image_path)

    return allowed


def _is_knowledge_asset_path(value: object) -> bool:
    path = str(value or "").strip()
    return path.startswith("/mnt/user-data/outputs/.knowledge/")


def _document_reference_candidates(document: KnowledgeDocumentRecord) -> tuple[str, ...]:
    candidates = [
        document.display_name,
        document.knowledge_base_name,
    ]
    display_name = str(document.display_name or "").strip()
    if "." in display_name:
        candidates.append(display_name.rsplit(".", 1)[0])

    normalized: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        text = _normalize_text(candidate)
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return tuple(normalized)


def _references_attached_document(
    runtime_context: object,
    documents: Sequence[KnowledgeDocumentRecord],
    *,
    state: object | None = None,
) -> bool:
    input_text = _normalize_text(
        runtime_context_value(runtime_context, "original_user_input") or _last_human_text(state)
    )
    if not input_text:
        return False

    for document in documents:
        if any(candidate in input_text for candidate in _document_reference_candidates(document)):
            return True
    return False


def _is_knowledge_debug_request(runtime_context: object, *, state: object | None = None) -> bool:
    input_text = _normalize_text(
        runtime_context_value(runtime_context, "original_user_input") or _last_human_text(state)
    )
    if not input_text:
        return False
    return any(token in input_text for token in _KNOWLEDGE_DEBUG_HINTS)


def _is_visual_knowledge_request(runtime_context: object, *, state: object | None = None) -> bool:
    input_text = _normalize_text(
        runtime_context_value(runtime_context, "original_user_input") or _last_human_text(state)
    )
    if not input_text:
        return False
    return any(token in input_text for token in _KNOWLEDGE_VISUAL_HINTS)


def should_filter_knowledge_bypass_tools(
    runtime_context: object,
    *,
    documents: Sequence[KnowledgeDocumentRecord] | None = None,
    state: object | None = None,
) -> bool:
    ready_documents = list(documents) if documents is not None else _ready_documents(runtime_context)
    if not ready_documents:
        return False
    if _is_knowledge_debug_request(runtime_context, state=state):
        return False
    if should_enforce_knowledge_tool_priority(runtime_context, ready_documents):
        return True
    if _current_turn_has_knowledge_activity(state):
        return True
    return _references_attached_document(runtime_context, ready_documents, state=state)


def _tool_name(tool: object) -> str:
    if isinstance(tool, dict):
        function = tool.get("function")
        if isinstance(function, dict) and function.get("name"):
            return _normalize_text(function.get("name"))
        return _normalize_text(tool.get("name"))
    return _normalize_text(getattr(tool, "name", None))


def blocked_knowledge_bypass_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    tool_name = _normalize_text(request.tool_call.get("name"))
    if tool_name not in _BLOCKED_KNOWLEDGE_BYPASS_TOOLS:
        return None

    runtime_context = getattr(request.runtime, "context", None)
    if not should_filter_knowledge_bypass_tools(
        runtime_context,
        state=getattr(request, "state", None),
    ):
        return None

    return ToolMessage(
        content=_KNOWLEDGE_BYPASS_ERROR,
        tool_call_id=request.tool_call["id"],
        name=request.tool_call["name"],
    )


def blocked_knowledge_visual_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    tool_name = _normalize_text(request.tool_call.get("name"))
    if tool_name == "get_document_image":
        state = getattr(request, "state", None)
        if not _current_turn_has_knowledge_activity(state):
            return None
        page_number = request.tool_call.get("args", {}).get("page_number")
        if isinstance(page_number, int) and _current_turn_has_matching_evidence_page(state, page_number):
            return None
        if _current_turn_has_successful_evidence_bundle(state):
            return ToolMessage(
                content=_KNOWLEDGE_VISUAL_PAGE_MATCH_ERROR,
                tool_call_id=request.tool_call["id"],
                name=request.tool_call["name"],
            )
        return ToolMessage(
            content=_KNOWLEDGE_VISUAL_SEQUENCE_ERROR,
            tool_call_id=request.tool_call["id"],
            name=request.tool_call["name"],
        )

    if tool_name != "view_image":
        return None

    image_path = request.tool_call.get("args", {}).get("image_path")
    if not _is_knowledge_asset_path(image_path):
        return None

    state = getattr(request, "state", None)
    if not _current_turn_has_knowledge_activity(state):
        return None
    if not _current_turn_has_successful_evidence_bundle(state):
        return ToolMessage(
            content=_KNOWLEDGE_VISUAL_SEQUENCE_ERROR,
            tool_call_id=request.tool_call["id"],
            name=request.tool_call["name"],
        )

    allowed_image_paths = _current_turn_allowed_knowledge_image_paths(state)
    if str(image_path).strip() in allowed_image_paths:
        return None

    return ToolMessage(
        content=_KNOWLEDGE_VISUAL_EXACT_PATH_ERROR,
        tool_call_id=request.tool_call["id"],
        name=request.tool_call["name"],
    )


def _knowledge_target_resolution(
    runtime_context: object,
    documents: list[KnowledgeDocumentRecord],
) -> tuple[ResolvedKnowledgeReferences, ResolvedKnowledgeReferences]:
    explicit_resolution = resolve_knowledge_document_mentions(
        documents=documents,
        mentions=_explicit_document_mentions(runtime_context),
    )
    agent_resolution = resolve_knowledge_document_mentions(
        documents=documents,
        mentions=_agent_document_mentions(runtime_context),
    )
    return explicit_resolution, agent_resolution


def should_enforce_knowledge_tool_priority(
    runtime_context: object,
    documents: list[KnowledgeDocumentRecord] | None = None,
) -> bool:
    ready_documents = documents if documents is not None else _ready_documents(runtime_context)
    if not ready_documents:
        return False

    explicit_resolution, _agent_resolution = _knowledge_target_resolution(
        runtime_context,
        ready_documents,
    )
    return bool(explicit_resolution.matched)


def _build_document_selection_prompt(
    runtime_context: object,
    documents: list[KnowledgeDocumentRecord],
) -> str:
    explicit_resolution, agent_resolution = _knowledge_target_resolution(
        runtime_context,
        documents,
    )

    if not explicit_resolution.matched and not explicit_resolution.unresolved and not agent_resolution.matched:
        return ""

    lines = [
        "<knowledge_document_selection>",
        "- Prefer thread-attached knowledge documents in this order: explicit user `@document` references first, then AGENTS.md defaults.",
    ]

    if explicit_resolution.matched:
        lines.append("- User-explicit document targets for this turn:")
        lines.extend(_document_prompt_line(document) for document in explicit_resolution.matched)
        lines.append("- Treat these explicit targets as a hard retrieval preference. Inspect their indexed knowledge tree before falling back to generic file, shell, or subagent tools.")

    if explicit_resolution.unresolved:
        lines.append(f"- Unresolved user document references: {', '.join(explicit_resolution.unresolved)}")
        lines.append("- Do not guess unresolved references. Use list_knowledge_documents to verify available names before inspecting another document.")

    if agent_resolution.matched:
        lines.append("- AGENTS.md default document targets when relevant:")
        lines.extend(_document_prompt_line(document) for document in agent_resolution.matched)

    lines.append("</knowledge_document_selection>")
    return "\n".join(lines)


def _build_knowledge_protocol_prompt(
    runtime_context: object,
    documents: list[KnowledgeDocumentRecord],
) -> str:
    lines = [
        "<knowledge_tool_protocol>",
        "- Use attached knowledge tools as the default path for grounded knowledge-document answers.",
        "- For each new knowledge-document question, refresh evidence in the current turn before answering.",
        "- Do not reuse an earlier turn's citation or evidence block without refreshing it in the current turn.",
        "- Recommended sequence: `list_knowledge_documents` -> `get_document_tree(document_name_or_id=..., max_depth=2)` -> `get_document_tree(document_name_or_id=..., node_id=...)` when needed -> `get_document_evidence(document_name_or_id=..., node_ids=...)`.",
        "- For large documents, the root `get_document_tree(...)` call may intentionally collapse to a top-level overview and return `window_mode=root_overview` / `collapsed_root_overview=true`. Pick the relevant root `node_id` and expand that branch instead of asking for the whole tree again.",
        "- When a collapsed root overview reports `next_root_cursor` or `previous_root_cursor`, page that root overview with `get_document_tree(document_name_or_id=..., root_cursor=...)` instead of requesting the same root slice again.",
        "- `get_document_tree` returns a capped tree window with summaries and locators, not raw text. Treat it as routing metadata, not final evidence.",
        "- Do not answer from `get_document_tree` summaries alone. Before any user-visible prose about the document's contents, directory, topics, section meanings, or conclusions, fetch `get_document_evidence(...)` for the relevant node_ids in the current turn.",
        "- If you only have tree results, keep drilling down or fetch evidence next. Tree-only results are not enough for the final answer.",
        "- If a knowledge tool JSON response includes `answer_requires_evidence=true`, treat that as a hard requirement. Your next step must be `get_document_evidence(...)`, not prose.",
        "- `get_document_evidence` returns grounded text, exact citations, and visual evidence blocks that may include inline-ready image markdown.",
        "- Answer from grounded evidence, not from document descriptions alone.",
        "- Copy `citation_markdown` exactly as returned. If a visual evidence block includes `image_markdown` and the image materially helps, include it naturally in the answer.",
        "- If a visual evidence block includes `display_markdown`, prefer that exact value because it already keeps the image and citation together.",
        "- A knowledge-based final answer without visible exact `citation_markdown` is incorrect. Citations must appear in the user-visible answer, not only in tool traces or hidden reasoning.",
        "- Put each exact `citation_markdown` on the paragraph or bullet it supports. Do not collapse different sections into one uncited overview plus a trailing sources block.",
        "- If `get_document_evidence(...)` returned multiple items, summarize them item by item and keep the matching item-level `citation_markdown` with each corresponding bullet or paragraph.",
        "- If the evidence bundle already includes a relevant `image_markdown`, prefer showing it in the first answer instead of mentioning that an image exists without displaying it.",
        "- For figure, chart, diagram, or page-layout questions, inline the relevant `image_markdown` by default when it is available in the evidence bundle.",
        "- For knowledge-base visual questions, use `get_document_evidence` before any `get_document_image(...)` or `view_image(...)` call. Only inspect images after you already have the matching evidence bundle and citation.",
        "- Never guess `/mnt/user-data/outputs/.knowledge/...` image paths by hand. Pass only the exact `image_path` returned in the current turn by `get_document_evidence(...)` or `get_document_image(...)`.",
        "- If a knowledge tool still returns `/large_tool_results/...`, treat that as a scope-too-broad signal. Narrow the branch with `get_document_tree(..., node_id=...)` instead of opening the spill file.",
        "- Avoid bypassing the knowledge index with raw file or shell search unless the user explicitly asks you to debug parsing or indexing.",
    ]
    if should_enforce_knowledge_tool_priority(runtime_context, documents):
        lines.append("- Because this turn includes explicit `@document` targets, stay with the knowledge tools first and only debug raw parsing when the user explicitly asks for that.")
    lines.append("</knowledge_tool_protocol>")
    return "\n".join(lines)


def _build_knowledge_binding_prompt(documents: list[KnowledgeDocumentRecord]) -> str:
    base_names = sorted(
        {
            document.knowledge_base_name
            for document in documents
            if str(document.knowledge_base_name or "").strip()
        }
    )
    lines = [
        "<knowledge_thread_bindings>",
        (
            "- This thread has "
            f"{len(documents)} ready knowledge document(s) attached across "
            f"{len(base_names)} knowledge base(s)."
        ),
        "- Do not rely on hidden document lists. When you need attached document names or descriptions, call `list_knowledge_documents`.",
    ]
    if base_names:
        lines.append(f"- Attached knowledge bases: {', '.join(base_names)}.")
    lines.append("</knowledge_thread_bindings>")
    return "\n".join(lines)


def build_knowledge_context_prompt(
    runtime_context: object,
    *,
    documents: list[KnowledgeDocumentRecord] | None = None,
) -> str:
    documents = documents if documents is not None else _ready_documents(runtime_context)
    if not documents:
        return ""

    selection_prompt = _build_document_selection_prompt(runtime_context, documents)
    protocol_prompt = _build_knowledge_protocol_prompt(runtime_context, documents)
    binding_prompt = _build_knowledge_binding_prompt(documents)
    return "\n".join(
        [
            *([selection_prompt] if selection_prompt else []),
            protocol_prompt,
            binding_prompt,
        ]
    )


class KnowledgeContextMiddleware(AgentMiddleware):
    @staticmethod
    def _should_retry_knowledge_response(
        request: ModelRequest[Any],
        response: ModelResponse[Any],
    ) -> bool:
        if _KNOWLEDGE_RESPONSE_RECOVERY_TAG in system_message_text(request.system_message):
            return False

        runtime_context = request.runtime.context
        documents = _ready_documents(runtime_context)
        if not documents or _is_knowledge_debug_request(runtime_context, state=request.state):
            return False

        state = request.state
        if not _current_turn_has_knowledge_activity(state):
            return False

        message = last_ai_message(response.result)
        if message is None or message.tool_calls:
            return False

        if not has_visible_response(message):
            return False

        stop_reason = message_stop_reason(message)
        if stop_reason in {"max_tokens", "length"}:
            return False

        if not _current_turn_has_successful_evidence_bundle(state):
            return True

        if not _message_has_knowledge_citation(message):
            return True

        return (
            _is_visual_knowledge_request(runtime_context, state=state)
            and _current_turn_has_visual_display_markdown(state)
            and not _message_has_knowledge_asset(message)
        )

    @staticmethod
    def _retry_knowledge_response_request(request: ModelRequest[Any]) -> ModelRequest[Any]:
        model_settings = dict(request.model_settings)
        if getattr(request.model, "thinking", None) is not None:
            model_settings["thinking"] = {"type": "disabled"}

        return request.override(
            system_message=append_to_system_message(
                request.system_message,
                _KNOWLEDGE_RESPONSE_RECOVERY_PROMPT,
            ),
            model_settings=model_settings,
        )

    @staticmethod
    def _override_request(request: ModelRequest[Any]) -> ModelRequest[Any]:
        documents = _ready_documents(request.runtime.context)
        updated_request = request

        knowledge_prompt = build_knowledge_context_prompt(
            request.runtime.context,
            documents=documents,
        )
        if knowledge_prompt:
            updated_request = updated_request.override(
                system_message=append_to_system_message(
                    updated_request.system_message,
                    knowledge_prompt,
                )
            )

        return updated_request

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        updated_request = self._override_request(request)
        response = handler(updated_request)
        if not self._should_retry_knowledge_response(updated_request, response):
            return response
        return handler(self._retry_knowledge_response_request(updated_request))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        updated_request = self._override_request(request)
        response = await handler(updated_request)
        if not self._should_retry_knowledge_response(updated_request, response):
            return response
        return await handler(self._retry_knowledge_response_request(updated_request))

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        blocked = blocked_knowledge_bypass_tool_message(request)
        if blocked is not None:
            return blocked
        blocked = blocked_knowledge_visual_tool_message(request)
        if blocked is not None:
            return blocked
        return handler(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        blocked = blocked_knowledge_bypass_tool_message(request)
        if blocked is not None:
            return blocked
        blocked = blocked_knowledge_visual_tool_message(request)
        if blocked is not None:
            return blocked
        return await handler(request)
