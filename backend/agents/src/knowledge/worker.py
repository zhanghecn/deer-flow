from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from pathlib import Path

from src.knowledge.models import QueuedKnowledgeBuildJob
from src.knowledge.pageindex import build_document_index
from src.knowledge.repository import KnowledgeRepository
from src.knowledge.storage import get_knowledge_asset_store

logger = logging.getLogger(__name__)
_INDEX_CACHE_VERSION = "pageindex-pg-v1"
_DEFAULT_POLL_INTERVAL_SECONDS = 2.0
_worker_lock = threading.Lock()
_worker_thread: threading.Thread | None = None
_worker_stop_event: threading.Event | None = None


class _BuildJobObserver:
    def __init__(
        self,
        *,
        repository: KnowledgeRepository,
        job_id: str,
        document_id: str,
        display_name: str,
    ) -> None:
        self._repository = repository
        self._job_id = job_id
        self._document_id = document_id
        self._display_name = display_name

    def update_stage(
        self,
        *,
        stage: str,
        message: str,
        progress_percent: int | None = None,
        total_steps: int | None = None,
        completed_steps: int | None = None,
    ) -> None:
        self._repository.update_build_job(
            job_id=self._job_id,
            status="processing" if stage != "completed" else "ready",
            stage=stage,
            message=message,
            progress_percent=progress_percent,
            total_steps=total_steps,
            completed_steps=completed_steps,
            started=True,
        )

    def log_event(
        self,
        *,
        stage: str,
        step_name: str,
        status: str,
        message: str,
        elapsed_ms: int | None = None,
        retry_count: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        metadata: dict | None = None,
    ) -> None:
        self._repository.append_build_event(
            job_id=self._job_id,
            document_id=self._document_id,
            stage=stage,
            step_name=step_name,
            status=status,
            message=message,
            elapsed_ms=elapsed_ms,
            retry_count=retry_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            metadata=metadata or {},
        )

    def finish_success(self, *, elapsed_ms: int) -> None:
        self.log_event(
            stage="persist",
            step_name="index_complete",
            status="completed",
            message=f"Finished indexing {self._display_name}",
            elapsed_ms=elapsed_ms,
        )
        self._repository.update_build_job(
            job_id=self._job_id,
            status="ready",
            stage="completed",
            message=f"Finished indexing {self._display_name}",
            progress_percent=100,
            finished=True,
        )

    def finish_error(self, *, error: str, elapsed_ms: int) -> None:
        self.log_event(
            stage="error",
            step_name="index_failed",
            status="error",
            message=error,
            elapsed_ms=elapsed_ms,
        )
        self._repository.update_build_job(
            job_id=self._job_id,
            status="error",
            stage="error",
            message=error[:2000],
            finished=True,
        )


def _require_model_name(job: QueuedKnowledgeBuildJob) -> str:
    model_name = str(job.model_name or "").strip()
    if model_name:
        return model_name
    raise ValueError(f"Knowledge build job {job.job_id} requires an explicit model_name.") from None


def _storage_ref_to_path(storage_ref: str | None) -> Path:
    if not storage_ref:
        raise ValueError("Knowledge storage ref is required.")
    return get_knowledge_asset_store().resolve_local_path(storage_ref)


