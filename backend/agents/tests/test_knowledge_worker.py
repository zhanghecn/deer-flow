from __future__ import annotations

from pathlib import Path

from src.knowledge import worker as knowledge_worker
from src.knowledge.models import (
    ReadyKnowledgeDocumentForWorkspace,
    SourceDocument,
    KnowledgeWorkspaceRecord,
    QueuedKnowledgeBuildJob,
)
from src.knowledge.worker import KnowledgeBuildWorker


class _FakeRepository:
    def __init__(self, job: QueuedKnowledgeBuildJob | None = None) -> None:
        self._job = job
        self.build_job_updates: list[dict] = []
        self.build_events: list[dict] = []
        self.document_processing_updates: list[dict] = []
        self.document_errors: list[dict] = []
        self.replaced_documents: list[dict] = []
        self.reuse_queries: list[dict] = []
        self.ready_documents_for_repair: list[ReadyKnowledgeDocumentForWorkspace] = []
        self.workspace_record = KnowledgeWorkspaceRecord(
            id="base-1",
            owner_id="user-1",
            name="Demo",
            description=None,
            source_type="library",
            visibility="private",
            document_count=1,
            ready_document_count=1,
        )

    def claim_next_queued_job(self) -> QueuedKnowledgeBuildJob | None:
        job = self._job
        self._job = None
        return job

    def update_build_job(self, **kwargs) -> None:
        self.build_job_updates.append(kwargs)

    def append_build_event(self, **kwargs) -> None:
        self.build_events.append(kwargs)

    def mark_document_processing(self, **kwargs) -> None:
        self.document_processing_updates.append(kwargs)

    def find_reusable_source_document(self, **kwargs) -> str | None:
        self.reuse_queries.append(kwargs)
        return None

    def load_source_document(self, *, document_id: str):
        return None

    def replace_source_document(self, **kwargs) -> None:
        self.replaced_documents.append(kwargs)

    def mark_document_error(self, **kwargs) -> None:
        self.document_errors.append(kwargs)

    def get_workspace_record(self, *, knowledge_base_id: str):
        assert knowledge_base_id == "base-1"
        return self.workspace_record

    def list_ready_documents_for_workspace_repair(self):
        return self.ready_documents_for_repair


def _queued_job() -> QueuedKnowledgeBuildJob:
    return QueuedKnowledgeBuildJob(
        job_id="job-1",
        knowledge_base_id="base-1",
        document_id="doc-1",
        user_id="user-1",
        thread_id="thread-1",
        display_name="demo.pdf",
        file_name="demo.pdf",
        file_kind="pdf",
        source_storage_path="knowledge/users/user-1/demo/source/demo.pdf",
        markdown_storage_path=None,
        preview_storage_path=None,
    )


def test_knowledge_worker_concurrency_env_is_bounded(monkeypatch):
    monkeypatch.setenv("OPENAGENTS_KNOWLEDGE_WORKER_CONCURRENCY", "32")

    assert knowledge_worker._knowledge_worker_concurrency() == 8

    monkeypatch.setenv("OPENAGENTS_KNOWLEDGE_WORKER_CONCURRENCY", "0")

    assert knowledge_worker._knowledge_worker_concurrency() == 1


def test_worker_run_once_processes_claimed_job(monkeypatch, tmp_path):
    repository = _FakeRepository(job=_queued_job())
    source_path = tmp_path / "demo.pdf"
    source_path.write_bytes(b"pdf-bytes")

    monkeypatch.setattr(
        knowledge_worker,
        "_storage_ref_to_path",
        lambda storage_ref: source_path,
    )
    monkeypatch.setattr(
        knowledge_worker,
        "_compute_content_sha256",
        lambda **kwargs: "sha-256-demo",
    )

    def fake_build_source_workspace_document(**kwargs) -> SourceDocument:
        assert kwargs["source_path"] == Path(source_path)
        return SourceDocument(
            display_name="demo.pdf",
            file_name="demo.pdf",
            file_kind="pdf",
            locator_type="page",
            page_count=1,
            doc_description="Demo document",
            canonical_markdown="# Demo",
        )

    monkeypatch.setattr(knowledge_worker, "build_source_workspace_document", fake_build_source_workspace_document)
    monkeypatch.setattr(
        knowledge_worker,
        "_sync_workspace_artifacts",
        lambda **_kwargs: None,
    )

    worker = KnowledgeBuildWorker(repository_factory=lambda: repository, poll_interval_seconds=0.1)

    assert worker.run_once() is True
    assert repository.document_processing_updates == [
        {
            "document_id": "doc-1",
            "locator_type": "page",
            "content_sha256": "sha-256-demo",
        }
    ]
    assert repository.reuse_queries == [
        {
            "document_id": "doc-1",
            "file_kind": "pdf",
            "content_sha256": "sha-256-demo",
        }
    ]
    assert repository.replaced_documents
    assert repository.build_job_updates[-1]["status"] == "ready"
    assert repository.build_job_updates[-1]["stage"] == "completed"


def test_repair_missing_source_workspaces_writes_canonical_sources(monkeypatch):
    repository = _FakeRepository()
    repository.ready_documents_for_repair = [
        ReadyKnowledgeDocumentForWorkspace(
            knowledge_base_id="base-1",
            document_id="doc-1",
            user_id="user-1",
            display_name="案例大全/盲派真实案例/壬寅柱/cases.md",
            file_name="cases.md",
            file_kind="markdown",
            source_storage_path="knowledge/users/user-1/bases/base-1/documents/doc-1/source/cases.md",
            canonical_storage_path="knowledge/users/user-1/bases/base-1/documents/doc-1/canonical/canonical.md",
        )
    ]
    canonical = SourceDocument(
        display_name="cases.md",
        file_name="cases.md",
        file_kind="markdown",
        locator_type="heading",
        page_count=1,
        doc_description="壬寅日主丑月案例",
        canonical_markdown="# 壬寅日主丑月\n\n相似案例原文。",
    )
    written: dict[str, str] = {}

    class _FakeWorkspaceStore:
        def list_files(self, workspace):
            assert workspace.id == "base-1"
            return []

    monkeypatch.setattr(
        repository,
        "load_source_document",
        lambda *, document_id: canonical if document_id == "doc-1" else None,
    )
    monkeypatch.setattr(
        knowledge_worker,
        "sync_source_document_to_workspace",
        lambda **kwargs: written.setdefault(
            "path",
            f"sources/{knowledge_worker.source_slug(kwargs['job'].display_name, kwargs['job'].document_id)}.md",
        ),
    )

    repaired = knowledge_worker.repair_missing_source_workspaces(
        repository=repository,
        workspace_store=_FakeWorkspaceStore(),  # type: ignore[arg-type]
    )

    assert repaired == 1
    assert written["path"] == "sources/案例大全-盲派真实案例-壬寅柱-cases-doc-1.md"
