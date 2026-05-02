from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from src.knowledge.formatters import (
    format_document_evidence_payload,
    format_document_image_payload,
    format_node_detail_payload,
    format_tree_listing_payload,
)
from src.knowledge.models import KnowledgeDocumentRecord

if TYPE_CHECKING:
    from src.knowledge.repository import KnowledgeRepository


TREE_WINDOW_MAX_DEPTH = 2


class KnowledgeService:
    def __init__(self, repository: KnowledgeRepository | None = None) -> None:
        self._repository = repository

    def _repository_instance(self) -> KnowledgeRepository:
        if self._repository is None:
            from src.knowledge.repository import KnowledgeRepository

            self._repository = KnowledgeRepository()
        return self._repository

    def get_thread_document_records(
        self,
        *,
        user_id: str,
        thread_id: str,
        ready_only: bool = False,
    ) -> list[KnowledgeDocumentRecord]:
        # Chat knowledge visibility is sourced only from persisted thread
        # bindings. There is no second per-turn "selected document ids" path.
        return self._repository_instance().list_thread_documents(
            user_id=user_id,
            thread_id=thread_id,
            ready_only=ready_only,
        )

    def _resolve_thread_document(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
    ) -> tuple[KnowledgeDocumentRecord | None, str | None]:
        document = _match_document_record(
            self.get_thread_document_records(
                user_id=user_id,
                thread_id=thread_id,
                ready_only=True,
            ),
            document_name_or_id,
        )
        if document is not None:
            return document, None
        return (
            None,
            (
                "Error: knowledge document not found or not ready: "
                f"{document_name_or_id}. Use a document_id or exact document name from "
                "<knowledge_attached_documents> first."
            ),
        )

    def get_document_tree(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
        node_id: str | None,
        max_depth: int,
        root_cursor: int = 0,
    ) -> str:
        document, error = self._resolve_thread_document(
            user_id=user_id,
            thread_id=thread_id,
            document_name_or_id=document_name_or_id,
        )
        if error is not None:
            return error
        effective_max_depth = max(1, min(max_depth, TREE_WINDOW_MAX_DEPTH))
        listing = self._repository_instance().get_document_tree(
            document=document,
            node_id=node_id,
            max_depth=effective_max_depth,
            root_cursor=max(int(root_cursor or 0), 0),
        )
        return format_tree_listing_payload(listing)

    def get_document_tree_node_detail(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
        node_ids: str,
    ) -> str:
        document, error = self._resolve_thread_document(
            user_id=user_id,
            thread_id=thread_id,
            document_name_or_id=document_name_or_id,
        )
        if error is not None:
            return error
        requested_node_ids = _parse_node_ids(node_ids)
        if not requested_node_ids:
            return "Error: at least one node_id is required."
        nodes = self._repository_instance().get_node_details(
            document=document,
            node_ids=requested_node_ids,
        )
        found_ids = {node.node_id for node in nodes}
        missing_ids = [node_id for node_id in requested_node_ids if node_id not in found_ids]
        if missing_ids:
            return f"Error: node_id(s) {', '.join(missing_ids)} were not found in document '{document.display_name}'."
        try:
            result = self._repository_instance().build_node_detail_result(
                user_id=user_id,
                thread_id=thread_id,
                document=document,
                nodes=nodes,
                requested_node_ids=requested_node_ids,
            )
        except ValueError as exc:
            return f"Error: {exc}"
        return format_node_detail_payload(result)

    def get_document_evidence(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
        node_ids: str,
    ) -> str:
        document, error = self._resolve_thread_document(
            user_id=user_id,
            thread_id=thread_id,
            document_name_or_id=document_name_or_id,
        )
        if error is not None:
            return error
        requested_node_ids = _parse_node_ids(node_ids)
        if not requested_node_ids:
            return "Error: at least one node_id is required."
        nodes = self._repository_instance().get_node_details(
            document=document,
            node_ids=requested_node_ids,
        )
        found_ids = {node.node_id for node in nodes}
        missing_ids = [node_id for node_id in requested_node_ids if node_id not in found_ids]
        if missing_ids:
            return f"Error: node_id(s) {', '.join(missing_ids)} were not found in document '{document.display_name}'."
        try:
            result = self._repository_instance().build_document_evidence_result(
                user_id=user_id,
                thread_id=thread_id,
                document=document,
                nodes=nodes,
                requested_node_ids=requested_node_ids,
            )
        except ValueError as exc:
            return f"Error: {exc}"
        return format_document_evidence_payload(result)

    def get_document_image(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
        page_number: int,
    ) -> str:
        document, error = self._resolve_thread_document(
            user_id=user_id,
            thread_id=thread_id,
            document_name_or_id=document_name_or_id,
        )
        if error is not None:
            return error
        try:
            result = self._repository_instance().build_document_image_result(
                user_id=user_id,
                thread_id=thread_id,
                document=document,
                page_number=page_number,
            )
        except ValueError as exc:
            return f"Error: {exc}"
        return format_document_image_payload(result)


def _parse_node_ids(raw_value: str) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    raw_parts = str(raw_value or "").replace("\n", ",").replace("，", ",").replace("、", ",").split(",")
    for part in raw_parts:
        node_id = part.strip()
        if not node_id or node_id in seen:
            continue
        seen.add(node_id)
        normalized.append(node_id)
    return normalized


def _match_document_record(
    documents: Sequence[KnowledgeDocumentRecord],
    document_name_or_id: str,
) -> KnowledgeDocumentRecord | None:
    candidate = str(document_name_or_id or "").strip()
    if not candidate:
        return None

    candidate_lower = candidate.casefold()
    candidate_stem = candidate_lower.rsplit(".", 1)[0] if "." in candidate_lower else candidate_lower
    for document in documents:
        display_name = str(document.display_name or "").strip()
        display_name_lower = display_name.casefold()
        display_name_stem = display_name_lower.rsplit(".", 1)[0] if "." in display_name_lower else display_name_lower
        if candidate == document.id:
            return document
        if candidate_lower == display_name_lower:
            return document
        if candidate_stem and candidate_stem == display_name_stem:
            return document
    return None
