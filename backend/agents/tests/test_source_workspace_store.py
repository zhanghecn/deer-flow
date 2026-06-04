from __future__ import annotations

import pytest

from src.config.paths import Paths
from src.knowledge.models import SourceDocument, KnowledgeWorkspaceRecord, QueuedKnowledgeBuildJob
from src.knowledge.storage import KnowledgeAssetStore
from src.knowledge.source_workspace_store import (
    KnowledgeWorkspaceStore,
    source_slug,
    sync_source_document_to_workspace,
)


def _workspace() -> KnowledgeWorkspaceRecord:
    return KnowledgeWorkspaceRecord(
        id="11111111-1111-1111-1111-111111111111",
        owner_id="22222222-2222-2222-2222-222222222222",
        name="合同知识库",
        description="复杂合同资料",
        source_type="library",
        visibility="private",
        ready_document_count=1,
        document_count=1,
    )


def _store(tmp_path, monkeypatch: pytest.MonkeyPatch) -> KnowledgeWorkspaceStore:
    monkeypatch.setenv("KNOWLEDGE_OBJECT_STORE", "filesystem")
    asset_store = KnowledgeAssetStore(paths=Paths(base_dir=tmp_path, skills_dir=tmp_path / "skills"))
    return KnowledgeWorkspaceStore(asset_store=asset_store)


def test_source_slug_preserves_relative_folder_context():
    assert (
        source_slug("盲派真实案例/壬寅柱/cases.md", "49c45cc1-a9f1-4ec9-905e-3478dc94d6b0")
        == "盲派真实案例-壬寅柱-cases-49c45cc1"
    )


def test_minio_missing_object_maps_to_file_not_found(tmp_path, monkeypatch):
    class _MissingObjectError(Exception):
        code = "NoSuchKey"

    class _FakeClient:
        def fget_object(self, *_args, **_kwargs):
            raise _MissingObjectError()

    monkeypatch.setenv("KNOWLEDGE_OBJECT_STORE", "minio")
    monkeypatch.setenv("KNOWLEDGE_S3_ENDPOINT", "http://127.0.0.1:9000")
    monkeypatch.setenv("KNOWLEDGE_S3_ACCESS_KEY", "minio")
    monkeypatch.setenv("KNOWLEDGE_S3_SECRET_KEY", "miniosecret")
    monkeypatch.setenv("KNOWLEDGE_S3_BUCKET", "knowledge")
    asset_store = KnowledgeAssetStore(paths=Paths(base_dir=tmp_path, skills_dir=tmp_path / "skills"))
    monkeypatch.setattr(asset_store, "_client_instance", lambda: _FakeClient())

    with pytest.raises(FileNotFoundError):
        asset_store.resolve_local_path("s3://knowledge/users/demo/workspace/purpose.md")


def test_sync_source_document_writes_only_source_workspace_files(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    job = QueuedKnowledgeBuildJob(
        job_id="job-1",
        knowledge_base_id=workspace.id,
        document_id="33333333-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        display_name="复杂合同.pdf",
        file_name="复杂合同.pdf",
        file_kind="pdf",
        source_storage_path="knowledge/users/u/bases/b/documents/d/source/复杂合同.pdf",
    )
    source_document = SourceDocument(
        display_name="复杂合同.pdf",
        file_name="复杂合同.pdf",
        file_kind="pdf",
        locator_type="page",
        page_count=2,
        doc_description="关于违约责任和解除条款。",
        canonical_markdown="# 合同\n\n违约责任包括继续履行、赔偿损失和解除条件。",
    )

    files = sync_source_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        source_document=source_document,
        content_sha256="sha-demo",
    )

    assert files == ["sources/复杂合同-33333333.md"]
    assert {file.path for file in store.list_files(workspace)} == {"sources/复杂合同-33333333.md"}
    assert store.read_text(workspace, "sources/复杂合同-33333333.md") == source_document.canonical_markdown


def test_sync_source_document_writes_no_deprecated_compiled_inputs(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    job = QueuedKnowledgeBuildJob(
        job_id="job-cache",
        knowledge_base_id=workspace.id,
        document_id="33333333-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        display_name="复杂合同.pdf",
        file_name="复杂合同.pdf",
        file_kind="pdf",
        source_storage_path="knowledge/users/u/bases/b/documents/d/source/复杂合同.pdf",
    )
    source_document = SourceDocument(
        display_name="复杂合同.pdf",
        file_name="复杂合同.pdf",
        file_kind="pdf",
        locator_type="page",
        page_count=1,
        doc_description="合同。",
        canonical_markdown="# 合同\n\n违约责任。",
    )

    files = sync_source_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        source_document=source_document,
        content_sha256="sha-cache",
    )

    assert files == ["sources/复杂合同-33333333.md"]
    assert {file.path for file in store.list_files(workspace)} == {"sources/复杂合同-33333333.md"}


