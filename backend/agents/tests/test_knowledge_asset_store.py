from pathlib import Path

import pytest

from src.config.paths import Paths
from src.knowledge.storage import KnowledgeAssetStore


def test_store_requires_explicit_backend_config(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("KNOWLEDGE_OBJECT_STORE", raising=False)

    with pytest.raises(ValueError, match="KNOWLEDGE_OBJECT_STORE must be explicitly set"):
        KnowledgeAssetStore(paths=Paths(base_dir=tmp_path, skills_dir=tmp_path))


@pytest.mark.parametrize("backend", ["fs", "local", "s3"])
def test_store_rejects_legacy_backend_aliases(monkeypatch, tmp_path: Path, backend: str):
    monkeypatch.setenv("KNOWLEDGE_OBJECT_STORE", backend)
    if backend == "s3":
        monkeypatch.setenv("KNOWLEDGE_S3_ENDPOINT", "http://localhost:9000")
        monkeypatch.setenv("KNOWLEDGE_S3_ACCESS_KEY", "zhangxuan")
        monkeypatch.setenv("KNOWLEDGE_S3_SECRET_KEY", "zhangxuan66")
        monkeypatch.setenv("KNOWLEDGE_S3_BUCKET", "knowledge")

    with pytest.raises(ValueError, match="Unsupported KNOWLEDGE_OBJECT_STORE backend"):
        KnowledgeAssetStore(paths=Paths(base_dir=tmp_path, skills_dir=tmp_path))


def test_storage_ref_from_relative_path_uses_s3_scheme_when_enabled(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("KNOWLEDGE_OBJECT_STORE", "minio")
    monkeypatch.setenv("KNOWLEDGE_S3_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("KNOWLEDGE_S3_ACCESS_KEY", "zhangxuan")
    monkeypatch.setenv("KNOWLEDGE_S3_SECRET_KEY", "zhangxuan66")
    monkeypatch.setenv("KNOWLEDGE_S3_BUCKET", "knowledge")

    store = KnowledgeAssetStore(paths=Paths(base_dir=tmp_path, skills_dir=tmp_path))

    assert (
        store.storage_ref_from_relative_path(
            "knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf"
        )
        == "s3://knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf"
    )


def test_join_package_ref_reuses_document_package_root(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("KNOWLEDGE_OBJECT_STORE", "filesystem")

    store = KnowledgeAssetStore(paths=Paths(base_dir=tmp_path, skills_dir=tmp_path))

    assert (
        store.join_package_ref(
            storage_ref="knowledge/users/u-1/bases/b-1/documents/d-1/canonical/canonical.md",
            relative_path="assets/pages/page-0003.png",
        )
        == "knowledge/users/u-1/bases/b-1/documents/d-1/assets/pages/page-0003.png"
    )


def test_storage_ref_from_relative_path_accepts_legacy_prefix_but_writes_normalized_s3_key(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setenv("KNOWLEDGE_OBJECT_STORE", "minio")
    monkeypatch.setenv("KNOWLEDGE_S3_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("KNOWLEDGE_S3_ACCESS_KEY", "zhangxuan")
    monkeypatch.setenv("KNOWLEDGE_S3_SECRET_KEY", "zhangxuan66")
    monkeypatch.setenv("KNOWLEDGE_S3_BUCKET", "knowledge")

    store = KnowledgeAssetStore(paths=Paths(base_dir=tmp_path, skills_dir=tmp_path))

    assert (
        store.storage_ref_from_relative_path("users/u-1/bases/b-1/documents/d-1/source/demo.pdf")
        == "s3://knowledge/users/u-1/bases/b-1/documents/d-1/source/demo.pdf"
    )


def test_parse_storage_ref_rejects_absolute_filesystem_paths(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("KNOWLEDGE_OBJECT_STORE", "filesystem")

    store = KnowledgeAssetStore(paths=Paths(base_dir=tmp_path, skills_dir=tmp_path))

    with pytest.raises(ValueError, match="must be relative"):
        store._parse_storage_ref("/tmp/demo.pdf")
