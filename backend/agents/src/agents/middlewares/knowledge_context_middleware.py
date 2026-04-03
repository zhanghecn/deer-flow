from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse

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


def _document_prompt_line(document: KnowledgeDocumentRecord) -> str:
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
        "- After `list_knowledge_documents`, prefer the returned ASCII `document_id` for every later `document_name_or_id=...` argument. Only fall back to the exact document name when an id is unavailable.",
        "- Pick one concrete document id before each tree or evidence call. Do not send placeholder, guessed, or empty `document_name_or_id` values.",
        "- Treat `get_document_tree` as navigation only. Do not answer from tree summaries alone.",
        "- If a response says `answer_requires_evidence=true`, call `get_document_evidence(...)` next.",
        "- Every substantive paragraph or bullet grounded in knowledge evidence should include the exact current-turn `citation_markdown` when available.",
        "- For visual questions, retrieve evidence first. Prefer `display_markdown` when present; otherwise use `image_markdown` with the matching citation.",
        "- If the tree is collapsed or spills to `/large_tool_results/...`, narrow by `node_id` or `root_cursor` instead of opening spill files or broadening the request again.",
        # Keep KB behavior prompt-led so the agent stays general-purpose. The
        # middleware should not block raw tools or inject hidden retries.
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
        # Keep knowledge guidance as a pre-answer contract. Once a visible
        # answer starts streaming, a hidden retry appends a second answer in the
        # UI because the frontend cannot retract already-emitted tokens.
        return handler(updated_request)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        updated_request = self._override_request(request)
        return await handler(updated_request)
