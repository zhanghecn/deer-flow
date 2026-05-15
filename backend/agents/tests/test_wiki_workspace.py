from __future__ import annotations

import json

import pytest

from src.config.paths import Paths
from src.knowledge.llm_wiki_ingest import merge_page_content, parse_file_blocks
from src.knowledge.models import DocumentTreeNode, IndexedDocument, KnowledgeWorkspaceRecord, QueuedKnowledgeBuildJob
from src.knowledge.storage import KnowledgeAssetStore
from src.knowledge.wiki_workspace import (
    KnowledgeWorkspaceStore,
    build_knowledge_graph_payload,
    get_source_evidence_payload,
    search_workspaces,
    sync_indexed_document_to_workspace,
    tokenize_query,
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


def test_tokenize_query_matches_llm_wiki_cjk_bigram_behavior():
    assert tokenize_query("默会知识") == ["默会", "会知", "知识", "默", "会", "知", "识", "默会知识"]


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


def test_sync_indexed_document_writes_llm_wiki_workspace_files(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    job = QueuedKnowledgeBuildJob(
        job_id="job-1",
        knowledge_base_id=workspace.id,
        document_id="33333333-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        model_name="model",
        display_name="复杂合同.pdf",
        file_name="复杂合同.pdf",
        file_kind="pdf",
        source_storage_path="knowledge/users/u/bases/b/documents/d/source/复杂合同.pdf",
    )
    indexed = IndexedDocument(
        display_name="复杂合同.pdf",
        file_name="复杂合同.pdf",
        file_kind="pdf",
        locator_type="page",
        page_count=2,
        doc_description="关于违约责任和解除条款。",
        structure=[],
        nodes=[],
        canonical_markdown="# 合同\n\n违约责任包括继续履行、赔偿损失和解除条件。",
        source_map=[],
    )

    files = sync_indexed_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        indexed_document=indexed,
        content_sha256="sha-demo",
    )

    assert any(path.startswith("wiki/sources/") for path in files)
    tree_paths = {file.path for file in store.list_files(workspace)}
    assert "purpose.md" in tree_paths
    assert "schema.md" in tree_paths
    assert "wiki/index.md" in tree_paths
    assert ".llm-wiki/ingest-cache.json" in tree_paths
    cache = json.loads(store.read_text(workspace, ".llm-wiki/ingest-cache.json"))
    assert cache["entries"]["复杂合同.pdf"]["hash"] == "sha-demo"


def test_sync_indexed_document_rewrites_overview_for_multiple_sources(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    indexed = IndexedDocument(
        display_name="案例.md",
        file_name="案例.md",
        file_kind="markdown",
        locator_type="heading",
        page_count=1,
        doc_description="命理案例。",
        structure=[],
        nodes=[],
        canonical_markdown="# 案例\n\n壬寅日主丑月出生。",
        source_map=[],
    )

    # The overview is rewritten after every document; this locks the
    # multi-source path that failed when WikiPage objects were sorted directly.
    for document_id, suffix, display_name in [
        ("bbbbbbbb-3333-3333-3333-333333333333", "b", "b-case.md"),
        ("aaaaaaaa-3333-3333-3333-333333333333", "a", "a-case.md"),
    ]:
        sync_indexed_document_to_workspace(
            store=store,
            workspace=workspace,
            job=QueuedKnowledgeBuildJob(
                job_id=f"job-{suffix}",
                knowledge_base_id=workspace.id,
                document_id=document_id,
                user_id=workspace.owner_id,
                thread_id="thread-1",
                model_name="model",
                display_name=display_name,
                file_name=display_name,
                file_kind="markdown",
                source_storage_path=f"knowledge/users/u/bases/b/documents/{suffix}/source/{display_name}",
            ),
            indexed_document=indexed,
            content_sha256=f"sha-{suffix}",
        )

    index = store.read_text(workspace, "wiki/index.md")
    assert "- [[a-case-" in index
    assert "- [[b-case-" in index
    assert index.index("a-case") < index.index("b-case")


def test_sync_indexed_document_generates_llm_wiki_concept_pages_and_cleans_stale(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    job = QueuedKnowledgeBuildJob(
        job_id="job-concepts",
        knowledge_base_id=workspace.id,
        document_id="44444444-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        model_name="model",
        display_name="命理案例.md",
        file_name="命理案例.md",
        file_kind="markdown",
        source_storage_path="knowledge/users/u/bases/b/documents/d/source/命理案例.md",
    )
    indexed = IndexedDocument(
        display_name="命理案例.md",
        file_name="命理案例.md",
        file_kind="markdown",
        locator_type="heading",
        page_count=1,
        doc_description="壬寅日主丑月案例。",
        structure=[],
        nodes=[
            DocumentTreeNode(
                node_id="case-1",
                node_path="case-1",
                title="壬寅日主丑月",
                depth=1,
                child_count=0,
                locator_type="heading",
                line_start=1,
                summary="壬寅日主生于丑月，需分析寒湿、调候和财官印关系。",
                node_text="壬寅日主丑月出生，地支见丑戌刑，天干透辛庚。",
            )
        ],
        canonical_markdown="# 壬寅日主丑月\n\n壬寅日主丑月出生。",
        source_map=[],
    )

    files = sync_indexed_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        indexed_document=indexed,
        content_sha256="sha-1",
    )

    concept_paths = [path for path in files if path.startswith("wiki/concepts/")]
    assert len(concept_paths) == 1
    source_page = store.read_text(workspace, next(path for path in files if path.startswith("wiki/sources/")))
    assert f"[[{concept_paths[0].removeprefix('wiki/concepts/').removesuffix('.md')}|壬寅日主丑月]]" in source_page

    indexed.nodes = []
    files = sync_indexed_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        indexed_document=indexed,
        content_sha256="sha-2",
    )

    assert all(not path.startswith("wiki/concepts/") for path in files)
    assert concept_paths[0] not in {file.path for file in store.list_files(workspace)}


def test_parse_file_blocks_accepts_only_safe_wiki_pages():
    files, warnings = parse_file_blocks(
        """--- FILE: wiki/concepts/contract-risk.md ---
```markdown
---
type: concept
title: Contract Risk
created: 2026-05-15
updated: 2026-05-15
tags: [contract]
related: []
sources: [contract.pdf]
---

# Contract Risk

Risk body.
```
--- END FILE ---

---FILE: ../escape.md---
bad
---END FILE---

---FILE: wiki/index.md---
---
type: index
title: Index
---
# Index
---END FILE---"""
    )

    assert set(files) == {"wiki/concepts/contract-risk.md"}
    assert any("path must stay within" in warning for warning in warnings)
    assert any("global workspace files" in warning for warning in warnings)


def test_merge_page_content_preserves_sources_and_existing_body():
    existing = """---
type: concept
title: 合同风险
created: 2026-05-01
updated: 2026-05-01
tags: [合同]
related: [解除权]
sources: ["旧合同.pdf"]
---

# 合同风险

旧来源中的风险描述。"""
    incoming = """---
type: concept
title: 合同风险
created: 2026-05-15
updated: 2026-05-15
tags: [风险]
related: [违约责任]
sources: ["新合同.pdf"]
---

# 合同风险

新来源中的风险描述。"""

    merged = merge_page_content(
        new_content=incoming,
        existing_content=existing,
        source_file_name="新合同.pdf",
        today="2026-05-15",
    )

    assert 'created: 2026-05-01' in merged
    assert 'sources: ["旧合同.pdf", "新合同.pdf"]' in merged
    assert 'tags: ["合同", "风险"]' in merged
    assert 'related: ["解除权", "违约责任"]' in merged
    assert "新来源中的风险描述" in merged
    assert "旧来源中的风险描述" in merged


def test_sync_indexed_document_writes_and_prunes_llm_wiki_generated_pages(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    job = QueuedKnowledgeBuildJob(
        job_id="job-llm",
        knowledge_base_id=workspace.id,
        document_id="55555555-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        model_name="model",
        display_name="合同.md",
        file_name="合同.md",
        file_kind="markdown",
        source_storage_path="knowledge/users/u/bases/b/documents/d/source/合同.md",
    )
    indexed = IndexedDocument(
        display_name="合同.md",
        file_name="合同.md",
        file_kind="markdown",
        locator_type="heading",
        page_count=1,
        doc_description="合同风险。",
        structure=[],
        nodes=[],
        canonical_markdown="# 合同\n\n解除权和违约责任。",
        source_map=[],
    )
    generated_page = """---
type: concept
title: 违约责任
created: 2026-05-15
updated: 2026-05-15
tags: [合同]
related: []
sources: ["合同.md"]
---

# 违约责任

违约责任需要结合解除权。"""

    files = sync_indexed_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        indexed_document=indexed,
        content_sha256="sha-llm-1",
        llm_generated_pages={"wiki/concepts/违约责任.md": generated_page},
    )

    assert "wiki/concepts/违约责任.md" in files
    assert "违约责任需要结合解除权" in store.read_text(workspace, "wiki/concepts/违约责任.md")

    files = sync_indexed_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        indexed_document=indexed,
        content_sha256="sha-llm-2",
        llm_generated_pages={},
    )

    assert "wiki/concepts/违约责任.md" not in files
    assert "wiki/concepts/违约责任.md" not in {file.path for file in store.list_files(workspace)}


