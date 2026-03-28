from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from typing import Literal

from pydantic import BaseModel, Field


LocatorType = Literal["page", "heading"]
SummaryQuality = Literal["llm", "extractive", "fallback"]
EvidenceKind = Literal["text", "image", "caption", "page_image"]


class DocumentDescriptionOutput(BaseModel):
    description: str = Field(min_length=1, max_length=280)
    keywords: list[str] = Field(default_factory=list)


class NodeSummaryOutput(BaseModel):
    summary: str = Field(min_length=1)
    visual_summary: str | None = None
    distinctive_terms: list[str] = Field(default_factory=list)


class HeadingPagePrediction(BaseModel):
    matched: bool
    page_number: int | None = Field(default=None, ge=1)
    reason: str = ""


class KnowledgeManifestDocument(BaseModel):
    id: str
    display_name: str
    file_name: str
    file_kind: str
    source_storage_path: str
    markdown_storage_path: str | None = None
    preview_storage_path: str | None = None


class KnowledgeManifest(BaseModel):
    user_id: str
    thread_id: str
    knowledge_base_id: str
    knowledge_base_name: str
    knowledge_base_description: str | None = None
    source_type: str = "sidebar"
    command_name: str | None = None
    model_name: str | None = None
    documents: list[KnowledgeManifestDocument]


class CanonicalSourceMapEntry(BaseModel):
    node_id: str | None = None
    locator_type: LocatorType
    page_start: int | None = None
    page_end: int | None = None
    line_start: int | None = None
    line_end: int | None = None
    heading_slug: str | None = None
    marker: str | None = None


class KnowledgeEvidenceRef(BaseModel):
    evidence_id: str
    kind: EvidenceKind
    locator_type: LocatorType
    page_number: int | None = Field(default=None, ge=1)
    line_number: int | None = Field(default=None, ge=1)
    heading_slug: str | None = None
    caption_text: str | None = None
    alt_text: str | None = None
    asset_rel_path: str | None = None


class DocumentTreeNode(BaseModel):
    node_id: str
    parent_node_id: str | None = None
    node_path: str
    title: str
    depth: int
    child_count: int = 0
    locator_type: LocatorType
    page_start: int | None = None
    page_end: int | None = None
    line_start: int | None = None
    line_end: int | None = None
    heading_slug: str | None = None
    summary: str | None = None
    visual_summary: str | None = None
    summary_quality: SummaryQuality = "fallback"
    evidence_refs: list[KnowledgeEvidenceRef] = Field(default_factory=list)
    prefix_summary: str | None = None
    node_text: str | None = None


class IndexedDocument(BaseModel):
    display_name: str
    file_name: str
    file_kind: str
    locator_type: LocatorType
    page_count: int | None = None
    doc_description: str | None = None
    structure: list[dict]
    nodes: list[DocumentTreeNode]
    canonical_markdown: str
    source_map: list[CanonicalSourceMapEntry]
    build_quality: str = "ready"
    quality_metadata: dict[str, Any] = Field(default_factory=dict)


class KnowledgeBuildJobSummary(BaseModel):
    id: str
    status: str
    stage: str | None = None
    message: str | None = None
    progress_percent: int = 0
    total_steps: int = 0
    completed_steps: int = 0
    model_name: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class KnowledgeBuildEventRecord(BaseModel):
    id: int
    job_id: str
    document_id: str
    stage: str
    step_name: str
    status: str
    message: str | None = None
    elapsed_ms: int | None = None
    retry_count: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None


class KnowledgeDocumentRecord(BaseModel):
    id: str
    knowledge_base_id: str
    knowledge_base_name: str
    knowledge_base_description: str | None = None
    display_name: str
    file_kind: str
    locator_type: LocatorType
    status: str
    doc_description: str | None = None
    error: str | None = None
    page_count: int | None = None
    node_count: int = 0
    source_storage_path: str
    markdown_storage_path: str | None = None
    preview_storage_path: str | None = None
    canonical_storage_path: str | None = None
    source_map_storage_path: str | None = None
    build_quality: str = "ready"
    quality_metadata: dict[str, Any] = Field(default_factory=dict)
    latest_build_job: KnowledgeBuildJobSummary | None = None


