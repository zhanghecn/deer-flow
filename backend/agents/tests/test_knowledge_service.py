import json

from src.knowledge.models import DocumentTreeListing, KnowledgeDocumentRecord
from src.knowledge.service import TREE_WINDOW_MAX_DEPTH, KnowledgeService, _parse_node_ids


def _document() -> KnowledgeDocumentRecord:
    return KnowledgeDocumentRecord(
        id="doc-1",
        knowledge_base_id="kb-1",
        knowledge_base_name="Finance",
        knowledge_base_description=None,
        display_name="annual-report.pdf",
        file_kind="pdf",
        locator_type="page",
        status="ready",
        doc_description="annual report description",
        error=None,
        page_count=20,
        node_count=8,
        source_storage_path="knowledge/source.pdf",
        markdown_storage_path=None,
        preview_storage_path="knowledge/preview.pdf",
    )


class _FakeRepository:
    def __init__(self) -> None:
        self.requested_max_depth: int | None = None

    def list_thread_documents(
        self,
        *,
        user_id: str,
        thread_id: str,
        ready_only: bool = False,
    ) -> list[KnowledgeDocumentRecord]:
        assert user_id == "user-1"
        assert thread_id == "thread-1"
        return [_document()]

    def list_documents_by_ids(
        self,
        *,
        user_id: str,
        document_ids: list[str],
        ready_only: bool = False,
    ) -> list[KnowledgeDocumentRecord]:
        assert user_id == "user-1"
        if document_ids == ["doc-selected"]:
            return [
                KnowledgeDocumentRecord(
                    id="doc-selected",
                    knowledge_base_id="kb-selected",
                    knowledge_base_name="Selected",
                    knowledge_base_description=None,
                    display_name="selected-notes.md",
                    file_kind="markdown",
                    locator_type="heading",
                    status="ready",
                    doc_description="selected document description",
                    error=None,
                    page_count=None,
                    node_count=4,
                    source_storage_path="knowledge/selected.md",
                    markdown_storage_path="knowledge/selected.md",
                    preview_storage_path=None,
                )
            ]
        return []

    def resolve_thread_document(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
    ) -> KnowledgeDocumentRecord | None:
        assert user_id == "user-1"
        assert thread_id == "thread-1"
        assert document_name_or_id == "annual-report.pdf"
        return _document()

    def get_document_tree(
        self,
        *,
        document: KnowledgeDocumentRecord,
        node_id: str | None,
        max_depth: int,
        root_cursor: int = 0,
    ) -> DocumentTreeListing:
        self.requested_max_depth = max_depth
        assert node_id is None
        assert root_cursor == 0
        return DocumentTreeListing(
            document=document,
            node_id=node_id,
            requested_max_depth=max_depth,
            effective_max_depth=max_depth,
            tree=[
                {
                    "node_id": "0001",
                    "title": "Revenue",
                    "page_start": 1,
                    "page_end": 5,
                    "locator_type": "page",
                    "prefix_summary": "Revenue overview and key drivers.",
                    "child_count": 2,
                    "returned_child_count": 1,
                    "remaining_child_count": 1,
                    "has_more_children": True,
                    "nodes": [
                        {
                            "node_id": "0002",
                            "title": "APAC",
                            "page_start": 2,
                            "page_end": 3,
                            "locator_type": "page",
                            "summary": "APAC growth and margin changes.",
                            "child_count": 0,
                            "returned_child_count": 0,
                            "remaining_child_count": 0,
                            "has_more_children": False,
                        }
                    ],
                }
            ],
        )


def test_parse_node_ids_supports_multilingual_separators_and_dedupes():
    assert _parse_node_ids("0001, 0002\n0002，0003、0004") == [
        "0001",
        "0002",
        "0003",
        "0004",
    ]


