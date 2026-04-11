from __future__ import annotations

from collections.abc import Awaitable, Callable
from html import escape
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

READY_DOCUMENT_STATUSES = frozenset({"ready", "ready_degraded"})


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


def _thread_documents(runtime_context: object) -> list[KnowledgeDocumentRecord]:
    try:
        user_id, thread_id = resolve_knowledge_runtime_identity(runtime_context)
    except ValueError:
        return []

    # KB visibility is thread-scoped and persisted. The prompt must reflect the
    # full attached set so the model does not waste a tool call just to discover
    # which documents exist or whether a document is still unavailable.
    return KnowledgeService().get_thread_document_records(
        user_id=user_id,
        thread_id=thread_id,
    )


def _ready_documents(documents: list[KnowledgeDocumentRecord]) -> list[KnowledgeDocumentRecord]:
    return [document for document in documents if document.status in READY_DOCUMENT_STATUSES]


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


def _xml_text(value: object | None) -> str:
    # Knowledge document names and descriptions may contain XML-reserved
    # characters. Escape them so the injected prompt stays machine-readable.
    return escape(str(value or ""), quote=False)


def _document_xml_lines(
    document: KnowledgeDocumentRecord,
    *,
    indent: str = "    ",
) -> list[str]:
    lines = [
        f"{indent}<document>",
        f"{indent}  <document_id>{_xml_text(document.id)}</document_id>",
        f"{indent}  <display_name>{_xml_text(document.display_name)}</display_name>",
        f"{indent}  <knowledge_base>{_xml_text(document.knowledge_base_name)}</knowledge_base>",
        f"{indent}  <status>{_xml_text(document.status)}</status>",
        f"{indent}  <file_kind>{_xml_text(document.file_kind)}</file_kind>",
        f"{indent}  <locator_type>{_xml_text(document.locator_type)}</locator_type>",
    ]
    if document.doc_description:
        lines.append(f"{indent}  <description>{_xml_text(document.doc_description)}</description>")
    if document.page_count is not None:
        lines.append(f"{indent}  <page_count>{document.page_count}</page_count>")
    if document.node_count >= 0:
        lines.append(f"{indent}  <node_count>{document.node_count}</node_count>")
    if document.build_quality:
        lines.append(f"{indent}  <build_quality>{_xml_text(document.build_quality)}</build_quality>")
    if document.error:
        lines.append(f"{indent}  <error>{_xml_text(document.error)}</error>")
    if document.latest_build_job is not None:
        lines.extend(
            [
                f"{indent}  <latest_build_job>",
                f"{indent}    <status>{_xml_text(document.latest_build_job.status)}</status>",
            ]
        )
        if document.latest_build_job.stage:
            lines.append(f"{indent}    <stage>{_xml_text(document.latest_build_job.stage)}</stage>")
        lines.append(
            f"{indent}    <progress_percent>{document.latest_build_job.progress_percent}</progress_percent>"
        )
        if document.latest_build_job.message:
            lines.append(f"{indent}    <message>{_xml_text(document.latest_build_job.message)}</message>")
        lines.append(f"{indent}  </latest_build_job>")
    lines.append(f"{indent}</document>")
    return lines


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
        "  <priority_rule>Prefer thread-attached knowledge documents in this order: explicit user @document references first, then AGENTS.md defaults.</priority_rule>",
    ]

    if explicit_resolution.matched:
        lines.extend(
            [
                "  <user_targets>",
                (
                    "    <rule>Treat these explicit targets as the first and authoritative "
                    "retrieval choice for this turn. Stay inside the attached knowledge "
                    "toolchain for them: get_document_tree for navigation, narrowed "
                    "get_document_tree for subtree refinement, then get_document_evidence "
                    "or get_document_image for grounded answers. Do not use generic "
                    "filesystem or shell tools to locate or inspect document copies unless "
                    "the user explicitly asks to debug KB parsing or indexing.</rule>"
                ),
            ]
        )
        for document in explicit_resolution.matched:
            lines.extend(_document_xml_lines(document, indent="    "))
        lines.append("  </user_targets>")

    if explicit_resolution.unresolved:
        lines.append("  <unresolved_user_targets>")
        for mention in explicit_resolution.unresolved:
            lines.append(f"    <reference>{_xml_text(mention)}</reference>")
        lines.append(
            "    <rule>Do not guess unresolved references. Use only the attached ready documents listed in &lt;knowledge_attached_documents&gt;.</rule>"
        )
        lines.append("  </unresolved_user_targets>")

    if agent_resolution.matched:
        lines.append("  <agent_default_targets>")
        for document in agent_resolution.matched:
            lines.extend(_document_xml_lines(document, indent="    "))
        lines.append("  </agent_default_targets>")

    lines.append("</knowledge_document_selection>")
    return "\n".join(lines)


