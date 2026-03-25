from __future__ import annotations

from src.knowledge.models import KnowledgeDocumentRecord
from src.knowledge.repository import (
    KnowledgeRepository,
    format_document_image_payload,
    format_documents_payload,
    format_node_detail_payload,
    format_tree_listing_payload,
)


class KnowledgeService:
    def __init__(self, repository: KnowledgeRepository | None = None) -> None:
        self._repository = repository or KnowledgeRepository()

    def get_thread_document_records(
        self,
        *,
        user_id: str,
        thread_id: str,
        ready_only: bool = False,
    ) -> list[KnowledgeDocumentRecord]:
        return self._repository.list_thread_documents(
            user_id=user_id,
            thread_id=thread_id,
            ready_only=ready_only,
        )

    def list_thread_documents(self, *, user_id: str, thread_id: str) -> str:
        documents = self.get_thread_document_records(
            user_id=user_id,
            thread_id=thread_id,
        )
        return format_documents_payload(documents)

    def get_document_tree(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
        node_id: str | None,
        max_depth: int,
    ) -> str:
        document = self._repository.resolve_thread_document(
            user_id=user_id,
            thread_id=thread_id,
            document_name_or_id=document_name_or_id,
        )
        if document is None:
            return (
                f"Error: knowledge document not found or not ready: {document_name_or_id}. "
                "Use list_knowledge_documents first."
            )
        listing = self._repository.get_document_tree(
            document=document,
            node_id=node_id,
            max_depth=max_depth,
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
        document = self._repository.resolve_thread_document(
            user_id=user_id,
            thread_id=thread_id,
            document_name_or_id=document_name_or_id,
        )
        if document is None:
            return (
                f"Error: knowledge document not found or not ready: {document_name_or_id}. "
                "Use list_knowledge_documents first."
            )
        requested_node_ids = _parse_node_ids(node_ids)
        if not requested_node_ids:
            return "Error: at least one node_id is required."
        nodes = self._repository.get_node_details(document=document, node_ids=requested_node_ids)
        found_ids = {node.node_id for node in nodes}
        missing_ids = [node_id for node_id in requested_node_ids if node_id not in found_ids]
        if missing_ids:
            return (
                f"Error: node_id(s) {', '.join(missing_ids)} were not found in "
                f"document '{document.display_name}'."
            )
        try:
            result = self._repository.build_node_detail_result(
                thread_id=thread_id,
                document=document,
                nodes=nodes,
                requested_node_ids=requested_node_ids,
            )
        except ValueError as exc:
            return f"Error: {exc}"
        return format_node_detail_payload(result)

    def get_document_image(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
        page_number: int,
    ) -> str:
        document = self._repository.resolve_thread_document(
            user_id=user_id,
            thread_id=thread_id,
            document_name_or_id=document_name_or_id,
        )
        if document is None:
            return (
                f"Error: knowledge document not found or not ready: {document_name_or_id}. "
                "Use list_knowledge_documents first."
            )
        try:
            result = self._repository.build_document_image_result(
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
    for part in str(raw_value or "").replace("\n", ",").split(","):
        node_id = part.strip()
        if not node_id or node_id in seen:
            continue
        seen.add(node_id)
        normalized.append(node_id)
    return normalized