def test_get_document_tree_clamps_depth_and_normalizes_prefix_summary():
    repository = _FakeRepository()
    payload = KnowledgeService(repository=repository).get_document_tree(
        user_id="user-1",
        thread_id="thread-1",
        document_name_or_id="annual-report.pdf",
        node_id=None,
        max_depth=6,
    )

    data = json.loads(payload)

    assert repository.requested_max_depth == TREE_WINDOW_MAX_DEPTH
    assert data["document"]["max_depth"] == TREE_WINDOW_MAX_DEPTH
    assert data["document"]["requested_max_depth"] == TREE_WINDOW_MAX_DEPTH
    assert data["document"]["collapsed_root_overview"] is False
    assert data["answer_requires_evidence"] is True
    assert data["recommended_evidence_node_ids"] == ["0001"]
    assert data["tree"][0]["summary"] == "Revenue overview and key drivers."
    assert "prefix_summary" not in json.dumps(data, ensure_ascii=False)


def test_list_thread_documents_includes_selected_documents_for_new_thread_context():
    repository = _FakeRepository()

    payload = KnowledgeService(repository=repository).list_thread_documents(
        user_id="user-1",
        thread_id="thread-1",
        selected_document_ids=["doc-selected"],
    )

    data = json.loads(payload)

    available_names = [item["document_name"] for item in data["available_documents"]]
    assert available_names == ["annual-report.pdf", "selected-notes.md"]


def test_get_document_tree_can_resolve_selected_document_without_thread_binding():
    repository = _FakeRepository()

    payload = KnowledgeService(repository=repository).get_document_tree(
        user_id="user-1",
        thread_id="thread-1",
        document_name_or_id="selected-notes.md",
        node_id=None,
        max_depth=2,
        selected_document_ids=["doc-selected"],
    )

    data = json.loads(payload)

    assert data["document"]["name"] == "selected-notes.md"


class _LargeHeadingRepository(_FakeRepository):
    def list_thread_documents(
        self,
        *,
        user_id: str,
        thread_id: str,
        ready_only: bool = False,
    ) -> list[KnowledgeDocumentRecord]:
        return [
            KnowledgeDocumentRecord(
                id="doc-heading",
                knowledge_base_id="kb-1",
                knowledge_base_name="Notes",
                knowledge_base_description=None,
                display_name="notes.md",
                file_kind="markdown",
                locator_type="heading",
                status="ready",
                doc_description="notes description",
                error=None,
                page_count=None,
                node_count=320,
                source_storage_path="knowledge/notes.md",
                markdown_storage_path="knowledge/notes.md",
                preview_storage_path=None,
            )
        ]

    def get_document_tree(
        self,
        *,
        document: KnowledgeDocumentRecord,
        node_id: str | None,
        max_depth: int,
        root_cursor: int = 0,
    ) -> DocumentTreeListing:
        self.requested_max_depth = max_depth
        tree = []
        for index in range(270):
            tree.append(
                {
                    "node_id": f"{index + 1:04d}",
                    "title": f"Section {index + 1}",
                    "line_start": index * 10 + 1,
                    "line_end": index * 10 + 10,
                    "heading_slug": f"section-{index + 1}",
                    "locator_type": "heading",
                    "summary": (
                        f"Section {index + 1} "
                        + "detail " * 150
                    ).strip(),
                    "child_count": 0,
                    "returned_child_count": 0,
                    "remaining_child_count": 0,
                    "has_more_children": False,
                }
            )
        return DocumentTreeListing(
            document=document,
            node_id=node_id,
            requested_max_depth=max_depth,
            effective_max_depth=max_depth,
            tree=tree,
        )


def test_get_document_tree_compacts_large_heading_windows():
    repository = _LargeHeadingRepository()
    payload = KnowledgeService(repository=repository).get_document_tree(
        user_id="user-1",
        thread_id="thread-1",
        document_name_or_id="notes.md",
        node_id=None,
        max_depth=2,
    )

    data = json.loads(payload)

    assert repository.requested_max_depth == 2
    assert len(payload) < 70_000
    assert data["document"]["returned_node_count"] == 270
    assert "line_start" not in data["tree"][0]
    assert "heading_slug" not in data["tree"][0]
    assert "returned_child_count" not in payload
    assert len(data["tree"][0]["summary"]) <= 72