def _build_knowledge_protocol_prompt(documents: list[KnowledgeDocumentRecord]) -> str:
    ready_documents = _ready_documents(documents)
    lines = [
        "<knowledge_tool_protocol>",
        "  <activation_rule>Apply this protocol only when the current turn needs attached-document retrieval. The thread's attached documents already define the retrieval scope, so an explicit @document reference is optional, not required. Otherwise ignore this block and continue the normal general-purpose workflow.</activation_rule>",
        "  <rule>When this protocol is active, use attached knowledge tools as the source of truth for attached documents.</rule>",
        "  <rule>When this protocol is active, refresh evidence in the current turn before answering a new knowledge-document question.</rule>",
        "  <rule>When this protocol is active, read document metadata directly from &lt;knowledge_attached_documents&gt; instead of calling a listing tool.</rule>",
        "  <rule>Preferred sequence when this protocol is active: choose one ready &lt;document_id&gt;, call get_document_tree(..., max_depth=2), call get_document_tree(..., node_id=...) when needed, then call get_document_evidence(..., node_ids=...).</rule>",
        "  <rule>When this protocol is active, prefer the injected ASCII &lt;document_id&gt; for every later document_name_or_id=... argument. Only fall back to the exact document name when an id is unavailable.</rule>",
        "  <rule>When this protocol is active, pick one concrete ready document_id before each tree or evidence call. Do not send placeholder, guessed, or empty document_name_or_id values.</rule>",
        "  <rule>When this protocol is active, stay with the knowledge tools first for attached-document answers.</rule>",
        "  <rule>When this protocol is active, treat get_document_tree as navigation only. Do not answer from tree summaries alone.</rule>",
        "  <rule>When this protocol is active and a response says answer_requires_evidence=true, call get_document_evidence(...) next.</rule>",
        "  <rule>When this protocol is active, every substantive paragraph or bullet grounded in knowledge evidence should include the exact current-turn citation_markdown when available.</rule>",
        "  <rule>When this protocol is active, retrieve visual evidence first. Prefer display_markdown when present; otherwise use image_markdown with the matching citation.</rule>",
        "  <rule>When this protocol is active and the tree is collapsed or spills to /large_tool_results/..., narrow by node_id or root_cursor instead of opening spill files or broadening the request again.</rule>",
        "  <rule>When this protocol is active and KB retrieval has started, do not switch to grep, glob, read_file, ls, find, execute, or similar generic file-inspection tools to answer from attached documents.</rule>",
        "  <rule>When this protocol is active, do not inspect /mnt/user-data/outputs/.knowledge or /large_tool_results/... directly. Refine with node_id or root_cursor, then call get_document_evidence(...).</rule>",
        # Keep KB behavior prompt-led so the agent stays general-purpose. These
        # rules live behind the activation_rule instead of an extra @mention
        # gate because thread attachment, not mention syntax, is the user-level
        # retrieval scope contract.
        "  <rule>When this protocol is active, do not inspect indexed knowledge artifacts in runtime outputs directly unless the user explicitly asks to debug parsing, indexing, source maps, extraction quality, or citation generation.</rule>",
    ]
    if not ready_documents:
        lines.append(
            "  <rule>No attached documents are ready for retrieval yet. Do not call get_document_tree or get_document_evidence until a document status becomes ready or ready_degraded.</rule>"
        )
    lines.append("</knowledge_tool_protocol>")
    return "\n".join(lines)


def _build_knowledge_binding_prompt(documents: list[KnowledgeDocumentRecord]) -> str:
    ready_documents = _ready_documents(documents)
    unavailable_documents = [document for document in documents if document.status not in READY_DOCUMENT_STATUSES]
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
            "  <summary>This thread has "
            f"{len(documents)} attached knowledge document(s), "
            f"{len(ready_documents)} ready for retrieval, across "
            f"{len(base_names)} knowledge base(s).</summary>"
        ),
    ]
    if base_names:
        lines.append("  <knowledge_bases>")
        for base_name in base_names:
            lines.append(f"    <knowledge_base>{_xml_text(base_name)}</knowledge_base>")
        lines.append("  </knowledge_bases>")
    lines.append("</knowledge_thread_bindings>")
    lines.append("<knowledge_attached_documents>")
    lines.append("  <usage_rule>Only use the attached ready documents listed in this XML block for knowledge retrieval.</usage_rule>")
    lines.append("  <usage_rule>Use the exact document_id value when calling get_document_tree or get_document_evidence.</usage_rule>")
    lines.append("  <ready_documents>")
    if ready_documents:
        for document in ready_documents:
            lines.extend(_document_xml_lines(document, indent="    "))
    else:
        lines.append("    <none>No attached documents are ready for retrieval in this turn.</none>")
    lines.append("  </ready_documents>")
    if unavailable_documents:
        lines.append("  <unavailable_documents>")
        for document in unavailable_documents:
            lines.extend(_document_xml_lines(document, indent="    "))
        lines.append("  </unavailable_documents>")
    lines.append("</knowledge_attached_documents>")
    return "\n".join(lines)


def build_knowledge_context_prompt(
    runtime_context: object,
    *,
    documents: list[KnowledgeDocumentRecord] | None = None,
) -> str:
    documents = documents if documents is not None else _thread_documents(runtime_context)
    if not documents:
        return ""

    selection_prompt = _build_document_selection_prompt(runtime_context, documents)
    protocol_prompt = _build_knowledge_protocol_prompt(documents)
    binding_prompt = _build_knowledge_binding_prompt(documents)
    lines = ["<knowledge_context>"]
    if selection_prompt:
        lines.append(selection_prompt)
    lines.extend([protocol_prompt, binding_prompt, "</knowledge_context>"])
    return "\n".join(lines)


class KnowledgeContextMiddleware(AgentMiddleware):
    @staticmethod
    def _override_request(request: ModelRequest[Any]) -> ModelRequest[Any]:
        documents = _thread_documents(request.runtime.context)
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