def test_search_and_source_evidence_use_workspace_files(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    store.write_text(
        workspace,
        "wiki/sources/contract.md",
        "---\ntitle: 合同解除\ntype: source\nsources:\n  - contract.pdf\n---\n# 合同解除\n\n解除权和违约责任需要结合通知义务判断。",
    )
    store.write_text(
        workspace,
        "raw/sources/.cache/contract.txt",
        "第一章 解除权。合同一方迟延履行主要债务，经催告后仍未履行的，可以解除合同。",
    )

    result = search_workspaces(store=store, workspaces=[workspace], query="解除权 违约责任")
    assert result["results"][0]["path"] == "wiki/sources/contract.md"
    assert result["results"][0]["workspace_id"] == workspace.id

    evidence = get_source_evidence_payload(
        store=store,
        workspace=workspace,
        query="催告后仍未履行",
    )
    assert "可以解除合同" in evidence["snippets"][0]["text"]


def test_graph_uses_wikilinks_and_hides_query_pages(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    store.write_text(
        workspace,
        "wiki/concepts/breach.md",
        "---\ntitle: 违约责任\ntype: concept\nsources: [contract.pdf]\n---\n# 违约责任\n\n关联 [[termination|解除权]]。",
    )
    store.write_text(
        workspace,
        "wiki/concepts/termination.md",
        "---\ntitle: 解除权\ntype: concept\nsources: [contract.pdf]\n---\n# 解除权\n",
    )
    store.write_text(
        workspace,
        "wiki/queries/temp.md",
        "---\ntitle: 临时查询\ntype: query\n---\n# 临时查询\n",
    )

    graph = build_knowledge_graph_payload(store=store, workspaces=[workspace])
    graph_workspace = graph["workspaces"][0]

    assert {node["id"] for node in graph_workspace["nodes"]} == {"breach", "termination"}
    assert graph_workspace["edges"] == [{"source": "breach", "target": "termination", "weight": 7.8}]


def test_graph_community_ids_are_remapped_to_display_order(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    for path, content in {
        "wiki/concepts/a.md": "---\ntitle: A\ntype: concept\n---\n# A\n[[b]]",
        "wiki/concepts/b.md": "---\ntitle: B\ntype: concept\n---\n# B\n[[c]]",
        "wiki/concepts/c.md": "---\ntitle: C\ntype: concept\n---\n# C\n",
        "wiki/concepts/z.md": "---\ntitle: Z\ntype: concept\n---\n# Z\n",
    }.items():
        store.write_text(workspace, path, content)

    graph = build_knowledge_graph_payload(store=store, workspaces=[workspace])["workspaces"][0]
    communities = graph["communities"]
    nodes = {node["id"]: node for node in graph["nodes"]}

    assert communities[0]["id"] == 0
    assert communities[0]["nodeCount"] == 3
    assert nodes["a"]["community"] == 0
    assert nodes["z"]["community"] == 1
