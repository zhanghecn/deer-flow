from __future__ import annotations

import json

import pytest

from src.config.paths import Paths
from src.knowledge.llm_wiki_ingest import (
    build_generation_prompt,
    generate_llm_wiki_files,
    merge_page_content,
    parse_file_blocks,
)
from src.knowledge.models import DocumentTreeNode, IndexedDocument, KnowledgeWorkspaceRecord, QueuedKnowledgeBuildJob
from src.knowledge.storage import KnowledgeAssetStore
from src.knowledge.wiki_workspace import (
    KnowledgeWorkspaceStore,
    build_knowledge_graph_payload,
    get_source_evidence_payload,
    search_workspaces,
    source_slug,
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
    assert concept_paths == []
    source_page = store.read_text(workspace, next(path for path in files if path.startswith("wiki/sources/")))
    assert "壬寅日主生于丑月" in source_page

    old_scaffold_path = "wiki/concepts/命理案例-44444444--壬寅日主丑月.md"
    store.write_text(
        workspace,
        old_scaffold_path,
        "---\ntype: concept\ntitle: 旧脚手架\nsources: [\"命理案例.md\"]\n---\n# 旧脚手架\n",
    )
    cache = json.loads(store.read_text(workspace, ".llm-wiki/ingest-cache.json"))
    cache["entries"]["命理案例.md"]["filesWritten"].append(old_scaffold_path)
    store.write_text(workspace, ".llm-wiki/ingest-cache.json", json.dumps(cache, ensure_ascii=False))
    indexed.nodes = []
    files = sync_indexed_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        indexed_document=indexed,
        content_sha256="sha-2",
    )

    assert all(not path.startswith("wiki/concepts/") for path in files)
    assert old_scaffold_path not in {file.path for file in store.list_files(workspace)}


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

    assert set(files) == {"wiki/concepts/contract-risk.md", "wiki/index.md"}
    assert any("path must stay within" in warning for warning in warnings)
    assert not any("global workspace files" in warning for warning in warnings)


def test_parse_file_blocks_sanitizes_common_llm_wiki_frontmatter_corruption():
    files, warnings = parse_file_blocks(
        """---FILE: wiki/concepts/frontmatter-repair.md---
```markdown
frontmatter:
---
type: concept
title: Repair
created: 2026-05-15
updated: 2026-05-15
tags: []
related: [[a]], [[b]]
sources: [repair.md]
---

# Repair
```
---END FILE---"""
    )

    assert warnings == []
    content = files["wiki/concepts/frontmatter-repair.md"]
    assert content.startswith("---\ntype: concept")
    assert 'related: ["a", "b"]' in content


def test_parse_file_blocks_normalizes_path_style_wikilinks_for_graph_resolution():
    files, warnings = parse_file_blocks(
        """---FILE: wiki/concepts/path-links.md---
---
type: concept
title: Path Links
created: 2026-05-15
updated: 2026-05-15
tags: []
related: [["wiki/concepts/调候用神.md"], ["wiki/sources/案例.md"]]
sources: [cases.md]
---

# Path Links

See [[wiki/concepts/调候用神.md]] and [[wiki/sources/案例.md|案例来源]].
---END FILE---"""
    )

    assert warnings == []
    content = files["wiki/concepts/path-links.md"]
    assert 'related: ["调候用神", "案例"]' in content
    assert "[[调候用神]]" in content
    assert "[[案例|案例来源]]" in content


def test_parse_file_blocks_normalizes_block_related_wikilinks():
    files, warnings = parse_file_blocks(
        """---FILE: wiki/concepts/block-related.md---
---
type: concept
title: Block Related
created: 2026-05-15
updated: 2026-05-15
tags: []
related:
  - "[[wiki/concepts/调候用神.md]]"
  - "[[案例来源]]"
  - "字碰字"
sources: [cases.md]
---

# Block Related

正文里的 [[wiki/concepts/调候用神.md]] 仍应作为正文链接规范化。
---END FILE---"""
    )

    assert warnings == []
    content = files["wiki/concepts/block-related.md"]
    assert 'related: ["调候用神", "案例来源", "字碰字"]' in content
    assert '  - "[[' not in content
    assert "[[调候用神]]" in content
    assert "- [[案例来源]]" in content
    assert "- [[字碰字]]" in content


