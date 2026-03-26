from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse

from src.config.agents_config import load_agents_md
from src.knowledge import KnowledgeService
from src.knowledge.formatters import format_documents_payload
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
        "- For grounded answers from attached knowledge documents, use the indexed knowledge tools as the default retrieval path.",
        "- Hard rule: if your answer depends on an attached knowledge document, you must call at least one knowledge tool in the current turn before answering.",
        "- Forbidden path for attached knowledge-document QA: do not use `grep`, `read_file`, `ls`, `glob`, shell/bash, `web_search`, or subagent-only search over `/mnt/user-data/...` unless the user explicitly asks you to debug raw parsing or indexing.",
        "- Prior turn memory, prior tool outputs, prior node ids, and prior citations are never sufficient by themselves for a new knowledge-document answer.",
        "- Recommended sequence: `list_knowledge_documents` -> `get_document_tree` -> `get_document_tree_node_detail`.",
        "- `get_document_tree` returns a nested tree with titles, summaries, and locators, but not raw node text.",
        "- Use document titles, node summaries, branch labels, page ranges, and `has_more_children` from the tree to narrow the search before reading node details.",
        "- `get_document_tree_node_detail` accepts one or more comma-separated node ids and returns JSON items with grounded source text.",
        "- For PDFs, prefer the returned `page_chunks[].citation_markdown` when the answer comes from one page. For markdown-style documents, use the item-level `citation_markdown`.",
        "- `get_document_tree_node_detail` already returns the grounded source text slice for a node. Do not switch to `grep`, `read_file`, shell commands, or web tools for the same document unless the knowledge tools fail to surface the needed node or the user explicitly asks for raw parsing/debugging.",
        "- Even when you think a raw text search might be faster, you must stay on the knowledge-tool path first because raw file search weakens tree reasoning, page localization, and citation fidelity.",
        "- If a relevant PDF page contains a figure or diagram, use `get_document_image(document_name_or_id=..., page_number=...)`, and then `view_image(image_path=...)` when vision is available.",
        "- Do not answer from document descriptions alone; answer only after reading matching node detail source text.",
        "- Copy `citation_markdown` exactly as returned by the knowledge tool response.",
        "- Even if you remember the answer from earlier in the conversation, you must refresh the evidence with a new knowledge-tool call in this turn and cite that refreshed result.",
        "- Treat each new knowledge-document question as requiring fresh retrieval. Do not reuse an earlier turn's citation or conclusion without re-checking the indexed document tree for the current question.",
        "- If attached knowledge documents are relevant, avoid bypassing the knowledge index because that usually weakens page localization and citation fidelity.",
    ]
    if should_enforce_knowledge_tool_priority(runtime_context, documents):
        lines.append("- Because this turn includes explicit `@document` targets, stay with the knowledge tools first and only debug raw parsing when the user explicitly asks for that.")
    lines.append("</knowledge_tool_protocol>")
    return "\n".join(lines)


def build_knowledge_context_prompt(runtime_context: object) -> str:
    documents = _ready_documents(runtime_context)
    if not documents:
        return ""

    knowledge_payload = format_documents_payload(documents)
    selection_prompt = _build_document_selection_prompt(runtime_context, documents)
    protocol_prompt = _build_knowledge_protocol_prompt(runtime_context, documents)
    return "\n".join(
        [
            *([selection_prompt] if selection_prompt else []),
            protocol_prompt,
            "<knowledge_documents>",
            "- The following knowledge documents are attached to this thread.",
            "- Use these descriptions only to decide which document to inspect next.",
            "- Do not answer from the descriptions alone; use the knowledge tools to inspect tree nodes and source text.",
            knowledge_payload,
            "</knowledge_documents>",
        ]
    )


class KnowledgeContextMiddleware(AgentMiddleware):
    @staticmethod
    def _override_request(request: ModelRequest[Any]) -> ModelRequest[Any]:
        knowledge_prompt = build_knowledge_context_prompt(request.runtime.context)
        if not knowledge_prompt:
            return request
        return request.override(
            system_message=append_to_system_message(
                request.system_message,
                knowledge_prompt,
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
