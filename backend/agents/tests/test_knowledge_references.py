from src.knowledge.models import KnowledgeDocumentRecord
from src.knowledge.references import (
    extract_knowledge_document_mentions,
    resolve_knowledge_document_mentions,
)


def _document(name: str, *, document_id: str, status: str = "ready") -> KnowledgeDocumentRecord:
    return KnowledgeDocumentRecord(
        id=document_id,
        knowledge_base_id="kb-1",
        knowledge_base_name="Finance",
        knowledge_base_description=None,
        display_name=name,
        file_kind="pdf",
        locator_type="page",
        status=status,
        doc_description=f"description for {name}",
        error=None,
        page_count=20,
        node_count=8,
        source_storage_path="knowledge/source.pdf",
        markdown_storage_path=None,
        preview_storage_path="knowledge/preview.pdf",
    )


def test_extract_knowledge_document_mentions_supports_multiple_reference_forms():
    mentions = extract_knowledge_document_mentions(
        '请先看 @annual-report.pdf，然后对比 @knowledge[Board Deck Q4.md] 和 @"Roadmap 2026.md"'
    )

    assert mentions == (
        "annual-report.pdf",
        "Board Deck Q4.md",
        "Roadmap 2026.md",
    )


def test_extract_knowledge_document_mentions_ignores_emails():
    mentions = extract_knowledge_document_mentions("请联系 foo@example.com 获取附件")

    assert mentions == ()


def test_resolve_knowledge_document_mentions_matches_stem_and_exact_name():
    result = resolve_knowledge_document_mentions(
        documents=[
            _document("Annual Report 2023.pdf", document_id="doc-1"),
            _document("Board Deck Q4.md", document_id="doc-2"),
        ],
        mentions=("annual report 2023", "Board Deck Q4.md"),
    )

    assert [document.id for document in result.matched] == ["doc-1", "doc-2"]
    assert result.unresolved == ()


def test_resolve_knowledge_document_mentions_rejects_ambiguous_partial_matches():
    result = resolve_knowledge_document_mentions(
        documents=[
            _document("Roadmap 2026 Product.pdf", document_id="doc-1"),
            _document("Roadmap 2026 Hiring.pdf", document_id="doc-2"),
        ],
        mentions=("Roadmap 2026",),
    )

    assert result.matched == ()
    assert result.unresolved == ("Roadmap 2026",)
