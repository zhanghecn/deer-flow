from pathlib import Path

from src.config.paths import Paths
from src.knowledge.storage import KnowledgeAssetStore


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
    monkeypatch.delenv("KNOWLEDGE_OBJECT_STORE", raising=False)

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
