from __future__ import annotations

from collections.abc import Awaitable, Callable
from html import escape
from typing import Any, override

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse

from src.knowledge import KnowledgeService
from src.knowledge.models import KnowledgeWorkspaceRecord
from src.knowledge.runtime import resolve_knowledge_runtime_identity
from src.knowledge.runtime_mount import knowledge_workspace_mount_path


def _thread_workspaces(runtime_context: object) -> list[KnowledgeWorkspaceRecord]:
    try:
        user_id, thread_id = resolve_knowledge_runtime_identity(runtime_context)
    except ValueError:
        return []

    # KB visibility is thread-scoped and persisted. The prompt exposes only the
    # agent-visible read-only mount paths, not storage refs or host paths.
    return KnowledgeService().get_thread_workspace_records(
        user_id=user_id,
        thread_id=thread_id,
    )


def _xml_text(value: object | None) -> str:
    # Knowledge document names and descriptions may contain XML-reserved
    # characters. Escape them so the injected prompt stays machine-readable.
    return escape(str(value or ""), quote=False)


def _workspace_xml_lines(
    workspace: KnowledgeWorkspaceRecord,
    *,
    indent: str = "    ",
) -> list[str]:
    lines = [
        f"{indent}<workspace>",
        f"{indent}  <workspace_id>{_xml_text(workspace.id)}</workspace_id>",
        f"{indent}  <name>{_xml_text(workspace.name)}</name>",
        f"{indent}  <mount_path>{_xml_text(knowledge_workspace_mount_path(workspace))}</mount_path>",
        f"{indent}  <owner_id>{_xml_text(workspace.owner_id)}</owner_id>",
    ]
    if workspace.description:
        lines.append(f"{indent}  <description>{_xml_text(workspace.description)}</description>")
    if workspace.source_type:
        lines.append(f"{indent}  <source_type>{_xml_text(workspace.source_type)}</source_type>")
    lines.append(f"{indent}  <document_count>{workspace.document_count}</document_count>")
    lines.append(f"{indent}  <ready_document_count>{workspace.ready_document_count}</ready_document_count>")
    lines.append(f"{indent}</workspace>")
    return lines


def _build_knowledge_binding_prompt(workspaces: list[KnowledgeWorkspaceRecord]) -> str:
    ready_workspaces = [workspace for workspace in workspaces if workspace.ready_document_count > 0]
    lines = [
        "<knowledge_context>",
        (
            "  <summary>This thread has "
            f"{len(workspaces)} attached knowledge workspace(s), "
            f"{len(ready_workspaces)} with ready documents.</summary>"
        ),
        (
            "  <usage>Attached knowledge is mounted as read-only files at each mount_path. "
            "Use only these mount_path values when this turn needs attached knowledge; otherwise ignore them.</usage>"
        ),
    ]
    if not ready_workspaces:
        lines.append(
            "  <usage>No attached knowledge workspace has ready documents yet.</usage>"
        )
    lines.append("<knowledge_attached_workspaces>")
    lines.append("  <workspaces>")
    if workspaces:
        for workspace in workspaces:
            lines.extend(_workspace_xml_lines(workspace, indent="    "))
    else:
        lines.append("    <none>No knowledge workspaces are attached in this turn.</none>")
    lines.append("  </workspaces>")
    lines.append("</knowledge_attached_workspaces>")
    lines.append("</knowledge_context>")
    return "\n".join(lines)


def build_knowledge_context_prompt(
    runtime_context: object,
    *,
    workspaces: list[KnowledgeWorkspaceRecord] | None = None,
) -> str:
    workspaces = workspaces if workspaces is not None else _thread_workspaces(runtime_context)
    if not workspaces:
        return ""

    return _build_knowledge_binding_prompt(workspaces)


class KnowledgeContextMiddleware(AgentMiddleware):
    @staticmethod
    def _override_request(request: ModelRequest[Any]) -> ModelRequest[Any]:
        workspaces = _thread_workspaces(request.runtime.context)
        updated_request = request

        knowledge_prompt = build_knowledge_context_prompt(
            request.runtime.context,
            workspaces=workspaces,
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
