import json
from pathlib import Path

import pytest

from src.config.paths import Paths
from src.knowledge.migration import (
    KnowledgeDocumentStorageSnapshot,
    migrate_document_package,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.uses_object_store = True
        self.synced: list[tuple[str, str]] = []
        self.written_text: dict[str, str] = {}

    def storage_ref_from_relative_path(self, relative_path: str) -> str:
        normalized = str(relative_path).replace("\\", "/").lstrip("/")
        if normalized.startswith("knowledge/"):
            normalized = normalized[len("knowledge/") :]
        return f"s3://knowledge/{normalized}"

    def sync_local_file(self, *, storage_ref: str, local_path: Path, content_type: str | None = None) -> Path:
        self.synced.append((storage_ref, local_path.name))
        return local_path

    def write_text(self, *, storage_ref: str, text: str, encoding: str = "utf-8") -> Path:
        self.written_text[storage_ref] = text
        return Path("/tmp/cache")


class _FilesystemOnlyStore:
    uses_object_store = False


def test_migrate_document_package_rewrites_refs_and_uploads_package(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    package_dir = base_dir / "knowledge" / "users" / "u-1" / "bases" / "b-1" / "documents" / "d-1"
    source_path = package_dir / "source" / "demo.pdf"
    canonical_path = package_dir / "canonical" / "canonical.md"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    canonical_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(b"%PDF-1.4")
    canonical_path.write_text("# Demo\n", encoding="utf-8")

    snapshot = KnowledgeDocumentStorageSnapshot(
        document_id="d-1",
        source_storage_path="knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf",
        canonical_storage_path="knowledge/users/u-1/bases/b-1/documents/d-1/canonical/canonical.md",
        document_index_json={
            "source_storage_path": "knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf",
            "canonical_storage_path": "knowledge/users/u-1/bases/b-1/documents/d-1/canonical/canonical.md",
        },
    )

    migrated = migrate_document_package(
        paths=Paths(base_dir=base_dir, skills_dir=base_dir),
        asset_store=_FakeObjectStore(),
        snapshot=snapshot,
    )

    assert migrated.source_storage_path == "s3://knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf"
    assert migrated.canonical_storage_path == "s3://knowledge/users/u-1/bases/b-1/documents/d-1/canonical/canonical.md"
    assert migrated.uploaded_file_count == 2


def test_migrate_document_package_refreshes_document_index_payload(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    package_dir = base_dir / "knowledge" / "users" / "u-1" / "bases" / "b-1" / "documents" / "d-1"
    source_path = package_dir / "source" / "demo.pdf"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(b"%PDF-1.4")

    store = _FakeObjectStore()
    snapshot = KnowledgeDocumentStorageSnapshot(
        document_id="d-1",
        source_storage_path="knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf",
        document_index_json={
            "source_storage_path": "knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf",
        },
    )

    migrated = migrate_document_package(
        paths=Paths(base_dir=base_dir, skills_dir=base_dir),
        asset_store=store,
        snapshot=snapshot,
    )

    target_ref = "s3://knowledge/users/u-1/bases/b-1/documents/d-1/index/document_index.json"
    assert target_ref in store.written_text
    payload = json.loads(store.written_text[target_ref])
    assert payload["source_storage_path"] == migrated.source_storage_path


def test_migrate_document_package_rejects_non_object_store(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    package_dir = base_dir / "knowledge" / "users" / "u-1" / "bases" / "b-1" / "documents" / "d-1"
    source_path = package_dir / "source" / "demo.pdf"
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(b"%PDF-1.4")

    snapshot = KnowledgeDocumentStorageSnapshot(
        document_id="d-1",
        source_storage_path="knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf",
    )

    with pytest.raises(ValueError, match="object-store backend"):
        migrate_document_package(
            paths=Paths(base_dir=base_dir, skills_dir=base_dir),
            asset_store=_FilesystemOnlyStore(),
            snapshot=snapshot,
        )
