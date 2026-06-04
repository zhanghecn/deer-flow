from __future__ import annotations

from typing import Any
from typing import Literal

from pydantic import BaseModel, Field


LocatorType = Literal["page", "heading"]


class QueuedKnowledgeBuildJob(BaseModel):
    job_id: str
    knowledge_base_id: str
    document_id: str
    user_id: str
    thread_id: str
    display_name: str
    file_name: str
    file_kind: str
    source_storage_path: str
    markdown_storage_path: str | None = None
    preview_storage_path: str | None = None


class SourceDocument(BaseModel):
    """Canonical source text persisted for a knowledge document.

    The current knowledge contract intentionally does not carry PageTree nodes,
    model summaries, or chunk metadata. Agents retrieve evidence by searching
    the mounted source Markdown files with normal filesystem tools.
    """

    display_name: str
    file_name: str
    file_kind: str
    locator_type: LocatorType
    page_count: int | None = None
    doc_description: str | None = None
    canonical_markdown: str
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
    source_storage_path: str
    markdown_storage_path: str | None = None
    preview_storage_path: str | None = None
    canonical_storage_path: str | None = None
    build_quality: str = "ready"
    quality_metadata: dict[str, Any] = Field(default_factory=dict)
    latest_build_job: KnowledgeBuildJobSummary | None = None


class KnowledgeBaseDetail(BaseModel):
    id: str
    name: str
    description: str | None = None
    source_type: str
    command_name: str | None = None
    documents: list[KnowledgeDocumentRecord]


class KnowledgeWorkspaceRecord(BaseModel):
    id: str
    owner_id: str
    name: str
    description: str | None = None
    source_type: str | None = None
    visibility: str | None = None
    ready_document_count: int = 0
    document_count: int = 0