def test_parse_file_blocks_materializes_related_as_body_wikilinks():
    files, warnings = parse_file_blocks(
        """---FILE: wiki/entities/壬寅日柱.md---
---
type: entity
title: 壬寅日柱
created: 2026-05-15
updated: 2026-05-15
tags: [命理]
related: ["巾箱秘术", "字碰字"]
sources: [cases.md]
---

# 壬寅日柱

正文只介绍日柱，没有显式关系链接。
---END FILE---"""
    )

    assert warnings == []
    content = files["wiki/entities/壬寅日柱.md"]
    assert "## Related" in content
    assert "- [[巾箱秘术]]" in content
    assert "- [[字碰字]]" in content


def test_parse_file_blocks_accepts_llm_wiki_query_pages():
    files, warnings = parse_file_blocks(
        """---FILE: wiki/queries/临时查询.md---
---
type: query
title: 临时查询
created: 2026-05-15
updated: 2026-05-15
tags: []
related: []
sources: [cases.md]
---

# 临时查询

可保存的查询页面。
---END FILE---"""
    )

    assert warnings == []
    assert "wiki/queries/临时查询.md" in files


def test_generation_prompt_includes_original_source_content():
    prompt = build_generation_prompt(
        schema="schema",
        purpose="purpose",
        index="index",
        source_file_name="cases.md",
        source_page_path="wiki/sources/cases-12345678.md",
        overview="overview",
        analysis="壬寅日主丑月需要调候。",
        source_content="# 原文\n\n壬寅日主丑月出生，天干透辛庚。",
    )

    assert "## Original Source Content" in prompt
    assert "壬寅日主丑月出生" in prompt
    assert "wiki/index.md" in prompt
    assert "wiki/overview.md" in prompt


def test_generate_llm_wiki_retry_keeps_full_workspace_contract(monkeypatch):
    class _Response:
        def __init__(self, content: str) -> None:
            self.content = content

    class _FakeModel:
        def __init__(self) -> None:
            self.calls: list[str] = []

        def invoke(self, messages):
            prompt = "\n".join(str(getattr(message, "content", message)) for message in messages)
            self.calls.append(prompt)
            if len(self.calls) == 1:
                return _Response("分析：壬寅日主丑月案例。")
            if len(self.calls) == 2:
                return _Response("not file blocks")
            return _Response(
                """---FILE: wiki/sources/案例-11111111.md---
---
type: source
title: 案例
created: 2026-05-15
updated: 2026-05-15
tags: []
related: []
sources: ["案例.md"]
---

# 案例

壬寅日主丑月出生。
---END FILE---

---FILE: wiki/index.md---
---
type: index
title: Index
---
# Index
---END FILE---

---FILE: wiki/overview.md---
---
type: overview
title: Overview
---
# Overview
---END FILE---

---FILE: wiki/log.md---
## [2026-05-15] ingest | 案例.md
---END FILE---"""
            )

    fake = _FakeModel()
    monkeypatch.setattr("src.knowledge.llm_wiki_ingest.create_chat_model", lambda **_kwargs: fake)
    job = QueuedKnowledgeBuildJob(
        job_id="job-retry",
        knowledge_base_id="kb",
        document_id="11111111-2222-3333-4444-555555555555",
        user_id="user",
        thread_id="thread",
        model_name="deepseek-v4-flash",
        display_name="案例.md",
        file_name="案例.md",
        file_kind="markdown",
        source_storage_path="knowledge/users/u/bases/b/documents/d/source/案例.md",
    )
    indexed = IndexedDocument(
        display_name="案例.md",
        file_name="案例.md",
        file_kind="markdown",
        locator_type="heading",
        structure=[],
        nodes=[],
        canonical_markdown="# 案例\n\n壬寅日主丑月出生。",
        source_map=[],
    )

    result = generate_llm_wiki_files(
        job=job,
        indexed_document=indexed,
        purpose="",
        schema="",
        index="",
        overview="",
        source_page_path="wiki/sources/案例-11111111.md",
    )

    assert set(result.files) >= {"wiki/sources/案例-11111111.md", "wiki/index.md", "wiki/overview.md", "wiki/log.md"}
    assert "wiki/sources/案例-11111111.md" in fake.calls[2]
    assert "wiki/overview.md" in fake.calls[2]
    assert "wiki/log.md" in fake.calls[2]
    assert "retried invalid FILE block output" in result.warnings


