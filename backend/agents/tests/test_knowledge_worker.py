from __future__ import annotations

from pathlib import Path

from src.knowledge.models import IndexedDocument, QueuedKnowledgeBuildJob
from src.knowledge.worker import KnowledgeBuildWorker, process_build_job
from src.knowledge import worker as knowledge_worker


class _FakeRepository:
    def __init__(self, job: QueuedKnowledgeBuildJob | None = None) -> None:
        self._job = job
        self.build_job_updates: list[dict] = []
        self.build_events: list[dict] = []
        self.document_processing_updates: list[dict] = []
        self.document_errors: list[dict] = []
        self.replaced_documents: list[dict] = []
        self.reuse_queries: list[dict] = []

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

    def find_reusable_document_index(self, **kwargs) -> str | None:
        self.reuse_queries.append(kwargs)
        return None

    def load_indexed_document(self, *, document_id: str):
        return None

    def replace_document_index(self, **kwargs) -> None:
        self.replaced_documents.append(kwargs)

    def mark_document_error(self, **kwargs) -> None:
        self.document_errors.append(kwargs)


def _queued_job(*, model_name: str | None) -> QueuedKnowledgeBuildJob:
    return QueuedKnowledgeBuildJob(
        job_id="job-1",
        knowledge_base_id="base-1",
        document_id="doc-1",
        user_id="user-1",
        thread_id="thread-1",
        model_name=model_name,
        display_name="demo.pdf",
        file_name="demo.pdf",
        file_kind="pdf",
        source_storage_path="knowledge/users/user-1/demo/source/demo.pdf",
        markdown_storage_path=None,
        preview_storage_path=None,
    )


def test_process_build_job_marks_error_when_model_name_is_missing():
    repository = _FakeRepository()

    process_build_job(repository=repository, job=_queued_job(model_name=None))

    assert repository.document_errors == [
        {
            "document_id": "doc-1",
            "error": "Knowledge build job job-1 requires an explicit model_name.",
        }
    ]
    assert repository.build_job_updates[-1]["status"] == "error"
    assert repository.build_job_updates[-1]["stage"] == "error"


def test_worker_run_once_processes_claimed_job(monkeypatch, tmp_path):
    repository = _FakeRepository(job=_queued_job(model_name="kimi-k2.5"))
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

    def fake_build_document_index(**kwargs) -> IndexedDocument:
        assert kwargs["model_name"] == "kimi-k2.5"
        assert kwargs["source_path"] == Path(source_path)
        return IndexedDocument(
            display_name="demo.pdf",
            file_name="demo.pdf",
            file_kind="pdf",
            locator_type="page",
            page_count=1,
            doc_description="Demo document",
            structure=[],
            nodes=[],
            canonical_markdown="# Demo",
            source_map=[],
        )

    monkeypatch.setattr(knowledge_worker, "build_document_index", fake_build_document_index)

    worker = KnowledgeBuildWorker(repository_factory=lambda: repository, poll_interval_seconds=0.1)

    assert worker.run_once() is True
    assert repository.document_processing_updates == [
        {
            "document_id": "doc-1",
            "locator_type": "page",
            "build_model_name": "kimi-k2.5",
            "content_sha256": "sha-256-demo",
        }
    ]
    assert repository.reuse_queries == [
        {
            "document_id": "doc-1",
            "file_kind": "pdf",
            "content_sha256": "sha-256-demo",
            "build_model_name": "kimi-k2.5",
        }
    ]
    assert repository.replaced_documents
    assert repository.build_job_updates[-1]["status"] == "ready"
    assert repository.build_job_updates[-1]["stage"] == "completed"