class KnowledgeNodeRecord(BaseModel):
    document_id: str
    node_id: str
    parent_node_id: str | None = None
    node_path: str
    title: str
    depth: int
    child_count: int
    locator_type: LocatorType
    page_start: int | None = None
    page_end: int | None = None
    line_start: int | None = None
    line_end: int | None = None
    heading_slug: str | None = None
    summary: str | None = None
    visual_summary: str | None = None
    summary_quality: SummaryQuality = "fallback"
    evidence_refs: list[KnowledgeEvidenceRef] = Field(default_factory=list)
    prefix_summary: str | None = None
    node_text: str | None = None


class DocumentTreeListing(BaseModel):
    document: KnowledgeDocumentRecord
    node_id: str | None = None
    requested_max_depth: int = 2
    effective_max_depth: int = 2
    window_mode: Literal["root_overview", "subtree"] = "subtree"
    root_cursor: int = 0
    total_root_nodes: int | None = None
    previous_root_cursor: int | None = None
    next_root_cursor: int | None = None
    tree: list[dict]


class KnowledgeBaseDetail(BaseModel):
    id: str
    name: str
    description: str | None = None
    source_type: str
    command_name: str | None = None
    documents: list[KnowledgeDocumentRecord]


class KnowledgeToolNextSteps(BaseModel):
    summary: str
    options: list[str] = Field(default_factory=list)


class NodePageChunk(BaseModel):
    page_number: int = Field(ge=1)
    text: str
    citation_markdown: str
    embedded_image_count: int = Field(default=0, ge=0)
    image_paths: list[str] = Field(default_factory=list)


class EvidencePreviewTarget(BaseModel):
    artifact_path: str
    page: int | None = Field(default=None, ge=1)
    heading: str | None = None
    line: int | None = Field(default=None, ge=1)
    locator_label: str | None = None


class EvidenceBlock(BaseModel):
    evidence_id: str
    kind: EvidenceKind
    locator_type: LocatorType
    locator_label: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    line_number: int | None = Field(default=None, ge=1)
    heading_slug: str | None = None
    text: str | None = None
    caption_text: str | None = None
    image_path: str | None = None
    image_markdown: str | None = None
    display_markdown: str | None = None
    citation_markdown: str | None = None
    preview_target: EvidencePreviewTarget | None = None


class NodeDetailItem(BaseModel):
    node_id: str
    parent_node_id: str | None = None
    title: str
    child_count: int = 0
    page_start: int | None = None
    page_end: int | None = None
    line_start: int | None = None
    line_end: int | None = None
    heading_slug: str | None = None
    summary: str | None = None
    visual_summary: str | None = None
    summary_quality: SummaryQuality = "fallback"
    prefix_summary: str | None = None
    citation_markdown: str | None = None
    text: str | None = None
    image_paths: list[str] = Field(default_factory=list)
    page_chunks: list[NodePageChunk] = Field(default_factory=list)
    evidence_blocks: list[EvidenceBlock] = Field(default_factory=list)


class NodeDetailResult(BaseModel):
    document: KnowledgeDocumentRecord
    requested_node_ids: list[str]
    items: list[NodeDetailItem]
    total_pages: int | None = None
    requested_pages: str | None = None
    returned_pages: str | None = None
    returned_lines: str | None = None
    next_steps: KnowledgeToolNextSteps


class DocumentEvidenceResult(BaseModel):
    document: KnowledgeDocumentRecord
    requested_node_ids: list[str]
    items: list[NodeDetailItem]
    total_pages: int | None = None
    returned_pages: str | None = None
    returned_lines: str | None = None
    next_steps: KnowledgeToolNextSteps


class DocumentImageResult(BaseModel):
    document: KnowledgeDocumentRecord
    page_number: int = Field(ge=1)
    image_path: str
    embedded_image_count: int = Field(default=0, ge=0)
    next_steps: KnowledgeToolNextSteps


def first_non_empty(values: Sequence[str | None]) -> str | None:
    for value in values:
        if value is None:
            continue
        stripped = value.strip()
        if stripped:
            return stripped
    return None
