from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from src.config.paths import Paths, get_paths
from src.config.runtime_db import get_runtime_db_store
from src.knowledge.storage import KnowledgeAssetStore, get_knowledge_asset_store


_PACKAGE_SUBDIR_NAMES = frozenset({"source", "preview", "markdown", "canonical", "index", "assets"})
_STORAGE_REF_FIELDS = (
    "source_storage_path",
    "markdown_storage_path",
    "preview_storage_path",
    "canonical_storage_path",
    "source_map_storage_path",
)


@dataclass(frozen=True)
class KnowledgeDocumentStorageSnapshot:
    document_id: str
    source_storage_path: str
    markdown_storage_path: str | None = None
    preview_storage_path: str | None = None
    canonical_storage_path: str | None = None
    source_map_storage_path: str | None = None
    document_index_json: dict[str, Any] | None = None

    def storage_refs(self) -> dict[str, str | None]:
        return {
            "source_storage_path": self.source_storage_path,
            "markdown_storage_path": self.markdown_storage_path,
            "preview_storage_path": self.preview_storage_path,
            "canonical_storage_path": self.canonical_storage_path,
            "source_map_storage_path": self.source_map_storage_path,
        }

    def needs_migration(self) -> bool:
        return any(value and not str(value).strip().startswith("s3://") for value in self.storage_refs().values())


@dataclass(frozen=True)
class MigratedKnowledgeDocumentStorage:
    document_id: str
    source_storage_path: str
    markdown_storage_path: str | None
    preview_storage_path: str | None
    canonical_storage_path: str | None
    source_map_storage_path: str | None
    document_index_json: dict[str, Any] | None
    uploaded_file_count: int
    package_root_key: str


def migrate_document_package(
    *,
    paths: Paths,
    asset_store: KnowledgeAssetStore,
    snapshot: KnowledgeDocumentStorageSnapshot,
    dry_run: bool = False,
) -> MigratedKnowledgeDocumentStorage:
    """Upload one filesystem-backed KB package into the configured object store.

    This migration is intentionally explicit: callers must opt into an object-store
    backend first so production cannot silently keep using local disk.
    """

    if not getattr(asset_store, "uses_object_store", False):
        raise ValueError("Knowledge storage migration requires an object-store backend.")

    base_ref = _first_non_empty(snapshot.storage_refs().values())
    if base_ref is None:
        raise ValueError(f"Document {snapshot.document_id} has no storage refs to migrate.")

    package_root_key = _package_root_key(_relative_key_for_ref(paths, base_ref))
    package_root_path = paths.base_dir / package_root_key
    if not package_root_path.is_dir():
        raise FileNotFoundError(f"Knowledge package directory not found: {package_root_path}")

    migrated_refs: dict[str, str | None] = {}
    for field_name, storage_ref in snapshot.storage_refs().items():
        if storage_ref is None:
            migrated_refs[field_name] = None
            continue
        migrated_refs[field_name] = asset_store.storage_ref_from_relative_path(
            _relative_key_for_ref(paths, storage_ref)
        )

    uploaded_file_count = 0
    for current_path in sorted(package_root_path.rglob("*")):
        if not current_path.is_file():
            continue
        relative_key = current_path.relative_to(paths.base_dir).as_posix()
        target_ref = asset_store.storage_ref_from_relative_path(relative_key)
        if not dry_run:
            asset_store.sync_local_file(storage_ref=target_ref, local_path=current_path)
        uploaded_file_count += 1

    updated_document_index = _rewrite_document_index_json(snapshot.document_index_json, migrated_refs)
    target_document_index_ref = asset_store.storage_ref_from_relative_path(
        PurePosixPath(package_root_key, "index", "document_index.json").as_posix()
    )
    if updated_document_index is not None and not dry_run:
        asset_store.write_text(
            storage_ref=target_document_index_ref,
            text=json.dumps(updated_document_index, ensure_ascii=False, indent=2),
        )

    return MigratedKnowledgeDocumentStorage(
        document_id=snapshot.document_id,
        source_storage_path=str(migrated_refs["source_storage_path"]),
        markdown_storage_path=migrated_refs["markdown_storage_path"],
        preview_storage_path=migrated_refs["preview_storage_path"],
        canonical_storage_path=migrated_refs["canonical_storage_path"],
        source_map_storage_path=migrated_refs["source_map_storage_path"],
        document_index_json=updated_document_index,
        uploaded_file_count=uploaded_file_count,
        package_root_key=package_root_key,
    )