def _compute_content_sha256(
    *,
    source_path: Path,
    markdown_path: Path | None,
    preview_path: Path | None,
    file_kind: str,
) -> str:
    digest = hashlib.sha256()
    digest.update(_INDEX_CACHE_VERSION.encode("utf-8"))
    digest.update(file_kind.lower().strip().encode("utf-8"))
    for label, path in (
        ("source", source_path),
        ("markdown", markdown_path),
        ("preview", preview_path),
    ):
        if path is None or not path.is_file():
            continue
        digest.update(label.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _elapsed_ms_since(started_at: float) -> int:
    return int((time.perf_counter() - started_at) * 1000)


def _resolve_locator_type(file_kind: str) -> str:
    return "heading" if file_kind.lower() == "markdown" else "page"


def _resolve_job_paths(
    job: QueuedKnowledgeBuildJob,
) -> tuple[Path, Path | None, Path | None]:
    source_path = _storage_ref_to_path(job.source_storage_path)
    markdown_path = _storage_ref_to_path(job.markdown_storage_path) if job.markdown_storage_path else None
    preview_path = _storage_ref_to_path(job.preview_storage_path) if job.preview_storage_path else None
    return source_path, markdown_path, preview_path


def _reuse_existing_document_index(
    *,
    repository: KnowledgeRepository,
    observer: _BuildJobObserver,
    job: QueuedKnowledgeBuildJob,
    content_sha256: str,
    model_name: str,
    build_started_at: float,
) -> bool:
    reusable_source_document_id = repository.find_reusable_document_index(
        document_id=job.document_id,
        file_kind=job.file_kind,
        content_sha256=content_sha256,
        build_model_name=model_name,
    )
    if not reusable_source_document_id:
        return False

    reused_index = repository.load_indexed_document(document_id=reusable_source_document_id)
    if reused_index is None:
        return False

    observer.update_stage(
        stage="reuse",
        message=f"Reusing an existing index for {job.display_name}",
        progress_percent=70,
    )
    observer.log_event(
        stage="reuse",
        step_name="reuse_existing_index",
        status="completed",
        message=f"Reused an existing persisted index for {job.display_name}",
        metadata={"source_document_id": reusable_source_document_id},
    )
    repository.replace_document_index(
        document_id=job.document_id,
        indexed_document=reused_index,
    )
    observer.finish_success(
        elapsed_ms=_elapsed_ms_since(build_started_at),
    )
    return True


def process_build_job(
    *,
    repository: KnowledgeRepository,
    job: QueuedKnowledgeBuildJob,
) -> None:
    build_started_at = time.perf_counter()
    observer = _BuildJobObserver(
        repository=repository,
        job_id=job.job_id,
        document_id=job.document_id,
        display_name=job.display_name,
    )

    try:
        model_name = _require_model_name(job)
        source_path, markdown_path, preview_path = _resolve_job_paths(job)
        content_sha256 = _compute_content_sha256(
            source_path=source_path,
            markdown_path=markdown_path,
            preview_path=preview_path,
            file_kind=job.file_kind,
        )
        repository.mark_document_processing(
            document_id=job.document_id,
            locator_type=_resolve_locator_type(job.file_kind),
            build_model_name=model_name,
            content_sha256=content_sha256,
        )
        observer.update_stage(
            stage="queued",
            message=f"Starting indexing for {job.display_name}",
            progress_percent=1,
        )
        observer.log_event(
            stage="queued",
            step_name="job_started",
            status="completed",
            message=f"Started indexing {job.display_name}",
        )

        if _reuse_existing_document_index(
            repository=repository,
            observer=observer,
            job=job,
            content_sha256=content_sha256,
            model_name=model_name,
            build_started_at=build_started_at,
        ):
            return

        indexed_document = build_document_index(
            source_path=source_path,
            file_kind=job.file_kind,
            display_name=job.display_name,
            markdown_path=markdown_path,
            preview_path=preview_path,
            model_name=model_name,
            observer=observer,
        )
        observer.update_stage(
            stage="persist",
            message=f"Persisting index for {job.display_name}",
            progress_percent=98,
        )
        repository.replace_document_index(
            document_id=job.document_id,
            indexed_document=indexed_document,
        )
        observer.finish_success(
            elapsed_ms=_elapsed_ms_since(build_started_at),
        )
    except Exception as exc:
        logger.exception("Knowledge indexing failed for %s", job.display_name)
        error_message = str(exc)
        repository.mark_document_error(
            document_id=job.document_id,
            error=error_message,
        )
        observer.finish_error(
            error=error_message,
            elapsed_ms=_elapsed_ms_since(build_started_at),
        )


class KnowledgeBuildWorker:
    def __init__(
        self,
        *,
        repository_factory=KnowledgeRepository,
        poll_interval_seconds: float = _DEFAULT_POLL_INTERVAL_SECONDS,
    ) -> None:
        self._repository_factory = repository_factory
        self._poll_interval_seconds = max(0.1, poll_interval_seconds)

    def run_once(self) -> bool:
        repository = self._repository_factory()
        job = repository.claim_next_queued_job()
        if job is None:
            return False
        process_build_job(repository=repository, job=job)
        return True

    def run_forever(self, *, stop_event: threading.Event | None = None) -> None:
        local_stop_event = stop_event or threading.Event()
        logger.info(
            "Knowledge build worker started (poll_interval_seconds=%.2f)",
            self._poll_interval_seconds,
        )
        while not local_stop_event.is_set():
            processed_job = False
            try:
                processed_job = self.run_once()
            except Exception:
                logger.exception("Knowledge build worker loop failed")
            if processed_job:
                continue
            local_stop_event.wait(self._poll_interval_seconds)


def _knowledge_worker_enabled() -> bool:
    raw = os.getenv("OPENAGENTS_KNOWLEDGE_WORKER_ENABLED", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _knowledge_worker_poll_interval_seconds() -> float:
    raw = os.getenv(
        "OPENAGENTS_KNOWLEDGE_WORKER_POLL_INTERVAL_SECONDS",
        str(_DEFAULT_POLL_INTERVAL_SECONDS),
    ).strip()
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid OPENAGENTS_KNOWLEDGE_WORKER_POLL_INTERVAL_SECONDS: {raw}") from exc
    return max(0.1, value)


def start_knowledge_worker_thread() -> threading.Thread | None:
    global _worker_thread, _worker_stop_event

    if not _knowledge_worker_enabled():
        logger.info("Knowledge build worker is disabled by configuration.")
        return None

    with _worker_lock:
        if _worker_thread is not None and _worker_thread.is_alive():
            return _worker_thread

        _worker_stop_event = threading.Event()
        worker = KnowledgeBuildWorker(poll_interval_seconds=_knowledge_worker_poll_interval_seconds())
        _worker_thread = threading.Thread(
            target=worker.run_forever,
            kwargs={"stop_event": _worker_stop_event},
            name="knowledge-build-worker",
            daemon=True,
        )
        _worker_thread.start()
        logger.info("Started knowledge build worker thread.")
        return _worker_thread


def stop_knowledge_worker_thread() -> None:
    global _worker_thread, _worker_stop_event

    with _worker_lock:
        if _worker_stop_event is not None:
            _worker_stop_event.set()
        _worker_thread = None
        _worker_stop_event = None
