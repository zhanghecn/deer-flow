from __future__ import annotations

import json
import zipfile
from textwrap import dedent

import pymupdf
from PIL import Image

from src.knowledge.models import (
    DocumentImageResult,
    KnowledgeToolNextSteps,
    KnowledgeDocumentRecord,
    NodeDetailItem,
    NodeDetailResult,
)
from src.knowledge.pageindex.canonical import build_canonical_document
from src.knowledge.pageindex.indexer import _should_use_markdown_page_tree
from src.knowledge.pageindex import build_document_index
from src.knowledge.repository import (
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

    assert root.prefix_summary is not None
    assert "Quantization" in root.prefix_summary
    assert root.node_text is not None
    assert root.node_text.startswith("# Model Compression")

    assert quantization.summary is not None
    assert "Quantization reduces model memory usage" in quantization.summary
    assert quantization.node_text is not None
    assert "post-training quantization" in quantization.node_text

    assert "node_text" not in indexed.structure[0]
    assert indexed.structure[0]["prefix_summary"] == root.prefix_summary


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
    assert payload["items"][0]["summary"].startswith("Covers post-training")
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
            options=["Use view_image(image_path=...) to inspect the page visually."],
        ),
    )

    payload = json.loads(format_document_image_payload(result))

    assert payload["page_number"] == 176
    assert payload["image_path"].endswith("page-0176.png")
    assert payload["embedded_image_count"] == 2


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