def migrate_all_documents(*, paths: Paths | None = None, dry_run: bool = False) -> list[MigratedKnowledgeDocumentStorage]:
    paths = paths or get_paths()
    asset_store = get_knowledge_asset_store(paths)
    if not asset_store.uses_object_store:
        raise RuntimeError("Set KNOWLEDGE_OBJECT_STORE=minio before running KB storage migration.")

    db = get_runtime_db_store()
    query = """
        SELECT
            id::text,
            source_storage_path,
            markdown_storage_path,
            preview_storage_path,
            canonical_storage_path,
            source_map_storage_path,
            document_index_json
        FROM knowledge_documents
        ORDER BY created_at ASC, id ASC
    """

    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(query)
        rows = cur.fetchall()

    migrated: list[MigratedKnowledgeDocumentStorage] = []
    for row in rows:
        snapshot = KnowledgeDocumentStorageSnapshot(
            document_id=str(row[0]),
            source_storage_path=str(row[1]),
            markdown_storage_path=row[2],
            preview_storage_path=row[3],
            canonical_storage_path=row[4],
            source_map_storage_path=row[5],
            document_index_json=row[6] if isinstance(row[6], dict) else None,
        )
        if not snapshot.needs_migration():
            continue

        result = migrate_document_package(
            paths=paths,
            asset_store=asset_store,
            snapshot=snapshot,
            dry_run=dry_run,
        )
        migrated.append(result)

        if dry_run:
            continue

        updated_document_index = result.document_index_json or snapshot.document_index_json or {}
        with db.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE knowledge_documents
                SET source_storage_path = %s,
                    markdown_storage_path = %s,
                    preview_storage_path = %s,
                    canonical_storage_path = %s,
                    source_map_storage_path = %s,
                    document_index_json = %s::jsonb,
                    updated_at = NOW()
                WHERE id = %s::uuid
                """,
                (
                    result.source_storage_path,
                    result.markdown_storage_path,
                    result.preview_storage_path,
                    result.canonical_storage_path,
                    result.source_map_storage_path,
                    json.dumps(updated_document_index, ensure_ascii=False),
                    result.document_id,
                ),
            )

    return migrated


def _rewrite_document_index_json(
    payload: dict[str, Any] | None,
    migrated_refs: dict[str, str | None],
) -> dict[str, Any] | None:
    if payload is None:
        return None
    updated = dict(payload)
    for field_name in _STORAGE_REF_FIELDS:
        updated[field_name] = migrated_refs.get(field_name)
    return updated


def _relative_key_for_ref(paths: Paths, storage_ref: str) -> str:
    trimmed = str(storage_ref or "").strip()
    if not trimmed:
        raise ValueError("Knowledge storage ref is required.")
    if trimmed.startswith("s3://"):
        parsed = PurePosixPath(trimmed.split("://", 1)[1].split("/", 1)[1])
        return _clean_relative_key(parsed.as_posix())

    if Path(trimmed).is_absolute():
        raise ValueError("Filesystem knowledge storage refs must be relative to OPENAGENTS_HOME.")
    return _clean_relative_key(trimmed)


def _package_root_key(relative_key: str) -> str:
    path = PurePosixPath(relative_key)
    parent = path.parent
    if parent.name in _PACKAGE_SUBDIR_NAMES:
        return parent.parent.as_posix()
    return parent.as_posix()


def _clean_relative_key(raw_value: str) -> str:
    parts = []
    for part in PurePosixPath(str(raw_value or "").replace("\\", "/")).parts:
        if part in {"", "."}:
            continue
        if part == "..":
            raise ValueError(f"Knowledge storage ref escapes its package: {raw_value!r}")
        parts.append(part)
    if not parts:
        raise ValueError("Knowledge storage ref is required.")
    return PurePosixPath(*parts).as_posix()


def _first_non_empty(values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        trimmed = str(value).strip()
        if trimmed:
            return trimmed
    return None
