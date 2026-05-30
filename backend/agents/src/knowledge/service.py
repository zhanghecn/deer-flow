from __future__ import annotations

from typing import TYPE_CHECKING

from src.knowledge.models import KnowledgeWorkspaceRecord

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
        # Agent-facing knowledge retrieval now uses the read-only filesystem
        # mount. This service only exposes thread workspace metadata needed to
        # build that mount and the concise prompt context.
        return self._repository_instance().list_thread_workspaces(
            user_id=user_id,
            thread_id=thread_id,
            ready_only=ready_only,
        )
