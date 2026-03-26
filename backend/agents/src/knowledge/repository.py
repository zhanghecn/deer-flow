from __future__ import annotations

import json
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import pymupdf

from src.config.paths import VIRTUAL_PATH_PREFIX, get_paths
from src.config.runtime_db import get_runtime_db_store
from src.knowledge import formatters as knowledge_formatters
from src.knowledge.models import (
    CanonicalSourceMapEntry,
    DocumentImageResult,
    DocumentTreeNode,
    DocumentTreeListing,
    IndexedDocument,
    KnowledgeBaseDetail,
    KnowledgeBuildEventRecord,
    KnowledgeBuildJobSummary,
    KnowledgeDocumentRecord,
    KnowledgeToolNextSteps,
    KnowledgeNodeRecord,
    NodeDetailItem,
    NodePageChunk,
    NodeDetailResult,
    first_non_empty,
)

_DETAIL_MULTI_NODE_PAGE_LIMIT = 18
_DETAIL_SINGLE_NODE_PAGE_LIMIT = 40
_DETAIL_MULTI_NODE_LINE_LIMIT = 2500
_DETAIL_SINGLE_NODE_LINE_LIMIT = 8000
_DETAIL_MAX_TOTAL_CHARS = 220000
_MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


class KnowledgeRepository:
    def __init__(self) -> None:
        self._db = get_runtime_db_store()
        self._paths = get_paths()

    @contextmanager
    def connection(self):
        with self._db.connection() as conn:
            yield conn

    def _write_document_artifacts(
        self,
        *,
        storage_ref: str,
        indexed_document: IndexedDocument,
    ) -> tuple[str, str]:
        document_dir = self._storage_ref_to_path(storage_ref).parent
        document_dir.mkdir(parents=True, exist_ok=True)
        canonical_path = document_dir / "canonical.md"
        source_map_path = document_dir / "canonical.map.json"
        canonical_path.write_text(indexed_document.canonical_markdown, encoding="utf-8")
        source_map_path.write_text(
            json.dumps(
                [entry.model_dump(mode="json") for entry in indexed_document.source_map],
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return (
            self._storage_ref(canonical_path),
            self._storage_ref(source_map_path),
        )

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
            VALUES (%s, %s::uuid, %s::uuid)
            ON CONFLICT (thread_id, knowledge_base_id) DO NOTHING
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query, (thread_id, knowledge_base_id, user_id))

    def create_build_job(
        self,
        *,
        knowledge_base_id: str,
        document_id: str,
        user_id: str,
        thread_id: str,
        model_name: str | None,
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
                message,
                model_name
            )
            VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s, %s)
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
                    model_name,
                ),
            )
            row = cur.fetchone()
        if row is None:
            raise RuntimeError("Failed to create knowledge build job.")
        return str(row[0])

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
        build_model_name: str | None,
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
                build_model_name,
                content_sha256
            )
            VALUES (%s, %s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s, 'processing', %s, %s)
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
                build_model_name = EXCLUDED.build_model_name,
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
                    build_model_name,
                    content_sha256,
                ),
            )

    def find_reusable_document_index(
        self,
        *,
        document_id: str,
        file_kind: str,
        content_sha256: str | None,
        build_model_name: str | None,
    ) -> str | None:
        if not content_sha256:
            return None
        query = """
            SELECT id::text
            FROM knowledge_documents
            WHERE id <> %s::uuid
              AND status = 'ready'
              AND file_kind = %s
              AND content_sha256 = %s
              AND node_count > 0
            ORDER BY
                CASE
                    WHEN build_model_name IS NOT DISTINCT FROM %s::text THEN 0
                    WHEN %s::text IS NULL THEN 1
                    ELSE 2
                END,
                updated_at DESC
            LIMIT 1
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                query,
                (
                    document_id,
                    file_kind,
                    content_sha256,
                    build_model_name,
                    build_model_name,
                ),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return str(row[0])

    def replace_document_index(
        self,
        *,
        document_id: str,
        indexed_document: IndexedDocument,
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
        primary_storage_ref = first_non_empty(
            (
                source_storage_path,
                markdown_storage_path,
                preview_storage_path,
            )
        )
        if primary_storage_ref is None:
            raise ValueError(f"Knowledge document not found: {document_id}")
        canonical_storage_path, source_map_storage_path = self._write_document_artifacts(
            storage_ref=str(primary_storage_ref),
            indexed_document=indexed_document,
        )
        source_map_payload = [entry.model_dump(mode="json") for entry in indexed_document.source_map]
        document_index_payload = {
            "document_id": document_id,
            "display_name": indexed_document.display_name,
            "file_name": indexed_document.file_name,
            "file_kind": indexed_document.file_kind,
            "locator_type": indexed_document.locator_type,
            "page_count": indexed_document.page_count,
            "doc_description": indexed_document.doc_description,
            "source_storage_path": source_storage_path,
            "markdown_storage_path": markdown_storage_path,
            "preview_storage_path": preview_storage_path,
            "canonical_storage_path": canonical_storage_path,
            "source_map_storage_path": source_map_storage_path,
            "structure": indexed_document.structure,
            "nodes": [node.model_dump(mode="json") for node in indexed_document.nodes],
        }
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE knowledge_documents
                SET locator_type = %s,
                    status = 'ready',
                    error = NULL,
                    doc_description = %s,
                    page_count = %s,
                    node_count = %s,
                    canonical_storage_path = %s,
                    source_map_storage_path = %s,
                    document_tree = %s::jsonb,
                    canonical_markdown = %s,
                    source_map_json = %s::jsonb,
                    document_index_json = %s::jsonb,
                    updated_at = NOW()
                WHERE id = %s::uuid
                """,
                (
                    indexed_document.locator_type,
                    indexed_document.doc_description,
                    indexed_document.page_count,
                    len(indexed_document.nodes),
                    canonical_storage_path,
                    source_map_storage_path,
                    json.dumps(indexed_document.structure, ensure_ascii=False),
                    indexed_document.canonical_markdown,
                    json.dumps(source_map_payload, ensure_ascii=False),
                    json.dumps(document_index_payload, ensure_ascii=False),
                    document_id,
                ),
            )
            cur.execute(
                "DELETE FROM knowledge_document_nodes WHERE document_id = %s::uuid",
                (document_id,),
            )
            insert_query = """
                INSERT INTO knowledge_document_nodes (
                    document_id,
                    node_id,
                    parent_node_id,
                    node_path,
                    title,
                    depth,
                    child_count,
                    locator_type,
                    page_start,
                    page_end,
                    line_start,
                    line_end,
                    heading_slug,
                    summary,
                    prefix_summary,
                    node_text,
                    excerpt
                )
                VALUES (
                    %s::uuid,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s
                )
            """
            for node in indexed_document.nodes:
                cur.execute(
                    insert_query,
                    (
                        document_id,
                        node.node_id,
                        node.parent_node_id,
                        node.node_path,
                        node.title,
                        node.depth,
                        node.child_count,
                        node.locator_type,
                        node.page_start,
                        node.page_end,
                        node.line_start,
                        node.line_end,
                        node.heading_slug,
                        node.summary,
                        node.prefix_summary,
                        node.node_text,
                        None,
                    ),
                )
        self.export_document_index_snapshot(document_id=document_id)

    def load_indexed_document(self, *, document_id: str) -> IndexedDocument | None:
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
                    document_tree,
                    canonical_markdown,
                    source_map_json,
                    source_storage_path,
                    markdown_storage_path,
                    preview_storage_path,
                    canonical_storage_path,
                    source_map_storage_path
                FROM knowledge_documents
                WHERE id = %s::uuid
                  AND status = 'ready'
                LIMIT 1
                """,
                (document_id,),
            )
            document_row = cur.fetchone()
            if document_row is None:
                return None
            cur.execute(
                """
                SELECT
                    node_id,
                    parent_node_id,
                    node_path,
                    title,
                    depth,
                    child_count,
                    locator_type,
                    page_start,
                    page_end,
                    line_start,
                    line_end,
                    heading_slug,
                    summary,
                    prefix_summary,
                    node_text,
                    excerpt
                FROM knowledge_document_nodes
                WHERE document_id = %s::uuid
                ORDER BY node_path ASC
                """,
                (document_id,),
            )
            node_rows = cur.fetchall()

        structure = document_row[6] if isinstance(document_row[6], list) else []
        canonical_markdown = document_row[7]
        if not canonical_markdown:
            canonical_markdown = (
                self._read_storage_text(
                    first_non_empty(
                        (
                            document_row[12],
                            document_row[10],
                            document_row[9],
                        )
                    )
                )
                or ""
            )
        source_map_payload = document_row[8] if isinstance(document_row[8], list) else None
        if source_map_payload is None:
            source_map_payload = self._read_storage_json(document_row[13]) or []

        if not canonical_markdown.strip() and not node_rows:
            return None

        return IndexedDocument(
            display_name=str(document_row[0]),
            file_name=str(document_row[1]),
            file_kind=str(document_row[2]),
            locator_type=str(document_row[3]),
            page_count=document_row[4],
            doc_description=document_row[5],
            structure=structure,
            nodes=[
                DocumentTreeNode(
                    node_id=row[0],
                    parent_node_id=row[1],
                    node_path=row[2],
                    title=row[3],
                    depth=int(row[4]),
                    child_count=int(row[5]),
                    locator_type=row[6],
                    page_start=row[7],
                    page_end=row[8],
                    line_start=row[9],
                    line_end=row[10],
                    heading_slug=row[11],
                    summary=row[12],
                    prefix_summary=row[13],
                    node_text=row[14],
                    excerpt=row[15],
                )
                for row in node_rows
            ],
            canonical_markdown=canonical_markdown,
            source_map=[CanonicalSourceMapEntry.model_validate(entry) for entry in source_map_payload],
        )

    def export_document_index_snapshot(self, *, document_id: str) -> Path | None:
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
                    source_storage_path,
                    markdown_storage_path,
                    preview_storage_path,
                    canonical_storage_path,
                    source_map_storage_path,
                    document_tree
                FROM knowledge_documents
                WHERE id = %s::uuid
                LIMIT 1
                """,
                (document_id,),
            )
            document_row = cur.fetchone()
            if document_row is None:
                return None

            cur.execute(
                """
                SELECT
                    node_id,
                    parent_node_id,
                    node_path,
                    title,
                    depth,
                    child_count,
                    locator_type,
                    page_start,
                    page_end,
                    line_start,
                    line_end,
                    heading_slug,
                    summary,
                    prefix_summary,
                    node_text,
                    excerpt
                FROM knowledge_document_nodes
                WHERE document_id = %s::uuid
                ORDER BY node_path ASC
                """,
                (document_id,),
            )
            node_rows = cur.fetchall()

        display_name = str(document_row[0])
        file_name = str(document_row[1])
        file_kind = str(document_row[2])
        locator_type = str(document_row[3])
        page_count = document_row[4]
        doc_description = document_row[5]
        source_storage_path = document_row[6]
        markdown_storage_path = document_row[7]
        preview_storage_path = document_row[8]
        canonical_storage_path = document_row[9]
        source_map_storage_path = document_row[10]
        structure = document_row[11] or []

        storage_ref = first_non_empty((source_storage_path, markdown_storage_path, preview_storage_path))
        if storage_ref is None:
            return None

        document_dir = self._storage_ref_to_path(storage_ref).parent
        document_dir.mkdir(parents=True, exist_ok=True)
        snapshot_path = document_dir / "document_index.json"
        payload = {
            "document_id": document_id,
            "display_name": display_name,
            "file_name": file_name,
            "file_kind": file_kind,
            "locator_type": locator_type,
            "page_count": page_count,
            "doc_description": doc_description,
            "source_storage_path": source_storage_path,
            "markdown_storage_path": markdown_storage_path,
            "preview_storage_path": preview_storage_path,
            "canonical_storage_path": canonical_storage_path,
            "source_map_storage_path": source_map_storage_path,
            "structure": structure,
            "nodes": [
                {
                    "node_id": row[0],
                    "parent_node_id": row[1],
                    "node_path": row[2],
                    "title": row[3],
                    "depth": int(row[4]),
                    "child_count": int(row[5]),
                    "locator_type": row[6],
                    "page_start": row[7],
                    "page_end": row[8],
                    "line_start": row[9],
                    "line_end": row[10],
                    "heading_slug": row[11],
                    "summary": row[12],
                    "prefix_summary": row[13],
                    "node_text": row[14],
                    "excerpt": row[15],
                }
                for row in node_rows
            ],
        }
        snapshot_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return snapshot_path

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

    def list_thread_documents(
        self,
        *,
        user_id: str,
        thread_id: str,
        ready_only: bool = False,
    ) -> list[KnowledgeDocumentRecord]:
        query = """
            SELECT
                d.id::text,
                d.knowledge_base_id::text,
                b.name,
                b.description,
                d.display_name,
                d.file_kind,
                d.locator_type,
                d.status,
                d.doc_description,
                d.error,
                d.page_count,
                d.node_count,
                d.source_storage_path,
                d.markdown_storage_path,
                d.preview_storage_path,
                d.canonical_storage_path,
                d.source_map_storage_path,
                j.id::text,
                j.status,
                j.stage,
                j.message,
                j.progress_percent,
                j.total_steps,
                j.completed_steps,
                j.model_name,
                j.started_at::text,
                j.finished_at::text,
                j.created_at::text,
                j.updated_at::text
            FROM knowledge_thread_bindings t
            JOIN knowledge_bases b ON b.id = t.knowledge_base_id
            JOIN knowledge_documents d ON d.knowledge_base_id = b.id
            LEFT JOIN LATERAL (
                SELECT *
                FROM knowledge_build_jobs j
                WHERE j.document_id = d.id
                ORDER BY j.created_at DESC
                LIMIT 1
            ) j ON TRUE
            WHERE t.user_id = %s::uuid
              AND t.thread_id = %s
        """
        params: list[Any] = [user_id, thread_id]
        if ready_only:
            query += " AND d.status = 'ready'"
        query += " ORDER BY b.created_at DESC, d.created_at ASC"

        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

        return [
            KnowledgeDocumentRecord(
                id=row[0],
                knowledge_base_id=row[1],
                knowledge_base_name=row[2],
                knowledge_base_description=row[3],
                display_name=row[4],
                file_kind=row[5],
                locator_type=row[6],
                status=row[7],
                doc_description=row[8],
                error=row[9],
                page_count=row[10],
                node_count=int(row[11] or 0),
                source_storage_path=row[12],
                markdown_storage_path=row[13],
                preview_storage_path=row[14],
                canonical_storage_path=row[15],
                source_map_storage_path=row[16],
                latest_build_job=_job_summary_from_row(row[17:29]),
            )
            for row in rows
        ]

    def resolve_thread_document(
        self,
        *,
        user_id: str,
        thread_id: str,
        document_name_or_id: str,
    ) -> KnowledgeDocumentRecord | None:
        candidate = document_name_or_id.strip()
        if not candidate:
            return None
        query = """
            SELECT
                d.id::text,
                d.knowledge_base_id::text,
                b.name,
                b.description,
                d.display_name,
                d.file_kind,
                d.locator_type,
                d.status,
                d.doc_description,
                d.error,
                d.page_count,
                d.node_count,
                d.source_storage_path,
                d.markdown_storage_path,
                d.preview_storage_path,
                d.canonical_storage_path,
                d.source_map_storage_path,
                j.id::text,
                j.status,
                j.stage,
                j.message,
                j.progress_percent,
                j.total_steps,
                j.completed_steps,
                j.model_name,
                j.started_at::text,
                j.finished_at::text,
                j.created_at::text,
                j.updated_at::text
            FROM knowledge_thread_bindings t
            JOIN knowledge_bases b ON b.id = t.knowledge_base_id
            JOIN knowledge_documents d ON d.knowledge_base_id = b.id
            LEFT JOIN LATERAL (
                SELECT *
                FROM knowledge_build_jobs j
                WHERE j.document_id = d.id
                ORDER BY j.created_at DESC
                LIMIT 1
            ) j ON TRUE
            WHERE t.user_id = %s::uuid
              AND t.thread_id = %s
              AND d.status = 'ready'
              AND (
                  d.id::text = %s
                  OR LOWER(d.display_name) = LOWER(%s)
                  OR LOWER(d.file_name) = LOWER(%s)
              )
            LIMIT 1
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query, (user_id, thread_id, candidate, candidate, candidate))
            row = cur.fetchone()
        if row is None:
            return None
        return KnowledgeDocumentRecord(
            id=row[0],
            knowledge_base_id=row[1],
            knowledge_base_name=row[2],
            knowledge_base_description=row[3],
            display_name=row[4],
            file_kind=row[5],
            locator_type=row[6],
            status=row[7],
            doc_description=row[8],
            error=row[9],
            page_count=row[10],
            node_count=int(row[11] or 0),
            source_storage_path=row[12],
            markdown_storage_path=row[13],
            preview_storage_path=row[14],
            canonical_storage_path=row[15],
            source_map_storage_path=row[16],
            latest_build_job=_job_summary_from_row(row[17:29]),
        )

    def get_document_tree(
        self,
        *,
        document: KnowledgeDocumentRecord,
        node_id: str | None,
        max_depth: int,
    ) -> DocumentTreeListing:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT document_tree
                FROM knowledge_documents
                WHERE id = %s::uuid
                LIMIT 1
                """,
                (document.id,),
            )
            row = cur.fetchone()
        structure = row[0] if row is not None else []
        subtree = _subtree_for_node(structure or [], node_id=node_id)
        limited_tree = _limit_tree_depth(subtree, depth=max(1, min(max_depth, 6)))

        return DocumentTreeListing(
            document=document,
            node_id=node_id,
            max_depth=max_depth,
            tree=limited_tree,
        )

    def get_node_detail(
        self,
        *,
        document: KnowledgeDocumentRecord,
        node_id: str,
    ) -> KnowledgeNodeRecord | None:
        query = """
            SELECT
                document_id::text,
                node_id,
                parent_node_id,
                node_path,
                title,
                depth,
                child_count,
                locator_type,
                page_start,
                page_end,
                line_start,
                line_end,
                heading_slug,
                summary,
                prefix_summary,
                node_text,
                excerpt
            FROM knowledge_document_nodes
            WHERE document_id = %s::uuid
              AND node_id = %s
            LIMIT 1
        """
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(query, (document.id, node_id))
            row = cur.fetchone()
        if row is None:
            return None
        return KnowledgeNodeRecord(
            document_id=row[0],
            node_id=row[1],
            parent_node_id=row[2],
            node_path=row[3],
            title=row[4],
            depth=int(row[5]),
            child_count=int(row[6]),
            locator_type=row[7],
            page_start=row[8],
            page_end=row[9],
            line_start=row[10],
            line_end=row[11],
            heading_slug=row[12],
            summary=row[13],
            prefix_summary=row[14],
            node_text=row[15],
            excerpt=row[16],
        )

    def get_node_details(
        self,
        *,
        document: KnowledgeDocumentRecord,
        node_ids: list[str],
    ) -> list[KnowledgeNodeRecord]:
        results: list[KnowledgeNodeRecord] = []
        for node_id in node_ids:
            node = self.get_node_detail(document=document, node_id=node_id)
            if node is not None:
                results.append(node)
        return results

    def build_node_detail_result(
        self,
        *,
        thread_id: str,
        document: KnowledgeDocumentRecord,
        nodes: list[KnowledgeNodeRecord],
        requested_node_ids: list[str],
    ) -> NodeDetailResult:
        artifact_path = self.materialize_document_preview(thread_id=thread_id, document=document)
        self._validate_node_detail_request(document=document, nodes=nodes)

        items: list[NodeDetailItem] = []
        total_chars = 0
        for node in nodes:
            item = self._build_node_detail_item(
                thread_id=thread_id,
                document=document,
                node=node,
                artifact_path=artifact_path,
            )
            total_chars += len(item.text or "")
            total_chars += sum(len(chunk.text) for chunk in item.page_chunks)
            if total_chars > _DETAIL_MAX_TOTAL_CHARS:
                raise ValueError("Requested node detail is too large. Inspect a narrower subtree with get_document_tree(document_name_or_id=..., node_id=...) and then fetch fewer nodes.")
            items.append(item)

        requested_pages = _page_range_label_from_nodes(nodes)
        returned_pages = requested_pages if document.locator_type == "page" else None
        returned_lines = _line_range_label_from_nodes(nodes) if document.locator_type == "heading" else None
        next_steps = self._build_node_detail_next_steps(document=document, items=items)
        return NodeDetailResult(
            document=document,
            requested_node_ids=requested_node_ids,
            items=items,
            total_pages=document.page_count,
            requested_pages=requested_pages,
            returned_pages=returned_pages,
            returned_lines=returned_lines,
            next_steps=next_steps,
        )

    def build_document_image_result(
        self,
        *,
        thread_id: str,
        document: KnowledgeDocumentRecord,
        page_number: int,
    ) -> DocumentImageResult:
        image_path, embedded_image_count = self.materialize_document_page_image(
            thread_id=thread_id,
            document=document,
            page_number=page_number,
        )
        return DocumentImageResult(
            document=document,
            page_number=page_number,
            image_path=image_path,
            embedded_image_count=embedded_image_count,
            next_steps=KnowledgeToolNextSteps(
                summary=f"Exported a page image for {document.display_name} page {page_number}.",
                options=[
                    "Use view_image(image_path=...) when the model supports vision and you need to inspect the page visually.",
                    "Use get_document_tree_node_detail(...) to read the grounded text for nearby nodes before answering.",
                    "Copy citation_markdown from node detail results instead of inventing image citations.",
                ],
            ),
        )

    def materialize_document_preview(
        self,
        *,
        thread_id: str,
        document: KnowledgeDocumentRecord,
    ) -> str:
        if document.locator_type == "page":
            source_ref = document.preview_storage_path or document.source_storage_path or document.markdown_storage_path
        else:
            source_ref = document.markdown_storage_path or document.source_storage_path
        source_path = self._storage_ref_to_path(source_ref)
        target_dir = self._paths.sandbox_outputs_dir(thread_id) / ".knowledge" / document.id
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / source_path.name
        if not target_path.exists() or target_path.stat().st_mtime < source_path.stat().st_mtime:
            target_path.write_bytes(source_path.read_bytes())
        relative = target_path.relative_to(self._paths.sandbox_outputs_dir(thread_id))
        return f"{VIRTUAL_PATH_PREFIX}/outputs/{relative.as_posix()}"

    def materialize_document_page_image(
        self,
        *,
        thread_id: str,
        document: KnowledgeDocumentRecord,
        page_number: int,
    ) -> tuple[str, int]:
        if document.locator_type != "page":
            raise ValueError(f"Document '{document.display_name}' does not support page images.")
        pdf_ref = document.preview_storage_path or document.source_storage_path
        if not pdf_ref:
            raise ValueError(f"Document '{document.display_name}' has no previewable PDF source.")
        pdf_path = self._storage_ref_to_path(pdf_ref)
        doc = pymupdf.open(pdf_path)
        try:
            if page_number < 1 or page_number > doc.page_count:
                raise ValueError(f"Page {page_number} is out of range for '{document.display_name}' (1-{doc.page_count}).")
            page = doc.load_page(page_number - 1)
            embedded_image_count = len(page.get_images(full=True))
            target_dir = self._paths.sandbox_outputs_dir(thread_id) / ".knowledge" / document.id / "pages"
            target_dir.mkdir(parents=True, exist_ok=True)
            target_path = target_dir / f"page-{page_number:04d}.png"
            if not target_path.exists() or target_path.stat().st_mtime < pdf_path.stat().st_mtime:
                pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
                pix.save(target_path)
        finally:
            doc.close()
        relative = target_path.relative_to(self._paths.sandbox_outputs_dir(thread_id))
        return f"{VIRTUAL_PATH_PREFIX}/outputs/{relative.as_posix()}", embedded_image_count

    def _build_node_detail_item(
        self,
        *,
        thread_id: str,
        document: KnowledgeDocumentRecord,
        node: KnowledgeNodeRecord,
        artifact_path: str,
    ) -> NodeDetailItem:
        page_chunks: list[NodePageChunk] = []
        text: str | None
        citation_markdown: str | None
        if document.locator_type == "heading":
            text = self._extract_heading_node_text(document=document, node=node)
            text, image_paths = self._rewrite_markdown_image_paths(
                thread_id=thread_id,
                document=document,
                text=text,
            )
            locator_label = self._locator_label(document=document, node=node)
            citation_markdown = self._build_citation_markdown(
                artifact_path=artifact_path,
                document=document,
                node=node,
                locator_label=locator_label,
            )
        else:
            page_chunks = self._extract_page_chunks(
                thread_id=thread_id,
                artifact_path=artifact_path,
                document=document,
                node=node,
            )
            text = "\n\n".join(f"[Page {chunk.page_number}]\n{chunk.text}".strip() for chunk in page_chunks if chunk.text.strip()).strip()
            citation_markdown = page_chunks[0].citation_markdown if len(page_chunks) == 1 else None
            image_paths = [path for chunk in page_chunks for path in chunk.image_paths]

        return NodeDetailItem(
            node_id=node.node_id,
            parent_node_id=node.parent_node_id,
            title=node.title,
            child_count=node.child_count,
            page_start=node.page_start,
            page_end=node.page_end,
            line_start=node.line_start,
            line_end=node.line_end,
            heading_slug=node.heading_slug,
            summary=node.summary,
            prefix_summary=node.prefix_summary,
            citation_markdown=citation_markdown,
            text=text,
            image_paths=image_paths,
            page_chunks=page_chunks,
        )

    def _validate_node_detail_request(
        self,
        *,
        document: KnowledgeDocumentRecord,
        nodes: list[KnowledgeNodeRecord],
    ) -> None:
        if not nodes:
            raise ValueError("At least one valid node_id is required.")

        if len(nodes) == 1 and nodes[0].parent_node_id is None and nodes[0].child_count > 0:
            raise ValueError("The requested node is a root branch with many descendants. Use get_document_tree(document_name_or_id=..., node_id=...) to inspect a narrower subtree first.")

        if document.locator_type == "page":
            total_pages = sum(_page_span(node) for node in nodes)
            limit = _DETAIL_SINGLE_NODE_PAGE_LIMIT if len(nodes) == 1 and nodes[0].parent_node_id is not None else _DETAIL_MULTI_NODE_PAGE_LIMIT
            if total_pages > limit:
                raise ValueError(f"Requested node detail spans {total_pages} pages, which exceeds the limit of {limit}. Inspect a narrower subtree or request fewer nodes.")
            return

        total_lines = sum(_line_span(node) for node in nodes)
        limit = _DETAIL_SINGLE_NODE_LINE_LIMIT if len(nodes) == 1 and nodes[0].parent_node_id is not None else _DETAIL_MULTI_NODE_LINE_LIMIT
        if total_lines > limit:
            raise ValueError(f"Requested node detail spans {total_lines} lines, which exceeds the limit of {limit}. Inspect a narrower subtree or request fewer nodes.")

    def _extract_heading_node_text(
        self,
        *,
        document: KnowledgeDocumentRecord,
        node: KnowledgeNodeRecord,
    ) -> str:
        if node.node_text:
            return node.node_text
        markdown_path = self._storage_ref_to_path(document.canonical_storage_path or document.markdown_storage_path or document.source_storage_path)
        lines = markdown_path.read_text(encoding="utf-8").splitlines()
        bounded_line_start = node.line_start or 1
        bounded_line_end = node.line_end or len(lines)
        start = max(bounded_line_start - 1, 0)
        end = bounded_line_end
        return "\n".join(lines[start:end]).strip()

    def _extract_page_chunks(
        self,
        *,
        thread_id: str,
        artifact_path: str,
        document: KnowledgeDocumentRecord,
        node: KnowledgeNodeRecord,
    ) -> list[NodePageChunk]:
        if node.page_start is None or node.page_end is None:
            return []
        pdf_ref = document.preview_storage_path or document.source_storage_path
        if not pdf_ref:
            return []
        pdf_path = self._storage_ref_to_path(pdf_ref)
        doc = pymupdf.open(pdf_path)
        chunks: list[NodePageChunk] = []
        try:
            for page_number in range(node.page_start, node.page_end + 1):
                if page_number < 1 or page_number > doc.page_count:
                    continue
                page = doc.load_page(page_number - 1)
                page_node = node.model_copy(update={"page_start": page_number, "page_end": page_number})
                locator_label = f"{document.display_name} p.{page_number}"
                page_text = page.get_text("text").strip()
                page_text, image_paths = self._rewrite_markdown_image_paths(
                    thread_id=thread_id,
                    document=document,
                    text=self._canonical_page_text(
                        document=document,
                        fallback_text=page_text,
                        page_number=page_number,
                    ),
                )
                chunks.append(
                    NodePageChunk(
                        page_number=page_number,
                        text=page_text,
                        citation_markdown=self._build_citation_markdown(
                            artifact_path=artifact_path,
                            document=document,
                            node=page_node,
                            locator_label=locator_label,
                            page_number=page_number,
                        ),
                        embedded_image_count=len(page.get_images(full=True)),
                        image_paths=image_paths,
                    )
                )
        finally:
            doc.close()
        return chunks

    def _canonical_page_text(
        self,
        *,
        document: KnowledgeDocumentRecord,
        fallback_text: str,
        page_number: int,
    ) -> str:
        canonical_ref = document.canonical_storage_path
        if not canonical_ref:
            return fallback_text
        canonical_path = self._storage_ref_to_path(canonical_ref)
        if not canonical_path.is_file():
            return fallback_text
        content = canonical_path.read_text(encoding="utf-8")
        marker = f"<!-- OA_PAGE {page_number} -->"
        if marker not in content:
            return fallback_text
        _, remainder = content.split(marker, 1)
        next_marker = re.search(r"<!-- OA_PAGE \d+ -->", remainder)
        section = remainder[: next_marker.start()] if next_marker else remainder
        lines = section.splitlines()
        filtered_lines: list[str] = []
        header_skipped = False
        for line in lines:
            stripped = line.strip()
            if not header_skipped and stripped.startswith("## Page "):
                header_skipped = True
                continue
            filtered_lines.append(line)
        result = "\n".join(filtered_lines).strip()
        return result or fallback_text

    def _rewrite_markdown_image_paths(
        self,
        *,
        thread_id: str,
        document: KnowledgeDocumentRecord,
        text: str,
    ) -> tuple[str, list[str]]:
        if not text.strip():
            return text, []

        base_path = self._document_text_base_path(document)
        image_paths: list[str] = []

        def replace(match: re.Match[str]) -> str:
            alt_text = match.group(1)
            raw_target = match.group(2).strip()
            if not raw_target or raw_target.startswith(("http://", "https://", "data:", "kb://", "/mnt/user-data/")):
                if raw_target.startswith("/mnt/user-data/"):
                    image_paths.append(raw_target)
                return match.group(0)
            resolved = (base_path / raw_target).resolve()
            if not resolved.is_file():
                return match.group(0)
            virtual_path = self._materialize_document_image_asset(
                thread_id=thread_id,
                document=document,
                source_path=resolved,
            )
            image_paths.append(virtual_path)
            return f"![{alt_text}]({virtual_path})"

        rewritten = _MARKDOWN_IMAGE_RE.sub(replace, text)
        deduped: list[str] = []
        seen: set[str] = set()
        for path in image_paths:
            if path in seen:
                continue
            seen.add(path)
            deduped.append(path)
        return rewritten, deduped

    def _materialize_document_image_asset(
        self,
        *,
        thread_id: str,
        document: KnowledgeDocumentRecord,
        source_path: Path,
    ) -> str:
        target_dir = self._paths.sandbox_outputs_dir(thread_id) / ".knowledge" / document.id / "images"
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / source_path.name
        if not target_path.exists() or target_path.stat().st_mtime < source_path.stat().st_mtime:
            target_path.write_bytes(source_path.read_bytes())
        relative = target_path.relative_to(self._paths.sandbox_outputs_dir(thread_id))
        return f"{VIRTUAL_PATH_PREFIX}/outputs/{relative.as_posix()}"

    def _document_text_base_path(self, document: KnowledgeDocumentRecord) -> Path:
        base_ref = document.canonical_storage_path or document.markdown_storage_path or document.preview_storage_path or document.source_storage_path
        return self._storage_ref_to_path(base_ref).parent

    def _locator_label(
        self,
        *,
        document: KnowledgeDocumentRecord,
        node: KnowledgeNodeRecord,
    ) -> str:
        if document.locator_type == "heading":
            return f"{document.display_name} · {node.title}"
        if node.page_start and node.page_end and node.page_end != node.page_start:
            return f"{document.display_name} p.{node.page_start}-{node.page_end}"
        if node.page_start:
            return f"{document.display_name} p.{node.page_start}"
        return f"{document.display_name} · {node.title}"

    def _build_citation_markdown(
        self,
        *,
        artifact_path: str,
        document: KnowledgeDocumentRecord,
        node: KnowledgeNodeRecord,
        locator_label: str,
        page_number: int | None = None,
        line_number: int | None = None,
    ) -> str:
        return f"[citation:{locator_label}]({self._build_citation_url(artifact_path=artifact_path, document=document, node=node, locator_label=locator_label, page_number=page_number, line_number=line_number)})"

    def _build_citation_url(
        self,
        *,
        artifact_path: str,
        document: KnowledgeDocumentRecord,
        node: KnowledgeNodeRecord,
        locator_label: str,
        page_number: int | None = None,
        line_number: int | None = None,
    ) -> str:
        params = {
            "artifact_path": artifact_path,
            "document_id": document.id,
            "document_name": document.display_name,
            "locator_label": locator_label,
            "locator_type": document.locator_type,
            "node_id": node.node_id,
        }
        if page_number is not None:
            params["page"] = str(page_number)
        elif node.page_start is not None:
            params["page"] = str(node.page_start)
        if node.heading_slug:
            params["heading"] = node.heading_slug
        if line_number is not None:
            params["line"] = str(line_number)
        elif node.line_start is not None:
            params["line"] = str(node.line_start)
        return f"kb://citation?{urlencode(params)}"

    def _build_node_detail_next_steps(
        self,
        *,
        document: KnowledgeDocumentRecord,
        items: list[NodeDetailItem],
    ) -> KnowledgeToolNextSteps:
        total_pages = sum(len(item.page_chunks) for item in items)
        image_pages = sum(1 for item in items for chunk in item.page_chunks if chunk.embedded_image_count > 0)
        summary = f"Successfully retrieved content for {len(items)} nodes covering {total_pages} pages." if document.locator_type == "page" else f"Successfully retrieved content for {len(items)} nodes."
        options = [
            "Use get_document_tree(document_name_or_id=..., node_id=...) to inspect child branches when a node still covers too much content.",
            "Quote the smallest matching node or page chunk, then copy its citation_markdown exactly.",
        ]
        if document.locator_type == "page":
            options.append("For page-based PDFs, prefer a single page chunk citation when the answer comes from one page.")
        if image_pages > 0:
            options.append("If returned text includes image_paths, use view_image(image_path=...) to inspect the exact figure. Use get_document_image(document_name_or_id=..., page_number=...) when you need the full page visual context.")
        return KnowledgeToolNextSteps(summary=summary, options=options)

    def _storage_ref_to_path(self, storage_ref: str) -> Path:
        return (self._paths.base_dir / storage_ref).resolve()

    def _storage_ref(self, absolute_path: Path) -> str:
        relative = absolute_path.resolve().relative_to(self._paths.base_dir.resolve())
        return relative.as_posix()

    def _read_storage_text(self, storage_ref: str | None) -> str | None:
        if not storage_ref:
            return None
        path = self._storage_ref_to_path(storage_ref)
        if not path.is_file():
            return None
        return path.read_text(encoding="utf-8")

    def _read_storage_json(self, storage_ref: str | None) -> Any | None:
        text = self._read_storage_text(storage_ref)
        if not text:
            return None
        try:
            return json.loads(text)
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
        model_name=row[7],
        started_at=row[8],
        finished_at=row[9],
        created_at=row[10],
        updated_at=row[11],
    )