def test_get_document_tree_reports_paginated_root_overview_window():
    repository = _FakeRepository()

    def get_document_tree_with_paginated_overview(
        *,
        document: KnowledgeDocumentRecord,
        node_id: str | None,
        max_depth: int,
        root_cursor: int = 0,
    ) -> DocumentTreeListing:
        repository.requested_max_depth = max_depth
        assert root_cursor == 24
        return DocumentTreeListing(
            document=document,
            node_id=node_id,
            requested_max_depth=max_depth,
            effective_max_depth=1,
            window_mode="root_overview",
            root_cursor=24,
            total_root_nodes=270,
            previous_root_cursor=0,
            next_root_cursor=48,
            tree=[
                {
                    "node_id": "0025",
                    "title": "Chapter 25",
                    "page_start": 91,
                    "page_end": 94,
                    "locator_type": "page",
                    "summary": "Window item 25.",
                    "child_count": 0,
                    "returned_child_count": 0,
                    "remaining_child_count": 0,
                    "has_more_children": False,
                }
            ],
        )

    repository.get_document_tree = get_document_tree_with_paginated_overview  # type: ignore[method-assign]
    payload = KnowledgeService(repository=repository).get_document_tree(
        user_id="user-1",
        thread_id="thread-1",
        document_name_or_id="annual-report.pdf",
        node_id=None,
        max_depth=2,
        root_cursor=24,
    )

    data = json.loads(payload)

    assert data["document"]["collapsed_root_overview"] is True
    assert data["document"]["root_cursor"] == 24
    assert data["document"]["total_root_nodes"] == 270
    assert data["document"]["returned_root_start"] == 25
    assert data["document"]["returned_root_end"] == 25
    assert data["document"]["previous_root_cursor"] == 0
    assert data["document"]["next_root_cursor"] == 48
    assert data["document"]["has_more_root_nodes"] is True
    assert "root_cursor=48" in " ".join(data["next_steps"]["options"])


def test_get_document_tree_reports_collapsed_root_overview_when_requested():
    repository = _FakeRepository()

    def get_document_tree_with_overview(
        *,
        document: KnowledgeDocumentRecord,
        node_id: str | None,
        max_depth: int,
        root_cursor: int = 0,
    ) -> DocumentTreeListing:
        repository.requested_max_depth = max_depth
        assert root_cursor == 0
        return DocumentTreeListing(
            document=document,
            node_id=node_id,
            requested_max_depth=max_depth,
            effective_max_depth=1,
            window_mode="root_overview",
            tree=[
                {
                    "node_id": "0001",
                    "title": "Chapter 1",
                    "page_start": 1,
                    "page_end": 40,
                    "locator_type": "page",
                    "summary": "Overview summary.",
                    "child_count": 6,
                    "returned_child_count": 0,
                    "remaining_child_count": 6,
                    "has_more_children": True,
                }
            ],
        )

    repository.get_document_tree = get_document_tree_with_overview  # type: ignore[method-assign]
    payload = KnowledgeService(repository=repository).get_document_tree(
        user_id="user-1",
        thread_id="thread-1",
        document_name_or_id="annual-report.pdf",
        node_id=None,
        max_depth=2,
    )

    data = json.loads(payload)

    assert data["document"]["max_depth"] == 1
    assert data["document"]["requested_max_depth"] == 2
    assert data["document"]["collapsed_root_overview"] is True
    assert data["document"]["window_mode"] == "root_overview"
    assert data["answer_requires_evidence"] is True
    assert data["recommended_evidence_node_ids"] == ["0001"]
    assert "DO NOT answer from this tree result alone" in data["next_steps"]["options"][0]
    assert "top-level overview" in data["next_steps"]["options"][1]
