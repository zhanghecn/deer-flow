from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from src.config.paths import get_paths
from src.config.runtime_db import get_runtime_db_store
from src.knowledge.models import (
    SourceDocument,
    KnowledgeBuildJobSummary,
    KnowledgeWorkspaceRecord,
    QueuedKnowledgeBuildJob,
    ReadyKnowledgeDocumentForWorkspace,
)
from src.knowledge.storage import get_knowledge_asset_store


class KnowledgeRepository:
    def __init__(self) -> None:
        self._db = get_runtime_db_store()
        self._paths = get_paths()
        self._asset_store = get_knowledge_asset_store(self._paths)

    @contextmanager
    def connection(self):
        with self._db.connection() as conn:
            yield conn

    def _write_document_artifacts(
        self,
        *,
        storage_ref: str,
        source_document: SourceDocument,
    ) -> str:
        canonical_storage_ref = self._asset_store.join_package_ref(
            storage_ref=storage_ref,
            relative_path="canonical/canonical.md",
        )
        self._asset_store.write_text(
            storage_ref=canonical_storage_ref,
            text=source_document.canonical_markdown,
        )
        return canonical_storage_ref

    def upsert_manifest_base(
        self,
        *,
        knowledge_base_id: str,
        user_id: str,
        name: str,
        description: str | None,
        source_type: str,
        command_name: str | None,
    ) -> None:
        query = """
            INSERT INTO knowledge_bases (id, user_id, name, description, source_type, command_name)
            VALUES (%s, %s::uuid, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                description = EXCLUDED.description,
                source_type = EXCLUDED.source_type,
                command_name = EXCLUDED.command_name,
                updated_at = NOW()
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                query,
                (
                    knowledge_base_id,
                    user_id,
                    name,
                    description,
                    source_type,
                    command_name,
                ),
            )

    def attach_base_to_thread(
        self,
        *,
        thread_id: str,
        knowledge_base_id: str,
        user_id: str,
    ) -> None:
        query = """
            INSERT INTO knowledge_thread_bindings (thread_id, knowledge_base_id, user_id)
            SELECT %s, b.id, %s::uuid
            FROM knowledge_bases b
            WHERE b.id = %s::uuid
              AND (b.user_id = %s::uuid OR b.visibility = 'shared')
            ON CONFLICT (thread_id, knowledge_base_id) DO NOTHING
        """
        existing_query = """
            SELECT EXISTS (
                SELECT 1
                FROM knowledge_thread_bindings
                WHERE thread_id = %s
                  AND knowledge_base_id = %s::uuid
                  AND user_id = %s::uuid
            )
        """
        with self.connection() as conn, conn.cursor() as cur:
            # Runtime agent defaults use the same tenant/visibility gate as
            # manual UI attachments before becoming thread-scope state.
            cur.execute(query, (thread_id, user_id, knowledge_base_id, user_id))
            if cur.rowcount and cur.rowcount > 0:
                return
            cur.execute(existing_query, (thread_id, knowledge_base_id, user_id))
            row = cur.fetchone()
            if row is not None and bool(row[0]):
                return
        raise ValueError(f"Knowledge base '{knowledge_base_id}' is not visible to user '{user_id}'.")

    def create_build_job(
        self,
        *,
        knowledge_base_id: str,
        document_id: str,
        user_id: str,
        thread_id: str,
        status: str = "queued",
        stage: str = "queued",
        message: str | None = None,
    ) -> str:
        query = """
            INSERT INTO knowledge_build_jobs (
                knowledge_base_id,
                document_id,
                user_id,
                thread_id,
                status,
                stage,
                message
            )
            VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s)
            RETURNING id::text
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                query,
                (
                    knowledge_base_id,
                    document_id,
                    user_id,
                    thread_id,
                    status,
                    stage,
                    message,
                ),
            )
            row = cur.fetchone()
        if row is None:
            raise RuntimeError("Failed to create knowledge build job.")
        return str(row[0])

    def claim_next_queued_job(self) -> QueuedKnowledgeBuildJob | None:
        query = """
            SELECT
                j.id::text,
                j.knowledge_base_id::text,
                j.document_id::text,
                j.user_id::text,
                j.thread_id,
                d.display_name,
                d.file_name,
                d.file_kind,
                d.source_storage_path,
                d.markdown_storage_path,
                d.preview_storage_path
            FROM knowledge_build_jobs j
            JOIN knowledge_documents d ON d.id = j.document_id
            WHERE j.status = 'queued'
            ORDER BY j.created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        """
        with self.connection() as conn, conn.transaction(), conn.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()
            if row is None:
                return None

            job_id = str(row[0])
            display_name = str(row[5])
            cur.execute(
                """
                UPDATE knowledge_build_jobs
                SET status = 'processing',
                    stage = 'queued',
                    message = %s,
                    started_at = COALESCE(started_at, NOW()),
                    updated_at = NOW()
                WHERE id = %s::uuid
                """,
                (f"Starting source workspace preparation for {display_name}", job_id),
            )

        return QueuedKnowledgeBuildJob(
            job_id=job_id,
            knowledge_base_id=str(row[1]),
            document_id=str(row[2]),
            user_id=str(row[3]),
            thread_id=str(row[4] or ""),
            display_name=display_name,
            file_name=str(row[6]),
            file_kind=str(row[7]),
            source_storage_path=str(row[8]),
            markdown_storage_path=row[9],
            preview_storage_path=row[10],
        )

    def update_build_job(
        self,
        *,
        job_id: str,
        status: str | None = None,
        stage: str | None = None,
        message: str | None = None,
        progress_percent: int | None = None,
        total_steps: int | None = None,
        completed_steps: int | None = None,
        started: bool = False,
        finished: bool = False,
    ) -> None:
        assignments: list[str] = ["updated_at = NOW()"]
        params: list[Any] = []
        if status is not None:
            assignments.append("status = %s")
            params.append(status)
        if stage is not None:
            assignments.append("stage = %s")
            params.append(stage)
        if message is not None:
            assignments.append("message = %s")
            params.append(message)
        if progress_percent is not None:
            assignments.append("progress_percent = %s")
            params.append(max(0, min(progress_percent, 100)))
        if total_steps is not None:
            assignments.append("total_steps = %s")
            params.append(max(0, total_steps))
        if completed_steps is not None:
            assignments.append("completed_steps = %s")
            params.append(max(0, completed_steps))
        if started:
            assignments.append("started_at = COALESCE(started_at, NOW())")
        if finished:
            assignments.append("finished_at = NOW()")
        query = f"""
            UPDATE knowledge_build_jobs
            SET {", ".join(assignments)}
            WHERE id = %s::uuid
        """
        params.append(job_id)
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query, params)

    def append_build_event(
        self,
        *,
        job_id: str,
        document_id: str,
        stage: str,
        step_name: str,
        status: str,
        message: str,
        elapsed_ms: int | None = None,
        retry_count: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        query = """
            INSERT INTO knowledge_build_events (
                job_id,
                document_id,
                stage,
                step_name,
                status,
                message,
                elapsed_ms,
                retry_count,
                input_tokens,
                output_tokens,
                metadata
            )
            VALUES (
                %s::uuid,
                %s::uuid,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s::jsonb
            )
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                query,
                (
                    job_id,
                    document_id,
                    stage,
                    step_name,
                    status,
                    message,
                    elapsed_ms,
                    retry_count,
                    input_tokens,
                    output_tokens,
                    json.dumps(metadata or {}, ensure_ascii=False),
                ),
            )

    def upsert_document_processing(
        self,
        *,
        document_id: str,
        knowledge_base_id: str,
        user_id: str,
        display_name: str,
        file_name: str,
        file_kind: str,
        locator_type: str,
        source_storage_path: str,
        markdown_storage_path: str | None,
        preview_storage_path: str | None,
        content_sha256: str | None,
    ) -> None:
        query = """
            INSERT INTO knowledge_documents (
                id,
                knowledge_base_id,
                user_id,
                display_name,
                file_name,
                file_kind,
                locator_type,
                source_storage_path,
                markdown_storage_path,
                preview_storage_path,
                status,
                content_sha256
            )
            VALUES (%s, %s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s, 'processing', %s)
            ON CONFLICT (id) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                file_name = EXCLUDED.file_name,
                file_kind = EXCLUDED.file_kind,
                locator_type = EXCLUDED.locator_type,
                source_storage_path = EXCLUDED.source_storage_path,
                markdown_storage_path = EXCLUDED.markdown_storage_path,
                preview_storage_path = EXCLUDED.preview_storage_path,
                status = 'processing',
                error = NULL,
                content_sha256 = EXCLUDED.content_sha256,
                updated_at = NOW()
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                query,
                (
                    document_id,
                    knowledge_base_id,
                    user_id,
                    display_name,
                    file_name,
                    file_kind,
                    locator_type,
                    source_storage_path,
                    markdown_storage_path,
                    preview_storage_path,
                    content_sha256,
                ),
            )

    def mark_document_processing(
        self,
        *,
        document_id: str,
        locator_type: str,
        content_sha256: str | None,
    ) -> None:
        query = """
            UPDATE knowledge_documents
            SET locator_type = %s,
                status = 'processing',
                error = NULL,
                content_sha256 = %s,
                updated_at = NOW()
            WHERE id = %s::uuid
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                query,
                (
                    locator_type,
                    content_sha256,
                    document_id,
                ),
            )

    def find_reusable_source_document(
        self,
        *,
        document_id: str,
        file_kind: str,
        content_sha256: str | None,
    ) -> str | None:
        if not content_sha256:
            return None
        # Reuse is keyed by the source-workspace content hash. The current
        # build no longer requires PageTree nodes, so a zero-node canonical
        # source document is a valid reusable artifact.
        query = """
            SELECT id::text
            FROM knowledge_documents
            WHERE id <> %s::uuid
              AND status = 'ready'
              AND file_kind = %s
              AND content_sha256 = %s
            ORDER BY updated_at DESC
            LIMIT 1
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                query,
                (
                    document_id,
                    file_kind,
                    content_sha256,
                ),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return str(row[0])

    def replace_source_document(
        self,
        *,
        document_id: str,
        source_document: SourceDocument,
    ) -> None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    source_storage_path,
                    markdown_storage_path,
                    preview_storage_path
                FROM knowledge_documents
                WHERE id = %s::uuid
                LIMIT 1
                """,
                (document_id,),
            )
            row = cur.fetchone()
        if row is None:
            raise ValueError(f"Knowledge document not found: {document_id}")
        source_storage_path = row[0]
        markdown_storage_path = row[1]
        preview_storage_path = row[2]
        primary_storage_ref = _first_non_empty(source_storage_path, markdown_storage_path, preview_storage_path)
        if primary_storage_ref is None:
            raise ValueError(f"Knowledge document not found: {document_id}")
        canonical_storage_path = self._write_document_artifacts(
            storage_ref=str(primary_storage_ref),
            source_document=source_document,
        )
        with self.connection() as conn, conn.cursor() as cur:
            # Current builds persist full canonical/source Markdown only. There
            # is no PageTree/node/chunk side table to keep in sync.
            cur.execute(
                """
                UPDATE knowledge_documents
                SET locator_type = %s,
                    status = %s,
                    error = NULL,
                    doc_description = %s,
                    page_count = %s,
                    build_quality = %s,
                    quality_metadata = %s::jsonb,
                    canonical_storage_path = %s,
                    canonical_markdown = %s,
                    updated_at = NOW()
                WHERE id = %s::uuid
                """,
                (
                    source_document.locator_type,
                    "ready_degraded" if source_document.build_quality == "degraded" else "ready",
                    source_document.doc_description,
                    source_document.page_count,
                    source_document.build_quality,
                    json.dumps(source_document.quality_metadata, ensure_ascii=False),
                    canonical_storage_path,
                    source_document.canonical_markdown,
                    document_id,
                ),
            )

    def load_source_document(self, *, document_id: str) -> SourceDocument | None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    display_name,
                    file_name,
                    file_kind,
                    locator_type,
                    page_count,
                    doc_description,
                    build_quality,
                    quality_metadata,
                    canonical_markdown,
                    source_storage_path,
                    markdown_storage_path,
                    canonical_storage_path
                FROM knowledge_documents
                WHERE id = %s::uuid
                  AND status IN ('ready', 'ready_degraded')
                LIMIT 1
                """,
                (document_id,),
            )
            row = cur.fetchone()
        if row is None:
            return None

        canonical_markdown = row[8] or ""
        if not canonical_markdown.strip():
            canonical_markdown = (
                self._read_storage_text(_first_non_empty(row[11], row[10], row[9]))
                or ""
            )
        if not canonical_markdown.strip():
            return None

        return SourceDocument(
            display_name=str(row[0]),
            file_name=str(row[1]),
            file_kind=str(row[2]),
            locator_type=str(row[3]),
            page_count=row[4],
            doc_description=row[5],
            build_quality=str(row[6] or "ready"),
            quality_metadata=row[7] if isinstance(row[7], dict) else {},
            canonical_markdown=canonical_markdown,
        )

    def list_ready_documents_for_workspace_repair(self) -> list[ReadyKnowledgeDocumentForWorkspace]:
        """Return ready documents whose canonical text can rebuild source workspaces.

        The source-only migration intentionally removed compiled wiki/PageTree
        state. Older rows can still be valid if their canonical Markdown exists,
        so the worker reconciles those rows into `workspace/sources/*.md` instead
        of asking operators to re-upload or recompile user documents.
        """

        query = """
            SELECT
                knowledge_base_id::text,
                id::text,
                user_id::text,
                display_name,
                file_name,
                file_kind,
                source_storage_path,
                markdown_storage_path,
                preview_storage_path,
                canonical_storage_path
            FROM knowledge_documents
            WHERE status IN ('ready', 'ready_degraded')
              AND (
                    canonical_markdown IS NOT NULL
                 OR canonical_storage_path IS NOT NULL
              )
            ORDER BY knowledge_base_id::text ASC, created_at ASC, id ASC
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()
        return [
            ReadyKnowledgeDocumentForWorkspace(
                knowledge_base_id=str(row[0]),
                document_id=str(row[1]),
                user_id=str(row[2]),
                display_name=str(row[3]),
                file_name=str(row[4]),
                file_kind=str(row[5]),
                source_storage_path=str(row[6]),
                markdown_storage_path=row[7],
                preview_storage_path=row[8],
                canonical_storage_path=row[9],
            )
            for row in rows
        ]

    def mark_document_error(self, *, document_id: str, error: str) -> None:
        query = """
            UPDATE knowledge_documents
            SET status = 'error',
                error = %s,
                updated_at = NOW()
            WHERE id = %s::uuid
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query, (error[:4000], document_id))

    def list_thread_workspaces(
        self,
        *,
        user_id: str,
        thread_id: str,
        ready_only: bool = False,
    ) -> list[KnowledgeWorkspaceRecord]:
        query = """
            SELECT
                b.id::text,
                b.user_id::text,
                b.name,
                b.description,
                b.source_type,
                b.visibility,
                COUNT(d.id) AS document_count,
                COUNT(d.id) FILTER (WHERE d.status IN ('ready', 'ready_degraded')) AS ready_document_count
            FROM knowledge_thread_bindings t
            JOIN knowledge_bases b ON b.id = t.knowledge_base_id
            LEFT JOIN knowledge_documents d ON d.knowledge_base_id = b.id
            WHERE t.user_id = %s::uuid
              AND t.thread_id = %s
            GROUP BY b.id, b.user_id, b.name, b.description, b.source_type, b.visibility, b.created_at
        """
        if ready_only:
            query += " HAVING COUNT(d.id) FILTER (WHERE d.status IN ('ready', 'ready_degraded')) > 0"
        query += " ORDER BY b.created_at DESC"
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query, (user_id, thread_id))
            rows = cur.fetchall()
        return [
            KnowledgeWorkspaceRecord(
                id=row[0],
                owner_id=row[1],
                name=row[2],
                description=row[3],
                source_type=row[4],
                visibility=row[5],
                document_count=int(row[6] or 0),
                ready_document_count=int(row[7] or 0),
            )
            for row in rows
        ]

    def get_workspace_record(
        self,
        *,
        knowledge_base_id: str,
    ) -> KnowledgeWorkspaceRecord | None:
        query = """
            SELECT
                b.id::text,
                b.user_id::text,
                b.name,
                b.description,
                b.source_type,
                b.visibility,
                COUNT(d.id) AS document_count,
                COUNT(d.id) FILTER (WHERE d.status IN ('ready', 'ready_degraded')) AS ready_document_count
            FROM knowledge_bases b
            LEFT JOIN knowledge_documents d ON d.knowledge_base_id = b.id
            WHERE b.id = %s::uuid
            GROUP BY b.id, b.user_id, b.name, b.description, b.source_type, b.visibility
            LIMIT 1
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query, (knowledge_base_id,))
            row = cur.fetchone()
        if row is None:
            return None
        return KnowledgeWorkspaceRecord(
            id=row[0],
            owner_id=row[1],
            name=row[2],
            description=row[3],
            source_type=row[4],
            visibility=row[5],
            document_count=int(row[6] or 0),
            ready_document_count=int(row[7] or 0),
        )

    def _storage_ref_to_path(self, storage_ref: str) -> Path:
        return self._asset_store.resolve_local_path(storage_ref)

    def _read_storage_text(self, storage_ref: str | None) -> str | None:
        if not storage_ref:
            return None
        try:
            return self._asset_store.read_text(storage_ref)
        except FileNotFoundError:
            return None
        except Exception:
            return None


def _job_summary_from_row(row: tuple[Any, ...] | list[Any] | None) -> KnowledgeBuildJobSummary | None:
    if not row:
        return None
    if row[0] in (None, ""):
        return None
    return KnowledgeBuildJobSummary(
        id=str(row[0]),
        status=str(row[1] or ""),
        stage=row[2],
        message=row[3],
        progress_percent=int(row[4] or 0),
        total_steps=int(row[5] or 0),
        completed_steps=int(row[6] or 0),
        started_at=row[7],
        finished_at=row[8],
        created_at=row[9],
        updated_at=row[10],
    )


def _first_non_empty(*values: str | None) -> str | None:
    for value in values:
        if value is None:
            continue
        stripped = value.strip()
        if stripped:
            return stripped
    return None
