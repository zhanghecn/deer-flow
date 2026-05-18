from __future__ import annotations

import json
from collections.abc import Sequence
from typing import TYPE_CHECKING

from src.knowledge.models import KnowledgeWorkspaceRecord
from src.knowledge.wiki_workspace import (
    KnowledgeWorkspaceStore,
    build_knowledge_graph_payload,
    build_workspace_file_tree,
    get_source_evidence_payload,
    get_wiki_page_payload,
    search_workspaces,
)

if TYPE_CHECKING:
    from src.knowledge.repository import KnowledgeRepository


class KnowledgeService:
    def __init__(self, repository: KnowledgeRepository | None = None) -> None:
        self._repository = repository

    def _repository_instance(self) -> KnowledgeRepository:
        if self._repository is None:
            from src.knowledge.repository import KnowledgeRepository

            self._repository = KnowledgeRepository()
        return self._repository

    def get_thread_workspace_records(
        self,
        *,
        user_id: str,
        thread_id: str,
        ready_only: bool = False,
    ) -> list[KnowledgeWorkspaceRecord]:
        return self._repository_instance().list_thread_workspaces(
            user_id=user_id,
            thread_id=thread_id,
            ready_only=ready_only,
        )

    def _resolve_thread_workspaces(
        self,
        *,
        user_id: str,
        thread_id: str,
        workspace_name_or_id: str | None = None,
        ready_only: bool = True,
    ) -> tuple[list[KnowledgeWorkspaceRecord], str | None]:
        workspaces = self.get_thread_workspace_records(
            user_id=user_id,
            thread_id=thread_id,
            ready_only=ready_only,
        )
        candidate = str(workspace_name_or_id or "").strip()
        if not candidate:
            if workspaces:
                return workspaces, None
            return [], "Error: no attached knowledge workspaces are ready for retrieval."
        matched = _match_workspace_records(workspaces, candidate)
        if matched:
            return [matched], None
        return (
            [],
            (
                "Error: knowledge workspace not found or not ready: "
                f"{candidate}. Use a workspace_id or exact workspace name from "
                "<knowledge_attached_workspaces> first."
            ),
        )

    def search_knowledge_workspace(
        self,
        *,
        user_id: str,
        thread_id: str,
        query: str,
        workspace_name_or_id: str | None = None,
        limit: int = 10,
    ) -> str:
        workspaces, error = self._resolve_thread_workspaces(
            user_id=user_id,
            thread_id=thread_id,
            workspace_name_or_id=workspace_name_or_id,
        )
        if error is not None:
            return error
        payload = search_workspaces(
            store=KnowledgeWorkspaceStore(),
            workspaces=workspaces,
            query=query,
            limit=limit,
        )
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    def get_workspace_file_tree(
        self,
        *,
        user_id: str,
        thread_id: str,
        workspace_name_or_id: str | None = None,
    ) -> str:
        workspaces, error = self._resolve_thread_workspaces(
            user_id=user_id,
            thread_id=thread_id,
            workspace_name_or_id=workspace_name_or_id,
            ready_only=False,
        )
        if error is not None:
            return error
        payload = build_workspace_file_tree(
            store=KnowledgeWorkspaceStore(),
            workspaces=workspaces,
        )
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    def get_wiki_page(
        self,
        *,
        user_id: str,
        thread_id: str,
        workspace_name_or_id: str,
        page_path: str,
    ) -> str:
        workspaces, error = self._resolve_thread_workspaces(
            user_id=user_id,
            thread_id=thread_id,
            workspace_name_or_id=workspace_name_or_id,
            ready_only=False,
        )
        if error is not None:
            return error
        try:
            payload = get_wiki_page_payload(
                store=KnowledgeWorkspaceStore(),
                workspace=workspaces[0],
                page_path=page_path,
            )
        except (FileNotFoundError, ValueError) as exc:
            return f"Error: {exc}"
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    def get_source_evidence(
        self,
        *,
        user_id: str,
        thread_id: str,
        workspace_name_or_id: str,
        query: str,
        source_path_or_name: str | None = None,
        max_snippets: int = 5,
        line_start: int | None = None,
        line_limit: int = 80,
    ) -> str:
        workspaces, error = self._resolve_thread_workspaces(
            user_id=user_id,
            thread_id=thread_id,
            workspace_name_or_id=workspace_name_or_id,
            ready_only=False,
        )
        if error is not None:
            return error
        try:
            payload = get_source_evidence_payload(
                store=KnowledgeWorkspaceStore(),
                workspace=workspaces[0],
                query=query,
                source_path_or_name=source_path_or_name,
                max_snippets=max_snippets,
                line_start=line_start,
                line_limit=line_limit,
            )
        except ValueError as exc:
            return f"Error: {exc}"
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    def get_knowledge_graph(
        self,
        *,
        user_id: str,
        thread_id: str,
        workspace_name_or_id: str | None = None,
    ) -> str:
        workspaces, error = self._resolve_thread_workspaces(
            user_id=user_id,
            thread_id=thread_id,
            workspace_name_or_id=workspace_name_or_id,
            ready_only=False,
        )
        if error is not None:
            return error
        payload = build_knowledge_graph_payload(
            store=KnowledgeWorkspaceStore(),
            workspaces=workspaces,
        )
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _match_workspace_records(
    workspaces: Sequence[KnowledgeWorkspaceRecord],
    workspace_name_or_id: str,
) -> KnowledgeWorkspaceRecord | None:
    candidate = str(workspace_name_or_id or "").strip()
    if not candidate:
        return None
    candidate_lower = candidate.casefold()
    for workspace in workspaces:
        if candidate == workspace.id:
            return workspace
        if candidate_lower == str(workspace.name or "").casefold():
            return workspace
    return None