def _subtree_for_node(structure: list[dict], *, node_id: str | None) -> list[dict]:
    if not node_id:
        return structure
    for item in structure:
        if str(item.get("node_id") or "") == node_id:
            return [item]
        children = item.get("nodes")
        if isinstance(children, list):
            found = _subtree_for_node(children, node_id=node_id)
            if found:
                return found
    return []


def _limit_tree_depth(structure: list[dict], *, depth: int) -> list[dict]:
    if depth <= 0:
        return []
    result: list[dict] = []
    for item in structure:
        payload = {key: value for key, value in item.items() if key != "nodes"}
        children = item.get("nodes")
        child_count = len(children) if isinstance(children, list) else 0
        payload["child_count"] = child_count
        returned_children: list[dict] = []
        if isinstance(children, list) and depth > 1:
            returned_children = _limit_tree_depth(children, depth=depth - 1)
            payload["nodes"] = returned_children
        payload["returned_child_count"] = len(returned_children)
        payload["remaining_child_count"] = max(child_count - len(returned_children), 0)
        payload["has_more_children"] = payload["remaining_child_count"] > 0
        result.append(payload)
    return result


def format_tree_listing_payload(listing: DocumentTreeListing) -> str:
    return knowledge_formatters.format_tree_listing_payload(listing)