def test_sync_source_document_keeps_multiple_sources_without_overview(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    source_document = SourceDocument(
        display_name="案例.md",
        file_name="案例.md",
        file_kind="markdown",
        locator_type="heading",
        page_count=1,
        doc_description="命理案例。",
        canonical_markdown="# 案例\n\n壬寅日主丑月出生。",
    )

    for document_id, suffix, display_name in [
        ("bbbbbbbb-3333-3333-3333-333333333333", "b", "b-case.md"),
        ("aaaaaaaa-3333-3333-3333-333333333333", "a", "a-case.md"),
    ]:
        sync_source_document_to_workspace(
            store=store,
            workspace=workspace,
            job=QueuedKnowledgeBuildJob(
                job_id=f"job-{suffix}",
                knowledge_base_id=workspace.id,
                document_id=document_id,
                user_id=workspace.owner_id,
                thread_id="thread-1",
                display_name=display_name,
                file_name=display_name,
                file_kind="markdown",
                source_storage_path=f"knowledge/users/u/bases/b/documents/{suffix}/source/{display_name}",
            ),
            source_document=source_document,
            content_sha256=f"sha-{suffix}",
        )

    assert {file.path for file in store.list_files(workspace)} == {
        "sources/a-case-aaaaaaaa.md",
        "sources/b-case-bbbbbbbb.md",
    }


def test_sync_source_document_removes_deprecated_compiled_workspace_files(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    job = QueuedKnowledgeBuildJob(
        job_id="job-concepts",
        knowledge_base_id=workspace.id,
        document_id="44444444-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        display_name="命理案例.md",
        file_name="命理案例.md",
        file_kind="markdown",
        source_storage_path="knowledge/users/u/bases/b/documents/d/source/命理案例.md",
    )
    source_document = SourceDocument(
        display_name="命理案例.md",
        file_name="命理案例.md",
        file_kind="markdown",
        locator_type="heading",
        page_count=1,
        doc_description="壬寅日主丑月案例。",
        canonical_markdown="# 壬寅日主丑月\n\n壬寅日主丑月出生。",
    )
    store.write_text(workspace, "wiki/index.md", "# stale index")
    store.write_text(workspace, "wiki/concepts/stale.md", "# stale concept")
    store.write_text(workspace, ".llm-wiki/ingest-cache.json", "{}")
    store.write_text(workspace, "raw/sources/.cache/stale.txt", "stale")

    files = sync_source_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        source_document=source_document,
        content_sha256="sha-1",
    )

    assert files == ["sources/命理案例-44444444.md"]
    assert {file.path for file in store.list_files(workspace)} == {"sources/命理案例-44444444.md"}


def test_source_workspace_cleanup_does_not_delete_current_source_files(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    first_job = QueuedKnowledgeBuildJob(
        job_id="job-first",
        knowledge_base_id=workspace.id,
        document_id="11111111-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        display_name="first.md",
        file_name="first.md",
        file_kind="markdown",
        source_storage_path="knowledge/users/u/bases/b/documents/first/source/first.md",
    )
    second_job = QueuedKnowledgeBuildJob(
        job_id="job-second",
        knowledge_base_id=workspace.id,
        document_id="22222222-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        display_name="second.md",
        file_name="second.md",
        file_kind="markdown",
        source_storage_path="knowledge/users/u/bases/b/documents/second/source/second.md",
    )
    source_document = SourceDocument(
        display_name="source.md",
        file_name="source.md",
        file_kind="markdown",
        locator_type="heading",
        page_count=1,
        doc_description="source",
        canonical_markdown="# Source\n\nfull source text",
    )

    sync_source_document_to_workspace(
        store=store,
        workspace=workspace,
        job=first_job,
        source_document=source_document,
        content_sha256="sha-first",
    )
    sync_source_document_to_workspace(
        store=store,
        workspace=workspace,
        job=second_job,
        source_document=source_document,
        content_sha256="sha-second",
    )

    assert {file.path for file in store.list_files(workspace)} == {
        "sources/first-11111111.md",
        "sources/second-22222222.md",
    }
