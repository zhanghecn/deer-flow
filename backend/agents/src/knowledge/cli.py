from __future__ import annotations

import argparse
import hashlib
import json
import logging
import time
from pathlib import Path

from src.config.runtime_db import get_runtime_db_store
from src.knowledge.models import KnowledgeManifest
from src.knowledge.pageindex import build_document_index
from src.knowledge.repository import KnowledgeRepository

logger = logging.getLogger(__name__)
_INDEX_CACHE_VERSION = "pageindex-pg-v1"


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


def _resolve_model_name(manifest: KnowledgeManifest) -> str | None:
    if manifest.model_name:
        return manifest.model_name

    db_store = get_runtime_db_store()
    thread_model = db_store.get_thread_runtime_model(
        thread_id=manifest.thread_id,
        user_id=manifest.user_id,
    )
    if thread_model:
        return thread_model

    enabled_model = db_store.get_any_enabled_model()
    return enabled_model.name if enabled_model is not None else None


def ingest_manifest(manifest_path: Path) -> None:
    manifest = KnowledgeManifest.model_validate_json(
        manifest_path.read_text(encoding="utf-8")
    )
    repository = KnowledgeRepository()
    model_name = _resolve_model_name(manifest)

    repository.upsert_manifest_base(
        knowledge_base_id=manifest.knowledge_base_id,
        user_id=manifest.user_id,
        name=manifest.knowledge_base_name,
        description=manifest.knowledge_base_description,
        source_type=manifest.source_type,
        command_name=manifest.command_name,
    )
    repository.attach_base_to_thread(
        thread_id=manifest.thread_id,
        knowledge_base_id=manifest.knowledge_base_id,
        user_id=manifest.user_id,
    )

    for document in manifest.documents:
        build_started_at = time.perf_counter()
        source_path = _storage_ref_to_path(document.source_storage_path)
        markdown_path = (
            _storage_ref_to_path(document.markdown_storage_path)
            if document.markdown_storage_path
            else None
        )
        preview_path = (
            _storage_ref_to_path(document.preview_storage_path)
            if document.preview_storage_path
            else None
        )
        content_sha256 = _compute_content_sha256(
            source_path=source_path,
            markdown_path=markdown_path,
            preview_path=preview_path,
            file_kind=document.file_kind,
        )

        locator_type = (
            "heading"
            if document.file_kind.lower() == "markdown"
            else "page"
        )
        repository.upsert_document_processing(
            document_id=document.id,
            knowledge_base_id=manifest.knowledge_base_id,
            user_id=manifest.user_id,
            display_name=document.display_name,
            file_name=document.file_name,
            file_kind=document.file_kind,
            locator_type=locator_type,
            source_storage_path=document.source_storage_path,
            markdown_storage_path=document.markdown_storage_path,
            preview_storage_path=document.preview_storage_path,
            build_model_name=model_name,
            content_sha256=content_sha256,
        )
        job_id = repository.create_build_job(
            knowledge_base_id=manifest.knowledge_base_id,
            document_id=document.id,
            user_id=manifest.user_id,
            thread_id=manifest.thread_id,
            model_name=model_name,
            status="processing",
            stage="queued",
            message=f"Queued indexing for {document.display_name}",
        )
        observer = _BuildJobObserver(
            repository=repository,
            job_id=job_id,
            document_id=document.id,
            display_name=document.display_name,
        )
        observer.update_stage(
            stage="queued",
            message=f"Starting indexing for {document.display_name}",
            progress_percent=1,
        )
        observer.log_event(
            stage="queued",
            step_name="job_started",
            status="completed",
            message=f"Started indexing {document.display_name}",
        )
        try:
            reusable_source_document_id = repository.find_reusable_document_index(
                document_id=document.id,
                file_kind=document.file_kind,
                content_sha256=content_sha256,
                build_model_name=model_name,
            )
            if reusable_source_document_id:
                reused_index = repository.load_indexed_document(
                    document_id=reusable_source_document_id
                )
                if reused_index is not None:
                    observer.update_stage(
                        stage="reuse",
                        message=f"Reusing an existing index for {document.display_name}",
                        progress_percent=70,
                    )
                    observer.log_event(
                        stage="reuse",
                        step_name="reuse_existing_index",
                        status="completed",
                        message=f"Reused an existing persisted index for {document.display_name}",
                        metadata={"source_document_id": reusable_source_document_id},
                    )
                    repository.replace_document_index(
                        document_id=document.id,
                        indexed_document=reused_index,
                    )
                    observer.finish_success(
                        elapsed_ms=int((time.perf_counter() - build_started_at) * 1000),
                    )
                    continue

            indexed_document = build_document_index(
                source_path=source_path,
                file_kind=document.file_kind,
                display_name=document.display_name,
                markdown_path=markdown_path,
                preview_path=preview_path,
                model_name=model_name,
                observer=observer,
            )
        except Exception as exc:
            logger.exception("Knowledge indexing failed for %s", document.display_name)
            repository.mark_document_error(
                document_id=document.id,
                error=str(exc),
            )
            observer.finish_error(
                error=str(exc),
                elapsed_ms=int((time.perf_counter() - build_started_at) * 1000),
            )
            continue

        observer.update_stage(
            stage="persist",
            message=f"Persisting index for {document.display_name}",
            progress_percent=98,
        )
        repository.replace_document_index(
            document_id=document.id,
            indexed_document=indexed_document,
        )
        observer.finish_success(
            elapsed_ms=int((time.perf_counter() - build_started_at) * 1000),
        )


def _storage_ref_to_path(storage_ref: str | None) -> Path:
    if not storage_ref:
        raise ValueError("Knowledge storage ref is required.")
    return (KnowledgeRepository()._paths.base_dir / storage_ref).resolve()


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


def main() -> int:
    parser = argparse.ArgumentParser(description="Knowledge indexing CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest_parser = subparsers.add_parser("ingest")
    ingest_parser.add_argument("--manifest", required=True)

    args = parser.parse_args()
    if args.command == "ingest":
        ingest_manifest(Path(args.manifest))
        return 0
    raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