def format_documents_payload(documents: list[KnowledgeDocumentRecord]) -> str:
    return knowledge_formatters.format_documents_payload(documents)


def format_node_detail_payload(result: NodeDetailResult) -> str:
    return knowledge_formatters.format_node_detail_payload(result)


def format_document_image_payload(result: DocumentImageResult) -> str:
    return knowledge_formatters.format_document_image_payload(result)


def _page_span(node: KnowledgeNodeRecord) -> int:
    if node.page_start is None or node.page_end is None:
        return 0
    return max(node.page_end - node.page_start + 1, 0)


def _line_span(node: KnowledgeNodeRecord) -> int:
    if node.line_start is None or node.line_end is None:
        return 0
    return max(node.line_end - node.line_start + 1, 0)


def _compact_ranges(values: list[int]) -> str | None:
    if not values:
        return None
    ordered = sorted(set(values))
    ranges: list[str] = []
    start = ordered[0]
    end = ordered[0]
    for value in ordered[1:]:
        if value == end + 1:
            end = value
            continue
        ranges.append(f"{start}-{end}" if start != end else str(start))
        start = end = value
    ranges.append(f"{start}-{end}" if start != end else str(start))
    return ", ".join(ranges)


def _page_range_label_from_nodes(nodes: list[KnowledgeNodeRecord]) -> str | None:
    pages: list[int] = []
    for node in nodes:
        if node.page_start is None or node.page_end is None:
            continue
        pages.extend(range(node.page_start, node.page_end + 1))
    return _compact_ranges(pages)


def _line_range_label_from_nodes(nodes: list[KnowledgeNodeRecord]) -> str | None:
    lines: list[int] = []
    for node in nodes:
        if node.line_start is None or node.line_end is None:
            continue
        lines.extend(range(node.line_start, node.line_end + 1))
    return _compact_ranges(lines)
