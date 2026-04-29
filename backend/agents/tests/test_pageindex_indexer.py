from __future__ import annotations

import json
import zipfile
from textwrap import dedent

import pymupdf
from PIL import Image

from src.knowledge.formatters import format_document_evidence_payload
from src.knowledge.models import (
    DocumentEvidenceResult,
    DocumentImageResult,
    EvidenceBlock,
    EvidencePreviewTarget,
    KnowledgeDocumentRecord,
    KnowledgeNodeRecord,
    KnowledgeToolNextSteps,
    NodeDetailItem,
    NodeDetailResult,
)
from src.knowledge.pageindex import build_document_index
from src.knowledge.pageindex.canonical import build_canonical_document
from src.knowledge.pageindex.indexer import (
    _ParsedNode,
    _PdfPage,
    _should_use_markdown_page_tree,
    _split_large_page_leaf_nodes,
)
from src.knowledge.repository import (
    KnowledgeRepository,
    _limit_tree_depth,
    format_document_image_payload,
    format_node_detail_payload,
)


def test_build_document_index_markdown_persists_summaries_and_node_text(tmp_path):
    markdown_path = tmp_path / "guide.md"
    markdown_path.write_text(
        dedent(
            """
            # Model Compression

            This chapter introduces pruning, quantization, and distillation for efficient deployment.

            ## Quantization

            Quantization reduces model memory usage by storing weights with fewer bits.
            It discusses post-training quantization and quantization-aware training.

            ## Distillation

            Distillation transfers behavior from a teacher network to a smaller student network.
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )

    indexed = build_document_index(
        source_path=markdown_path,
        file_kind="markdown",
        display_name="guide.md",
        model_name=None,
    )

    nodes_by_title = {node.title: node for node in indexed.nodes}
    root = nodes_by_title["Model Compression"]
    quantization = nodes_by_title["Quantization"]

    assert root.summary is not None
    assert "Quantization" in root.summary
    assert root.node_text is not None
    assert root.node_text.startswith("# Model Compression")

    assert quantization.summary is not None
    assert "Quantization reduces model memory usage" in quantization.summary
    assert quantization.node_text is not None
    assert "post-training quantization" in quantization.node_text

    assert "node_text" not in indexed.structure[0]
    assert indexed.structure[0]["summary"] == root.summary
    assert "prefix_summary" not in indexed.structure[0]


def test_build_canonical_document_pdf_exports_image_placeholders(tmp_path):
    pdf_path = tmp_path / "image-doc.pdf"
    png_path = tmp_path / "pixel.png"
    Image.new("RGB", (8, 8), color=(255, 0, 0)).save(png_path)

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Image page")
    page.insert_image(pymupdf.Rect(72, 100, 144, 172), filename=str(png_path))
    doc.save(pdf_path)
    doc.close()

    canonical = build_canonical_document(
        source_path=pdf_path,
        file_kind="pdf",
        markdown_path=None,
        preview_path=None,
    )

    assert canonical.pages
    assert canonical.pages[0].image_paths
    assert "![img-p0001-01]" in canonical.markdown


def test_build_document_index_pdf_persists_image_placeholders_in_node_text(tmp_path):
    pdf_path = tmp_path / "image-doc.pdf"
    png_path = tmp_path / "pixel.png"
    Image.new("RGB", (8, 8), color=(0, 0, 255)).save(png_path)

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Image page")
    page.insert_image(pymupdf.Rect(72, 100, 144, 172), filename=str(png_path))
    doc.save(pdf_path)
    doc.close()

    indexed = build_document_index(
        source_path=pdf_path,
        file_kind="pdf",
        display_name="image-doc.pdf",
        model_name=None,
    )

    assert indexed.nodes
    assert any(node.node_text and "![img-p0001-01]" in node.node_text for node in indexed.nodes)


def test_build_document_index_pdf_recovers_leading_pages_before_outline(tmp_path):
    pdf_path = tmp_path / "outline-image-doc.pdf"
    png_path = tmp_path / "pixel.png"
    Image.new("RGB", (8, 8), color=(0, 200, 0)).save(png_path)

    doc = pymupdf.open()
    cover = doc.new_page()
    cover.insert_text((72, 72), "Annual Report Cover")
    cover.insert_image(pymupdf.Rect(72, 100, 180, 208), filename=str(png_path))

    intro = doc.new_page()
    intro.insert_text((72, 72), "Introductory material")

    section = doc.new_page()
    section.insert_text((72, 72), "Section 1 Overview")
    doc.set_toc([[1, "Section 1 Overview", 3]])
    doc.save(pdf_path)
    doc.close()

    indexed = build_document_index(
        source_path=pdf_path,
        file_kind="pdf",
        display_name="outline-image-doc.pdf",
        model_name=None,
    )

    recovered_nodes = [
        node
        for node in indexed.nodes
        if node.page_start == 1 and node.page_end == 2
    ]
    assert recovered_nodes
    assert any(
        ref.kind == "page_image" and ref.page_number == 1
        for node in recovered_nodes
        for ref in node.evidence_refs
    )
    assert any(
        node.node_text and "![img-p0001-01]" in node.node_text
        for node in recovered_nodes
    )


def test_split_large_page_leaf_nodes_creates_child_windows():
    pages = [
        _PdfPage(
            page_number=index,
            text=f"Page {index} text",
            normalized_text=f"page {index} text",
            markdown_text=f"# Heading {index}\n\nBody {index}",
        )
        for index in range(1, 16)
    ]
    root = _ParsedNode(
        title="Large Section",
        depth=0,
        line_start=None,
        line_end=None,
        text="",
        node_id="0001",
        page_start=1,
        page_end=15,
    )

    inserted = _split_large_page_leaf_nodes([root], pages)

    assert inserted == 3
    assert [(child.page_start, child.page_end) for child in root.children] == [
        (1, 5),
        (6, 10),
        (11, 15),
    ]
    assert all(child.parent_node_id == "0001" for child in root.children)


def test_split_large_page_leaf_nodes_falls_back_when_page_heading_is_numeric_noise():
    pages = [
        _PdfPage(
            page_number=index,
            text=f"Page {index} text",
            normalized_text=f"page {index} text",
            markdown_text="395,722 390,723 167,274 159,578\nhttps://example.com/report",
        )
        for index in range(1, 12)
    ]
    root = _ParsedNode(
        title="Large Section",
        depth=0,
        line_start=None,
        line_end=None,
        text="",
        node_id="0001",
        page_start=1,
        page_end=11,
    )

    inserted = _split_large_page_leaf_nodes([root], pages)

    assert inserted == 3
    assert [child.title for child in root.children] == [
        "Large Section (pp.1-5)",
        "Large Section (pp.6-10)",
        "Large Section (p.11)",
    ]


def test_split_large_page_leaf_nodes_falls_back_when_page_heading_is_sentence_text():
    pages = [
        _PdfPage(
            page_number=index,
            text=f"Page {index} text",
            normalized_text=f"page {index} text",
            markdown_text="an examiner's commission and beyond. the goal of these efforts is to ensure that examiners have",
        )
        for index in range(1, 12)
    ]
    root = _ParsedNode(
        title="Large Section",
        depth=0,
        line_start=None,
        line_end=None,
        text="",
        node_id="0001",
        page_start=1,
        page_end=11,
    )

    inserted = _split_large_page_leaf_nodes([root], pages)

    assert inserted == 3
    assert [child.title for child in root.children] == [
        "Large Section (pp.1-5)",
        "Large Section (pp.6-10)",
        "Large Section (p.11)",
    ]


def test_split_large_page_leaf_nodes_falls_back_when_page_heading_is_title_cased_sentence():
    pages = [
        _PdfPage(
            page_number=index,
            text=f"Page {index} text",
            normalized_text=f"page {index} text",
            markdown_text="The Federal Reserve's outreach included the annual Board-sponsored Fair Lending Interagency",
        )
        for index in range(1, 12)
    ]
    root = _ParsedNode(
        title="Large Section",
        depth=0,
        line_start=None,
        line_end=None,
        text="",
        node_id="0001",
        page_start=1,
        page_end=11,
    )

    inserted = _split_large_page_leaf_nodes([root], pages)

    assert inserted == 3
    assert [child.title for child in root.children] == [
        "Large Section (pp.1-5)",
        "Large Section (pp.6-10)",
        "Large Section (p.11)",
    ]


def test_format_node_detail_payload_uses_text_field():
    document = KnowledgeDocumentRecord(
        id="doc-1",
        knowledge_base_id="kb-1",
        knowledge_base_name="Research",
        knowledge_base_description=None,
        display_name="guide.md",
        file_kind="markdown",
        locator_type="heading",
        status="ready",
        doc_description="Compression methods for neural networks.",
        error=None,
        page_count=None,
        node_count=3,
        source_storage_path="knowledge/guide.md",
        markdown_storage_path="knowledge/guide.md",
        preview_storage_path=None,
    )
    item = NodeDetailItem(
        node_id="0002",
        parent_node_id="0001",
        title="Quantization",
        child_count=0,
        line_start=4,
        line_end=8,
        heading_slug="quantization",
        summary="Covers post-training quantization and quantization-aware training.",
        prefix_summary=None,
        citation_markdown="[citation:guide.md · Quantization](kb://citation?document_id=doc-1)",
        text="## Quantization\n\nQuantization reduces model memory usage.",
    )
    result = NodeDetailResult(
        document=document,
        requested_node_ids=["0002"],
        items=[item],
        total_pages=None,
        requested_pages=None,
        returned_pages=None,
        returned_lines="4-8",
        next_steps=KnowledgeToolNextSteps(
            summary="Successfully retrieved content for 1 nodes.",
            options=["Use get_document_tree(...) to inspect nearby branches."],
        ),
    )

    payload = json.loads(format_node_detail_payload(result))

    assert payload["items"][0]["text"].startswith("## Quantization")
    assert payload["items"][0]["page_chunks"] == []
    assert payload["items"][0]["citation_markdown"].startswith("[citation:guide.md")
    assert "summary" not in payload["items"][0]
    assert "line_start" not in payload["items"][0]
    assert "heading_slug" not in payload["items"][0]
    assert payload["next_steps"]["summary"].startswith("Successfully retrieved")


def test_limit_tree_depth_reports_hidden_children():
    structure = [
        {
            "node_id": "0001",
            "title": "Chapter 1",
            "nodes": [
                {
                    "node_id": "0002",
                    "title": "Section A",
                    "nodes": [
                        {"node_id": "0003", "title": "Leaf"},
                    ],
                }
            ],
        }
    ]

    limited = _limit_tree_depth(structure, depth=2)

    assert limited[0]["child_count"] == 1
    assert limited[0]["returned_child_count"] == 1
    assert limited[0]["has_more_children"] is False
    assert limited[0]["nodes"][0]["child_count"] == 1
    assert limited[0]["nodes"][0]["returned_child_count"] == 0
    assert limited[0]["nodes"][0]["remaining_child_count"] == 1
    assert limited[0]["nodes"][0]["has_more_children"] is True


def test_format_document_image_payload_reports_image_path():
    document = KnowledgeDocumentRecord(
        id="doc-1",
        knowledge_base_id="kb-1",
        knowledge_base_name="Research",
        knowledge_base_description=None,
        display_name="PRML.pdf",
        file_kind="pdf",
        locator_type="page",
        status="ready",
        doc_description="Pattern recognition textbook.",
        error=None,
        page_count=758,
        node_count=285,
        source_storage_path="knowledge/PRML.pdf",
        markdown_storage_path=None,
        preview_storage_path="knowledge/PRML.preview.pdf",
    )
    result = DocumentImageResult(
        document=document,
        page_number=176,
        image_path="/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0176.png",
        embedded_image_count=2,
        next_steps=KnowledgeToolNextSteps(
            summary="Exported a page image for PRML.pdf page 176.",
            options=["Use read_file(file_path=...) to inspect the page visually."],
        ),
    )

    payload = json.loads(format_document_image_payload(result))

    assert payload["page_number"] == 176
    assert payload["image_path"].endswith("page-0176.png")
    assert payload["embedded_image_count"] == 2


def test_format_document_evidence_payload_omits_duplicate_page_text():
    document = KnowledgeDocumentRecord(
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
    item = NodeDetailItem(
        node_id="0008",
        title="Monitoring Financial Vulnerabilities",
        page_start=22,
        page_end=26,
        summary="Summary",
        text="[Page 22]\\nRepeated text",
        evidence_blocks=[
            EvidenceBlock(
                evidence_id="0008-text-p0022",
                kind="text",
                locator_type="page",
                locator_label="annual-report.pdf p.22",
                page_number=22,
                text="Repeated text",
                citation_markdown="[citation:annual-report.pdf · p.22](kb://citation?document_id=doc-1&page=22)",
                preview_target=EvidencePreviewTarget(
                    artifact_path="/mnt/user-data/outputs/.knowledge/doc-1/annual-report.pdf",
                    page=22,
                    locator_label="annual-report.pdf p.22",
                ),
            )
        ],
    )
    result = DocumentEvidenceResult(
        document=document,
        requested_node_ids=["0008"],
        items=[item],
        total_pages=20,
        returned_pages="22-26",
        returned_lines=None,
        next_steps=KnowledgeToolNextSteps(
            summary="Successfully retrieved evidence for 1 nodes.",
            options=["Use returned evidence_blocks."],
        ),
    )

    payload = json.loads(format_document_evidence_payload(result))

    assert "text" not in payload["items"][0]
    assert payload["items"][0]["evidence_blocks"][0]["text"] == "Repeated text"
    assert "preview_target" not in payload["items"][0]["evidence_blocks"][0]


def test_format_document_evidence_payload_caps_inline_visual_blocks():
    document = KnowledgeDocumentRecord(
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
    item = NodeDetailItem(
        node_id="0008",
        title="Monitoring Financial Vulnerabilities",
        page_start=1,
        page_end=8,
        summary="Summary",
        evidence_blocks=[
            EvidenceBlock(
                evidence_id=f"0008-page-image-p{page_number:04d}",
                kind="page_image",
                locator_type="page",
                locator_label=f"annual-report.pdf p.{page_number}",
                page_number=page_number,
                image_path=f"/mnt/user-data/outputs/.knowledge/doc-1/pages/page-{page_number:04d}.png",
                image_markdown=f"![annual-report.pdf p.{page_number}](kb://asset?document_id=doc-1&page={page_number})",
                display_markdown=(
                    f"![annual-report.pdf p.{page_number}](kb://asset?document_id=doc-1&page={page_number})\n\n"
                    f"[citation:annual-report.pdf p.{page_number}](kb://citation?document_id=doc-1&page={page_number})"
                ),
                citation_markdown=f"[citation:annual-report.pdf p.{page_number}](kb://citation?document_id=doc-1&page={page_number})",
                preview_target=EvidencePreviewTarget(
                    artifact_path="/mnt/user-data/outputs/.knowledge/doc-1/annual-report.pdf",
                    page=page_number,
                    locator_label=f"annual-report.pdf p.{page_number}",
                ),
            )
            for page_number in range(1, 9)
        ],
    )
    result = DocumentEvidenceResult(
        document=document,
        requested_node_ids=["0008"],
        items=[item],
        total_pages=20,
        returned_pages="1-8",
        returned_lines=None,
        next_steps=KnowledgeToolNextSteps(
            summary="Successfully retrieved evidence for 1 nodes.",
            options=["Use returned evidence_blocks."],
        ),
    )

    payload = json.loads(format_document_evidence_payload(result))
    blocks = payload["items"][0]["evidence_blocks"]

    assert payload["inline_visual_block_count"] == 6
    assert payload["omitted_visual_block_count"] == 2
    assert len(blocks) == 6
    assert all("image_path" not in block for block in blocks)
    assert all("preview_target" not in block for block in blocks)
    assert all("display_markdown" in block for block in blocks)
    assert all("image_markdown" not in block for block in blocks)
    assert any("Inline visual evidence was capped" in option for option in payload["next_steps"]["options"])


def test_validate_node_detail_request_allows_small_page_root_with_children():
    repository = object.__new__(KnowledgeRepository)
    document = KnowledgeDocumentRecord(
        id="doc-1",
        knowledge_base_id="kb-1",
        knowledge_base_name="Research",
        knowledge_base_description=None,
        display_name="PRML.pdf",
        file_kind="pdf",
        locator_type="page",
        status="ready",
        doc_description="Pattern recognition textbook.",
        error=None,
        page_count=758,
        node_count=319,
        source_storage_path="knowledge/PRML.pdf",
        markdown_storage_path=None,
        preview_storage_path="knowledge/PRML.preview.pdf",
    )
    node = KnowledgeNodeRecord(
        document_id="doc-1",
        node_id="0005",
        node_path="0005",
        title="1. Introduction",
        depth=0,
        child_count=7,
        locator_type="page",
        page_start=21,
        page_end=23,
        evidence_refs=[],
    )

    repository._validate_node_detail_request(  # noqa: SLF001
        document=document,
        nodes=[node],
    )


def test_should_skip_generated_page_markdown_without_real_companion():
    assert (
        _should_use_markdown_page_tree(
            canonical_markdown="<!-- OA_PAGE 1 -->\n## Page 1\n\ncontent\n",
            companion_markdown_path=None,
        )
        is False
    )


def test_should_use_real_markdown_companion_for_page_tree(tmp_path):
    companion = tmp_path / "document.md"
    companion.write_text("# Chapter 1\n\n## Section A\n", encoding="utf-8")

    assert (
        _should_use_markdown_page_tree(
            canonical_markdown=companion.read_text(encoding="utf-8"),
            companion_markdown_path=companion,
        )
        is True
    )


def test_build_canonical_document_docx_fallback_extracts_markdown(tmp_path):
    docx_path = tmp_path / "guide.docx"
    with zipfile.ZipFile(docx_path, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            dedent(
                """
                <?xml version="1.0" encoding="UTF-8"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
                </Types>
                """
            ).strip(),
        )
        archive.writestr(
            "_rels/.rels",
            dedent(
                """
                <?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
                </Relationships>
                """
            ).strip(),
        )
        archive.writestr(
            "word/document.xml",
            dedent(
                """
                <?xml version="1.0" encoding="UTF-8"?>
                <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                  <w:body>
                    <w:p>
                      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
                      <w:r><w:t>Overview</w:t></w:r>
                    </w:p>
                    <w:p>
                      <w:r><w:t>This DOCX fallback should preserve paragraph text.</w:t></w:r>
                    </w:p>
                  </w:body>
                </w:document>
                """
            ).strip(),
        )

    canonical = build_canonical_document(
        source_path=docx_path,
        file_kind="docx",
        markdown_path=None,
        preview_path=None,
    )

    assert canonical.markdown.startswith("# Overview")
    assert "This DOCX fallback should preserve paragraph text." in canonical.markdown


def test_build_document_index_markdown_without_headings_creates_synthetic_root(tmp_path):
    markdown_path = tmp_path / "plain.md"
    markdown_path.write_text(
        "This file has no markdown headings.\n\nIt should still create one root node.\n",
        encoding="utf-8",
    )

    indexed = build_document_index(
        source_path=markdown_path,
        file_kind="markdown",
        display_name="plain.md",
        model_name=None,
    )

    assert len(indexed.nodes) == 1
    assert indexed.nodes[0].title == "This file has no markdown headings."
    assert indexed.nodes[0].node_text is not None
    assert "It should still create one root node." in indexed.nodes[0].node_text