def test_parse_file_blocks_ignores_end_marker_inside_fenced_code():
    files, warnings = parse_file_blocks(
        """---FILE: wiki/concepts/parser-contract.md---
---
type: concept
title: Parser Contract
created: 2026-05-15
updated: 2026-05-15
tags: []
related: []
sources: [parser.md]
---

# Parser Contract

```text
---END FILE---
```

The literal marker above is documentation, not the block terminator.
---END FILE---"""
    )

    assert warnings == []
    assert "literal marker above" in files["wiki/concepts/parser-contract.md"]


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


def test_sync_preserves_llm_wiki_global_pages_and_generated_source_summary(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    job = QueuedKnowledgeBuildJob(
        job_id="job-global",
        knowledge_base_id=workspace.id,
        document_id="66666666-3333-3333-3333-333333333333",
        user_id=workspace.owner_id,
        thread_id="thread-1",
        model_name="model",
        display_name="案例.md",
        file_name="案例.md",
        file_kind="markdown",
        source_storage_path="knowledge/users/u/bases/b/documents/d/source/案例.md",
    )
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
    generated_source = """---
type: source
title: 壬寅日主丑月案例
created: 2026-05-15
updated: 2026-05-15
tags: [命理]
related: []
sources: ["案例.md"]
---

# 壬寅日主丑月案例

这是模型编译出的领域摘要，不是路径清单。"""

    sync_indexed_document_to_workspace(
        store=store,
        workspace=workspace,
        job=job,
        indexed_document=indexed,
        content_sha256="sha-global",
        llm_generated_pages={
            "wiki/sources/案例-66666666.md": generated_source,
            "wiki/index.md": "---\ntype: index\ntitle: Index\n---\n# Index\n\n- [[案例-66666666|壬寅日主丑月案例]] — 领域摘要",
            "wiki/overview.md": "---\ntype: overview\ntitle: Overview\n---\n# Overview\n\n本知识库围绕壬寅日主丑月案例展开。",
            "wiki/log.md": "## [2026-05-15] ingest | 案例.md",
        },
    )

    source_page = store.read_text(workspace, "wiki/sources/案例-66666666.md")
    assert "模型编译出的领域摘要" in source_page
    assert "Raw cache:" in source_page
    assert "领域摘要" in store.read_text(workspace, "wiki/index.md")
    assert "壬寅日主丑月案例展开" in store.read_text(workspace, "wiki/overview.md")
    assert "ingest | 案例.md" in store.read_text(workspace, "wiki/log.md")


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


def test_graph_uses_normalized_related_frontmatter_as_edges(tmp_path, monkeypatch):
    store = _store(tmp_path, monkeypatch)
    workspace = _workspace()
    store.write_text(
        workspace,
        "wiki/concepts/breach.md",
        "---\ntitle: 违约责任\ntype: concept\nrelated: [解除权]\nsources: [contract.pdf]\n---\n# 违约责任\n\n正文未写链接。",
    )
    store.write_text(
        workspace,
        "wiki/concepts/termination.md",
        "---\ntitle: 解除权\ntype: concept\nsources: [contract.pdf]\n---\n# 解除权\n",
    )

    graph_workspace = build_knowledge_graph_payload(store=store, workspaces=[workspace])["workspaces"][0]

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
