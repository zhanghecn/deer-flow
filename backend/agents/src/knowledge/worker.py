from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from pathlib import Path

from src.knowledge.models import QueuedKnowledgeBuildJob
from src.knowledge.repository import KnowledgeRepository
from src.knowledge.source_workspace import build_source_workspace_document
from src.knowledge.storage import get_knowledge_asset_store
from src.knowledge.source_workspace_store import KnowledgeWorkspaceStore, sync_source_document_to_workspace

logger = logging.getLogger(__name__)
_SOURCE_WORKSPACE_CACHE_VERSION = "source-workspace-v1"
_DEFAULT_POLL_INTERVAL_SECONDS = 2.0
_DEFAULT_WORKER_CONCURRENCY = 1
_MAX_WORKER_CONCURRENCY = 8
_worker_lock = threading.Lock()
_worker_threads: list[threading.Thread] = []
_worker_stop_event: threading.Event | None = None
_workspace_sync_locks: dict[str, threading.Lock] = {}
_workspace_sync_locks_guard = threading.Lock()


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
            step_name="source_workspace_complete",
            status="completed",
            message=f"Finished preparing source workspace for {self._display_name}",
            elapsed_ms=elapsed_ms,
        )
        self._repository.update_build_job(
            job_id=self._job_id,
            status="ready",
            stage="completed",
            message=f"Finished preparing source workspace for {self._display_name}",
            progress_percent=100,
            finished=True,
        )

    def finish_error(self, *, error: str, elapsed_ms: int) -> None:
        self.log_event(
            stage="error",
            step_name="source_workspace_failed",
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
    digest.update(_SOURCE_WORKSPACE_CACHE_VERSION.encode("utf-8"))
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


def _reuse_existing_source_document(
    *,
    repository: KnowledgeRepository,
    observer: _BuildJobObserver,
    job: QueuedKnowledgeBuildJob,
    content_sha256: str,
    build_started_at: float,
) -> bool:
    reusable_source_document_id = repository.find_reusable_source_document(
        document_id=job.document_id,
        file_kind=job.file_kind,
        content_sha256=content_sha256,
    )
    if not reusable_source_document_id:
        return False

    reused_source_document = repository.load_source_document(document_id=reusable_source_document_id)
    if reused_source_document is None:
        return False

    observer.update_stage(
        stage="reuse",
        message=f"Reusing an existing source workspace document for {job.display_name}",
        progress_percent=70,
    )
    observer.log_event(
        stage="reuse",
        step_name="reuse_existing_source_workspace",
        status="completed",
        message=f"Reused an existing source workspace document for {job.display_name}",
        metadata={"source_document_id": reusable_source_document_id},
    )
    repository.replace_source_document(
        document_id=job.document_id,
        source_document=reused_source_document,
    )
    _sync_workspace_artifacts(
        repository=repository,
        observer=observer,
        job=job,
        source_document=reused_source_document,
        content_sha256=content_sha256,
    )
    observer.finish_success(
        elapsed_ms=_elapsed_ms_since(build_started_at),
    )
    return True


def _sync_workspace_artifacts(
    *,
    repository: KnowledgeRepository,
    observer: _BuildJobObserver,
    job: QueuedKnowledgeBuildJob,
    source_document,
    content_sha256: str | None,
) -> None:
    workspace = repository.get_workspace_record(knowledge_base_id=job.knowledge_base_id)
    if workspace is None:
        raise ValueError(f"Knowledge workspace not found for base {job.knowledge_base_id}")
    observer.update_stage(
        stage="workspace",
        message=f"Writing source workspace files for {job.display_name}",
        progress_percent=99,
    )
    # Source workspace files are shared per knowledge base. Serialize the write
    # so old compiled artifacts can be removed and the current source file can
    # be made visible atomically from the agent's point of view.
    with _workspace_sync_lock_for(job.knowledge_base_id):
        files_written = sync_source_document_to_workspace(
            store=KnowledgeWorkspaceStore(),
            workspace=workspace,
            job=job,
            source_document=source_document,
            content_sha256=content_sha256,
            observer=observer,
        )
    observer.log_event(
        stage="workspace",
        step_name="source_workspace_sync",
        status="completed",
        message=f"Wrote {len(files_written)} source workspace file(s) for {job.display_name}",
        metadata={"files_written": files_written, "workspace_id": workspace.id},
    )


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
            content_sha256=content_sha256,
        )
        observer.update_stage(
            stage="queued",
            message=f"Starting source workspace preparation for {job.display_name}",
            progress_percent=1,
        )
        observer.log_event(
            stage="queued",
            step_name="job_started",
            status="completed",
            message=f"Started source workspace preparation for {job.display_name}",
        )

        if _reuse_existing_source_document(
            repository=repository,
            observer=observer,
            job=job,
            content_sha256=content_sha256,
            build_started_at=build_started_at,
        ):
            return

        source_document = build_source_workspace_document(
            source_path=source_path,
            file_kind=job.file_kind,
            display_name=job.display_name,
            markdown_path=markdown_path,
            preview_path=preview_path,
        )
        observer.update_stage(
            stage="persist",
            message=f"Persisting source workspace document for {job.display_name}",
            progress_percent=98,
        )
        repository.replace_source_document(
            document_id=job.document_id,
            source_document=source_document,
        )
        _sync_workspace_artifacts(
            repository=repository,
            observer=observer,
            job=job,
            source_document=source_document,
            content_sha256=content_sha256,
        )
        observer.finish_success(
            elapsed_ms=_elapsed_ms_since(build_started_at),
        )
    except Exception as exc:
        logger.exception("Knowledge source workspace preparation failed for %s", job.display_name)
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


def _knowledge_worker_concurrency() -> int:
    raw = os.getenv("OPENAGENTS_KNOWLEDGE_WORKER_CONCURRENCY", str(_DEFAULT_WORKER_CONCURRENCY)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid OPENAGENTS_KNOWLEDGE_WORKER_CONCURRENCY: {raw}") from exc
    return max(1, min(value, _MAX_WORKER_CONCURRENCY))


def _workspace_sync_lock_for(knowledge_base_id: str) -> threading.Lock:
    with _workspace_sync_locks_guard:
        return _workspace_sync_locks.setdefault(knowledge_base_id, threading.Lock())


def start_knowledge_worker_thread() -> threading.Thread | None:
    global _worker_threads, _worker_stop_event

    if not _knowledge_worker_enabled():
        logger.info("Knowledge build worker is disabled by configuration.")
        return None

    with _worker_lock:
        live_threads = [thread for thread in _worker_threads if thread.is_alive()]
        if live_threads:
            _worker_threads = live_threads
            return live_threads[0]

        _worker_stop_event = threading.Event()
        poll_interval_seconds = _knowledge_worker_poll_interval_seconds()
        concurrency = _knowledge_worker_concurrency()
        _worker_threads = []
        for index in range(concurrency):
            worker = KnowledgeBuildWorker(poll_interval_seconds=poll_interval_seconds)
            thread = threading.Thread(
                target=worker.run_forever,
                kwargs={"stop_event": _worker_stop_event},
                name=f"knowledge-build-worker-{index + 1}",
                daemon=True,
            )
            thread.start()
            _worker_threads.append(thread)
        logger.info("Started %s knowledge build worker thread(s).", concurrency)
        return _worker_threads[0] if _worker_threads else None


def stop_knowledge_worker_thread() -> None:
    global _worker_threads, _worker_stop_event

    with _worker_lock:
        if _worker_stop_event is not None:
            _worker_stop_event.set()
        _worker_threads = []
        _worker_stop_event = None
