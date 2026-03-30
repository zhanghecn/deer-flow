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
_KNOWLEDGE_RESPONSE_RECOVERY_TAG = "<knowledge_response_recovery>"
_KNOWLEDGE_RESPONSE_RECOVERY_PROMPT = """
<knowledge_response_recovery>
- Your previous attempt was invalid for this knowledge-document turn.
- If you only inspected `get_document_tree(...)`, call `get_document_evidence(document_name_or_id=..., node_ids=...)` next.
- If you already have current-turn evidence, rewrite the answer and attach the exact `citation_markdown` to every substantive paragraph or bullet.
- For visual questions, prefer the grounded `display_markdown` block when it is already available.
- Do not answer from tree summaries alone.
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


def should_filter_knowledge_bypass_tools(
    runtime_context: object,
    *,
    documents: Sequence[KnowledgeDocumentRecord] | None = None,
    state: object | None = None,
) -> bool:
    ready_documents = list(documents) if documents is not None else _ready_documents(runtime_context)
    if not ready_documents:
        return False
    if should_enforce_knowledge_tool_priority(runtime_context, ready_documents):
        return True
    if _current_turn_has_knowledge_activity(state):
        return True
    return False


def _tool_name(tool: object) -> str:
    if isinstance(tool, dict):
        function = tool.get("function")
        if isinstance(function, dict) and function.get("name"):
            return _normalize_text(function.get("name"))
        return _normalize_text(tool.get("name"))
    return _normalize_text(getattr(tool, "name", None))


def _tool_call_args(tool_call: object) -> dict[str, Any]:
    if not isinstance(tool_call, dict):
        return {}
    args = tool_call.get("args")
    return args if isinstance(args, dict) else {}


def _tool_call_path_candidates(tool_call: object) -> tuple[str, ...]:
    args = _tool_call_args(tool_call)
    candidates: list[str] = []
    seen: set[str] = set()
    for key in ("file_path", "path", "glob", "pattern"):
        value = str(args.get(key) or "").strip()
        if not value or not value.startswith("/") or value in seen:
            continue
        seen.add(value)
        candidates.append(value)
    return tuple(candidates)


def _current_runtime_skill_root(runtime_context: object) -> str | None:
    agent_name = str(runtime_context_value(runtime_context, "agent_name") or "").strip().lower()
    if not agent_name:
        return None
    agent_status = str(runtime_context_value(runtime_context, "agent_status") or "dev").strip() or "dev"
    return f"/mnt/user-data/agents/{agent_status}/{agent_name}/skills/"


def _targets_current_runtime_skill_asset(tool_call: object, runtime_context: object) -> bool:
    tool_name = _normalize_text(tool_call.get("name") if isinstance(tool_call, dict) else None)
    if tool_name not in {"read_file", "ls", "list_dir", "glob", "grep"}:
        return False

    skill_root = _current_runtime_skill_root(runtime_context)
    if not skill_root:
        return False
    return any(candidate.startswith(skill_root) for candidate in _tool_call_path_candidates(tool_call))


def blocked_knowledge_bypass_tool_message(request: ToolCallRequest) -> ToolMessage | None:
    tool_name = _normalize_text(request.tool_call.get("name"))
    if tool_name not in _BLOCKED_KNOWLEDGE_BYPASS_TOOLS:
        return None

    runtime_context = getattr(request.runtime, "context", None)
    # Attached copied skills are part of the current agent contract, not an
    # alternate document source. Let the runtime inspect its own `skills/`
    # files even during knowledge-heavy turns so skill-guided behavior is not
    # blocked by the knowledge guard itself.
    if _targets_current_runtime_skill_asset(request.tool_call, runtime_context):
        return None
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
        lines.append("- Treat these explicit targets as the first retrieval choice for this turn.")

    if explicit_resolution.unresolved:
        lines.append(f"- Unresolved user document references: {', '.join(explicit_resolution.unresolved)}")
        lines.append("- Do not guess unresolved references. Use `list_knowledge_documents` to verify available names first.")

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
        "- Use attached knowledge tools as the default source of truth for attached documents.",
        "- Refresh evidence in the current turn before answering a new knowledge-document question.",
        "- Preferred sequence: `list_knowledge_documents` -> `get_document_tree(..., max_depth=2)` -> `get_document_tree(..., node_id=...)` when needed -> `get_document_evidence(..., node_ids=...)`.",
        "- Treat `get_document_tree` as navigation only. Do not answer from tree summaries alone.",
        "- If a response says `answer_requires_evidence=true`, call `get_document_evidence(...)` next.",
        "- Every substantive paragraph or bullet grounded in knowledge evidence must include the exact current-turn `citation_markdown`.",
        "- For visual questions, retrieve evidence first. Prefer `display_markdown` when present; otherwise use `image_markdown` with the matching citation.",
        "- Use only the exact `image_path` returned in the current turn by the knowledge tools.",
        "- If the tree is collapsed or spills to `/large_tool_results/...`, narrow by `node_id` or `root_cursor` instead of opening spill files.",
        "- Avoid raw file or shell bypass unless the user explicitly asked to debug parsing or indexing.",
    ]
    if should_enforce_knowledge_tool_priority(runtime_context, documents):
        lines.append("- Because this turn includes explicit `@document` targets, stay with the knowledge tools first.")
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
        "- When you need attached document names or descriptions, call `list_knowledge_documents` instead of assuming hidden lists.",
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
        if not documents:
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

        return False

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
