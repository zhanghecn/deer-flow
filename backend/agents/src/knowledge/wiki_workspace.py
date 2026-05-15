from __future__ import annotations

import hashlib
import json
import math
import re
import time
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from src.knowledge.llm_wiki_ingest import (
    LlmWikiIngestResult,
    generate_llm_wiki_files,
    merge_page_content,
    remove_source_from_frontmatter,
)
from src.knowledge.models import IndexedDocument, KnowledgeWorkspaceRecord, QueuedKnowledgeBuildJob
from src.knowledge.storage import KnowledgeAssetStore, get_knowledge_asset_store

WORKSPACE_ROOT_DIR = "workspace"
WIKI_DIR = "wiki"
LLM_WIKI_DIR = ".llm-wiki"
MAX_SEARCH_RESULTS = 20
SNIPPET_CONTEXT = 80
RRF_K = 60
MAX_SOURCE_STRUCTURE_NODES = 120
MAX_SOURCE_TEXT_PREVIEW_CHARS = 80_000
FILENAME_EXACT_BONUS = 200
PHRASE_IN_TITLE_BONUS = 50
PHRASE_IN_CONTENT_PER_OCC = 20
MAX_PHRASE_OCC_COUNTED = 10
TITLE_TOKEN_WEIGHT = 5
CONTENT_TOKEN_WEIGHT = 1
TRIM_PUNCT_RE = re.compile(r'^[\s,，。！？、；：""\'\'（）()\-_/\\·~～…]+|[\s,，。！？、；：""\'\'（）()\-_/\\·~～…]+$')
SPLIT_RE = re.compile(r'[\s,，。！？、；：""\'\'（）()\-_/\\·~～…]+')
FRONTMATTER_RE = re.compile(r"^---\n(?P<body>[\s\S]*?)\n---", re.MULTILINE)
WIKILINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]")
IMAGE_REF_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
HEADING_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
TITLE_FM_RE = re.compile(r"^title:\s*[\"']?(.+?)[\"']?\s*$", re.MULTILINE)
TYPE_FM_RE = re.compile(r"^type:\s*[\"']?(.+?)[\"']?\s*$", re.MULTILINE)
SOURCES_BLOCK_RE = re.compile(r"^sources:\s*\n((?:\s+-\s+.+\n?)*)", re.MULTILINE)
SOURCES_INLINE_RE = re.compile(r"^sources:\s*\[([^\]]*)\]", re.MULTILINE)

STOP_WORDS = {
    "的",
    "是",
    "了",
    "什么",
    "在",
    "有",
    "和",
    "与",
    "对",
    "从",
    "the",
    "is",
    "a",
    "an",
    "what",
    "how",
    "are",
    "was",
    "were",
    "do",
    "does",
    "did",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "it",
    "its",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "this",
    "that",
    "these",
    "those",
}

TYPE_AFFINITY: dict[str, dict[str, float]] = {
    "entity": {"concept": 1.2, "entity": 0.8, "source": 1.0, "synthesis": 1.0, "query": 0.8},
    "concept": {"entity": 1.2, "concept": 0.8, "source": 1.0, "synthesis": 1.2, "query": 1.0},
    "source": {"entity": 1.0, "concept": 1.0, "source": 0.5, "query": 0.8, "synthesis": 1.0},
    "query": {"concept": 1.0, "entity": 0.8, "synthesis": 1.0, "source": 0.8, "query": 0.5},
    "synthesis": {"concept": 1.2, "entity": 1.0, "source": 1.0, "query": 1.0, "synthesis": 0.8},
}


@dataclass(frozen=True)
class WorkspaceFile:
    path: str
    storage_ref: str


@dataclass(frozen=True)
class WikiPage:
    workspace: KnowledgeWorkspaceRecord
    path: str
    content: str


class KnowledgeWorkspaceStore:
    def __init__(self, asset_store: KnowledgeAssetStore | None = None) -> None:
        self._asset_store = asset_store or get_knowledge_asset_store()

    def workspace_prefix(self, workspace: KnowledgeWorkspaceRecord) -> str:
        # Workspace ownership follows the knowledge base owner, not the current
        # thread user, so shared libraries resolve to their real asset prefix.
        return f"knowledge/users/{workspace.owner_id}/bases/{workspace.id}/{WORKSPACE_ROOT_DIR}"

    def storage_ref(self, workspace: KnowledgeWorkspaceRecord, relative_path: str) -> str:
        safe_path = normalize_workspace_path(relative_path)
        return self._asset_store.storage_ref_from_relative_path(
            f"{self.workspace_prefix(workspace)}/{safe_path}"
        )

    def read_text(self, workspace: KnowledgeWorkspaceRecord, relative_path: str) -> str:
        return self._asset_store.read_text(self.storage_ref(workspace, relative_path))

    def write_text(self, workspace: KnowledgeWorkspaceRecord, relative_path: str, text: str) -> None:
        self._asset_store.write_text(storage_ref=self.storage_ref(workspace, relative_path), text=text)

    def delete_file(self, workspace: KnowledgeWorkspaceRecord, relative_path: str) -> None:
        self._asset_store.delete_file(self.storage_ref(workspace, relative_path))

    def write_text_if_missing(self, workspace: KnowledgeWorkspaceRecord, relative_path: str, text: str) -> None:
        if self.file_exists(workspace, relative_path):
            return
        self.write_text(workspace, relative_path, text)

    def file_exists(self, workspace: KnowledgeWorkspaceRecord, relative_path: str) -> bool:
        try:
            self.read_text(workspace, relative_path)
            return True
        except FileNotFoundError:
            return False

    def list_files(self, workspace: KnowledgeWorkspaceRecord, relative_prefix: str = "") -> list[WorkspaceFile]:
        prefix = self.workspace_prefix(workspace)
        safe_prefix = normalize_workspace_path(relative_prefix) if relative_prefix else ""
        full_prefix = f"{prefix}/{safe_prefix}" if safe_prefix else prefix
        files = self._asset_store.list_relative_paths(full_prefix)
        return [
            WorkspaceFile(
                path=normalize_workspace_path(f"{safe_prefix}/{path}" if safe_prefix else path),
                storage_ref=self.storage_ref(workspace, f"{safe_prefix}/{path}" if safe_prefix else path),
            )
            for path in files
            if path
        ]

    def list_wiki_pages(self, workspace: KnowledgeWorkspaceRecord) -> list[WikiPage]:
        pages: list[WikiPage] = []
        for file in self.list_files(workspace, WIKI_DIR):
            if not file.path.endswith(".md"):
                continue
            try:
                pages.append(WikiPage(workspace=workspace, path=file.path, content=self.read_text(workspace, file.path)))
            except FileNotFoundError:
                continue
        return pages


def normalize_workspace_path(value: str) -> str:
    normalized = PurePosixPath(str(value or "").replace("\\", "/")).as_posix().lstrip("/")
    if normalized in {"", "."}:
        raise ValueError("Workspace path is required.")
    if normalized == ".." or normalized.startswith("../") or "/../" in normalized:
        raise ValueError("Workspace path must stay within the wiki workspace.")
    return normalized


def ensure_workspace_initialized(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
) -> None:
    store.write_text_if_missing(
        workspace,
        "purpose.md",
        f"# {workspace.name}\n\nDescribe how agents should use this knowledge workspace.\n",
    )
    store.write_text_if_missing(
        workspace,
        "schema.md",
        "# Workspace Schema\n\n"
        "- sources: source summaries and extracted evidence entry points\n"
        "- entities: named things\n"
        "- concepts: reusable ideas\n"
        "- synthesis: cross-source synthesis\n"
        "- comparisons: explicit comparisons\n"
        "- queries: saved investigation outputs\n",
    )
    store.write_text_if_missing(workspace, ".llm-wiki/ingest-queue.json", "[]\n")
    store.write_text_if_missing(workspace, ".llm-wiki/ingest-cache.json", "{\n  \"entries\": {}\n}\n")
    store.write_text_if_missing(workspace, ".llm-wiki/image-caption-cache.json", "{}\n")
    store.write_text_if_missing(workspace, "wiki/index.md", _frontmatter("Index", "index", []) + "# Index\n")
    store.write_text_if_missing(workspace, "wiki/log.md", _frontmatter("Log", "log", []) + "# Log\n")
    store.write_text_if_missing(workspace, "wiki/overview.md", _frontmatter("Overview", "overview", []) + "# Overview\n")


def sync_indexed_document_to_workspace(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    job: QueuedKnowledgeBuildJob,
    indexed_document: IndexedDocument,
    content_sha256: str | None,
    llm_ingest_enabled: bool = False,
    llm_generated_pages: dict[str, str] | None = None,
    observer: Any | None = None,
) -> list[str]:
    ensure_workspace_initialized(store=store, workspace=workspace)
    slug = source_slug(job.display_name, job.document_id)
    raw_cache_path = f"raw/sources/.cache/{slug}.txt"
    source_page_path = f"wiki/sources/{slug}.md"
    generated_pages = llm_generated_pages
    if generated_pages is None and llm_ingest_enabled:
        generated_pages = _generate_llm_wiki_pages(
            store=store,
            workspace=workspace,
            job=job,
            indexed_document=indexed_document,
            source_page_path=source_page_path,
            observer=observer,
        )
    pages = _build_wiki_pages_for_indexed_document(
        job=job,
        indexed_document=indexed_document,
        source_id=slug,
        raw_cache_path=raw_cache_path,
        source_page_path=source_page_path,
        llm_generated_pages=generated_pages or {},
    )
    shared_written_paths = _merge_generated_pages(
        store=store,
        workspace=workspace,
        job=job,
        generated_pages=generated_pages or {},
    )
    files_written = [*pages.keys(), raw_cache_path]
    for path in shared_written_paths:
        if path not in files_written:
            files_written.append(path)
    _delete_stale_cached_files(
        store=store,
        workspace=workspace,
        source_file_name=job.file_name,
        source_id=slug,
        next_files_written=files_written,
    )
    for page_path, page_content in pages.items():
        store.write_text(workspace, page_path, page_content)
    store.write_text(workspace, raw_cache_path, indexed_document.canonical_markdown)
    _update_ingest_cache(
        store=store,
        workspace=workspace,
        source_file_name=job.file_name,
        source_content=indexed_document.canonical_markdown,
        content_sha256=content_sha256,
        files_written=files_written,
    )
    _rewrite_workspace_overview_if_needed(
        store=store,
        workspace=workspace,
        generated_paths=set(generated_pages or {}),
    )
    if "wiki/log.md" not in (generated_pages or {}):
        _append_workspace_log(store=store, workspace=workspace, job=job, files_written=files_written)
    return files_written


def _generate_llm_wiki_pages(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    job: QueuedKnowledgeBuildJob,
    indexed_document: IndexedDocument,
    source_page_path: str,
    observer: Any | None,
) -> dict[str, str]:
    try:
        result = generate_llm_wiki_files(
            job=job,
            indexed_document=indexed_document,
            purpose=_read_workspace_file_if_present(store, workspace, "purpose.md"),
            schema=_read_workspace_file_if_present(store, workspace, "schema.md"),
            index=_read_workspace_file_if_present(store, workspace, "wiki/index.md"),
            overview=_read_workspace_file_if_present(store, workspace, "wiki/overview.md"),
            source_page_path=source_page_path,
        )
    except Exception as exc:  # pragma: no cover - provider/network variability
        _observer_log_event(
            observer,
            stage="workspace",
            step_name="llm_wiki_ingest",
            status="warning",
            message=f"llm_wiki generation failed for {job.display_name}: {exc}",
        )
        return {}
    _log_llm_wiki_result(observer=observer, job=job, result=result)
    return result.files


def _log_llm_wiki_result(*, observer: Any | None, job: QueuedKnowledgeBuildJob, result: LlmWikiIngestResult) -> None:
    status = "completed" if result.files else "warning"
    message = (
        f"Generated {len(result.files)} llm_wiki page(s) for {job.display_name}"
        if result.files
        else f"No llm_wiki page blocks were generated for {job.display_name}"
    )
    metadata = {
        "files": sorted(result.files),
        "warnings": result.warnings,
        "analysis_chars": result.analysis_chars,
    }
    _observer_log_event(
        observer,
        stage="workspace",
        step_name="llm_wiki_ingest",
        status=status,
        message=message,
        metadata=metadata,
    )


def _observer_log_event(observer: Any | None, **kwargs: Any) -> None:
    if observer is None or not hasattr(observer, "log_event"):
        return
    observer.log_event(**kwargs)


def _read_workspace_file_if_present(
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    path: str,
) -> str:
    try:
        return store.read_text(workspace, path)
    except FileNotFoundError:
        return ""


def _merge_generated_pages(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    job: QueuedKnowledgeBuildJob,
    generated_pages: dict[str, str],
) -> list[str]:
    written_paths: list[str] = []
    today = time.strftime("%Y-%m-%d")
    for path in sorted(generated_pages):
        content = generated_pages[path]
        if path == "wiki/log.md":
            _append_generated_log(store=store, workspace=workspace, content=content)
            written_paths.append(path)
            continue
        if path in {"wiki/index.md", "wiki/overview.md"}:
            store.write_text(workspace, path, content.rstrip() + "\n")
            written_paths.append(path)
            continue
        try:
            existing = store.read_text(workspace, path)
        except FileNotFoundError:
            existing = None
        merged = merge_page_content(
            new_content=content,
            existing_content=existing,
            source_file_name=job.file_name,
            today=today,
        )
        store.write_text(workspace, path, merged)
        written_paths.append(path)
    return written_paths


def _append_generated_log(*, store: KnowledgeWorkspaceStore, workspace: KnowledgeWorkspaceRecord, content: str) -> None:
    try:
        existing = store.read_text(workspace, "wiki/log.md").rstrip()
    except FileNotFoundError:
        existing = _frontmatter("Log", "log", []) + "# Log"
    # llm_wiki asks the model to emit just the new log entry; if a provider
    # returns a full page anyway, append only the body so log frontmatter stays
    # single-owner and append-only.
    entry = _frontmatter_body_text(content).strip() if _frontmatter_match(content) else content.strip()
    if not entry:
        return
    store.write_text(workspace, "wiki/log.md", existing + "\n\n" + entry + "\n")


def search_workspaces(
    *,
    store: KnowledgeWorkspaceStore,
    workspaces: list[KnowledgeWorkspaceRecord],
    query: str,
    limit: int = MAX_SEARCH_RESULTS,
) -> dict[str, Any]:
    query = str(query or "").strip()
    if not query:
        return {"query": query, "results": [], "next_steps": ["Provide a non-empty query."]}
    tokens = tokenize_query(query)
    effective_tokens = tokens or [query.lower()]
    query_phrase = TRIM_PUNCT_RE.sub("", query.strip().lower())
    scored: list[dict[str, Any]] = []
    for workspace in workspaces:
        for page in store.list_wiki_pages(workspace):
            item = score_wiki_page(
                workspace=workspace,
                page_path=page.path,
                content=page.content,
                tokens=effective_tokens,
                query_phrase=query_phrase,
                query=query,
            )
            if item is not None:
                scored.append(item)

    token_sorted = sorted(scored, key=lambda item: (-float(item["raw_score"]), str(item["path"])))
    for index, item in enumerate(token_sorted, start=1):
        item["score"] = 1 / (RRF_K + index)
        item.pop("raw_score", None)
    token_sorted.sort(key=lambda item: (-float(item["score"]), str(item["workspace_id"]), str(item["path"])))
    return {
        "query": query,
        "result_count": len(token_sorted),
        "results": token_sorted[: max(1, min(limit, MAX_SEARCH_RESULTS))],
        "next_steps": [
            "Use get_wiki_page(workspace_name_or_id=..., page_path=...) to inspect a page before answering.",
            "Use get_source_evidence(workspace_name_or_id=..., query=...) when the wiki page indicates the original extracted source is needed.",
        ],
    }


def build_workspace_file_tree(
    *,
    store: KnowledgeWorkspaceStore,
    workspaces: list[KnowledgeWorkspaceRecord],
) -> dict[str, Any]:
    return {
        "workspaces": [
            {
                "workspace_id": workspace.id,
                "name": workspace.name,
                "owner_id": workspace.owner_id,
                "tree": _tree_from_paths([file.path for file in store.list_files(workspace)]),
            }
            for workspace in workspaces
        ]
    }


def get_wiki_page_payload(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    page_path: str,
) -> dict[str, Any]:
    safe_path = normalize_workspace_path(page_path)
    if not safe_path.startswith("wiki/"):
        safe_path = normalize_workspace_path(f"wiki/{safe_path}")
    if not safe_path.endswith(".md"):
        safe_path = f"{safe_path}.md"
    content = store.read_text(workspace, safe_path)
    return {
        "workspace": _workspace_payload(workspace),
        "page": {
            "path": safe_path,
            "title": extract_title(content, PurePosixPath(safe_path).name),
            "type": extract_type(content),
            "content": content,
        },
        "next_steps": [
            "Cite the page path when using this content.",
            "Use get_source_evidence if the answer needs narrower original-source excerpts.",
        ],
    }


def get_source_evidence_payload(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    query: str,
    source_path_or_name: str | None = None,
    max_snippets: int = 5,
) -> dict[str, Any]:
    query = str(query or "").strip()
    cache_files = [
        file
        for file in store.list_files(workspace, "raw/sources/.cache")
        if file.path.endswith(".txt") or file.path.endswith(".md")
    ]
    candidate = str(source_path_or_name or "").strip().casefold()
    if candidate:
        cache_files = [
            file
            for file in cache_files
            if candidate in file.path.casefold() or candidate == PurePosixPath(file.path).name.casefold()
        ]
    tokens = tokenize_query(query) or ([query.casefold()] if query else [])
    snippets: list[dict[str, Any]] = []
    for file in cache_files:
        try:
            content = store.read_text(workspace, file.path)
        except FileNotFoundError:
            continue
        for snippet in _source_snippets(content=content, query=query, tokens=tokens):
            snippets.append({"source_path": file.path, "text": snippet})
            if len(snippets) >= max(1, min(max_snippets, 12)):
                break
        if len(snippets) >= max(1, min(max_snippets, 12)):
            break
    return {
        "workspace": _workspace_payload(workspace),
        "query": query,
        "source_path_or_name": source_path_or_name,
        "snippets": snippets,
        "next_steps": [
            "Use these snippets as original-source evidence, then cite the source_path and related wiki page path.",
        ],
    }


def build_knowledge_graph_payload(
    *,
    store: KnowledgeWorkspaceStore,
    workspaces: list[KnowledgeWorkspaceRecord],
) -> dict[str, Any]:
    return {
        "workspaces": [
            {
                "workspace": _workspace_payload(workspace),
                **_build_graph_for_workspace(store=store, workspace=workspace),
            }
            for workspace in workspaces
        ]
    }


def tokenize_query(query: str) -> list[str]:
    raw_tokens = [
        token
        for token in SPLIT_RE.split(query.lower())
        if len(token) > 1 and token not in STOP_WORDS
    ]
    tokens: list[str] = []
    for token in raw_tokens:
        if re.search(r"[\u4e00-\u9fff\u3400-\u4dbf]", token) and len(token) > 2:
            chars = list(token)
            tokens.extend(chars[index] + chars[index + 1] for index in range(len(chars) - 1))
            tokens.extend(char for char in chars if char not in STOP_WORDS)
            tokens.append(token)
        else:
            tokens.append(token)
    return list(dict.fromkeys(tokens))


def score_wiki_page(
    *,
    workspace: KnowledgeWorkspaceRecord,
    page_path: str,
    content: str,
    tokens: list[str],
    query_phrase: str,
    query: str,
) -> dict[str, Any] | None:
    file_name = PurePosixPath(page_path).name
    title = extract_title(content, file_name)
    title_text = f"{title} {file_name}"
    title_lower = title_text.lower()
    content_lower = content.lower()
    file_stem = file_name.removesuffix(".md").lower()

    filename_exact = file_stem == query_phrase
    title_has_phrase = bool(query_phrase and query_phrase in title_lower)
    content_phrase_count = min(_count_occurrences(content_lower, query_phrase), MAX_PHRASE_OCC_COUNTED)
    title_token_score = _token_match_score(title_text, tokens)
    content_token_score = _token_match_score(content, tokens)
    if not any([filename_exact, title_has_phrase, content_phrase_count, title_token_score, content_token_score]):
        return None
    score = (
        (FILENAME_EXACT_BONUS if filename_exact else 0)
        + (PHRASE_IN_TITLE_BONUS if title_has_phrase else 0)
        + content_phrase_count * PHRASE_IN_CONTENT_PER_OCC
        + title_token_score * TITLE_TOKEN_WEIGHT
        + content_token_score * CONTENT_TOKEN_WEIGHT
    )
    snippet_anchor = query_phrase if content_phrase_count else next((token for token in tokens if token in content_lower), query)
    return {
        "workspace_id": workspace.id,
        "workspace_name": workspace.name,
        "path": page_path,
        "title": title,
        "type": extract_type(content),
        "snippet": _build_snippet(content, snippet_anchor),
        "title_match": bool(title_token_score or title_has_phrase),
        "raw_score": score,
        "images": _extract_image_refs(content),
    }


def extract_title(content: str, file_name: str) -> str:
    match = TITLE_FM_RE.search(_frontmatter_body(content))
    if match:
        return match.group(1).strip()
    heading_match = HEADING_RE.search(content)
    if heading_match:
        return heading_match.group(1).strip()
    return file_name.removesuffix(".md").replace("-", " ")


def extract_type(content: str) -> str:
    match = TYPE_FM_RE.search(_frontmatter_body(content))
    if match:
        return match.group(1).strip().lower()
    return "other"


def source_slug(display_name: str, document_id: str) -> str:
    source_path = PurePosixPath(str(display_name or "source").replace("\\", "/"))
    stem = source_path.with_suffix("").as_posix()
    slug = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff\u3400-\u4dbf]+", "-", stem).strip("-").lower()
    if not slug:
        slug = "source"
    return f"{slug}-{document_id[:8]}"


def _build_wiki_pages_for_indexed_document(
    *,
    job: QueuedKnowledgeBuildJob,
    indexed_document: IndexedDocument,
    source_id: str,
    raw_cache_path: str,
    source_page_path: str,
    llm_generated_pages: dict[str, str],
) -> dict[str, str]:
    pages = dict(llm_generated_pages)
    if source_page_path in pages:
        pages[source_page_path] = _ensure_source_page_metadata(
            content=pages[source_page_path],
            job=job,
            source_id=source_id,
            raw_cache_path=raw_cache_path,
        )
        return pages

    # PageIndex remains the evidence extractor. It no longer emits faux
    # concept pages because those polluted the llm-wiki graph with
    # per-section retrieval scaffolding. When the LLM does not produce a
    # source page, write one narrow evidence entry point so raw excerpts stay
    # reachable through get_source_evidence.
    pages[source_page_path] = _build_source_page(
        job=job,
        indexed_document=indexed_document,
        source_id=source_id,
        raw_cache_path=raw_cache_path,
    )
    return pages


def _build_source_page(
    *,
    job: QueuedKnowledgeBuildJob,
    indexed_document: IndexedDocument,
    source_id: str,
    raw_cache_path: str,
) -> str:
    sources = [job.file_name]
    today = time.strftime("%Y-%m-%d")
    header = _frontmatter(
        indexed_document.display_name,
        "source",
        sources,
        extra={
            "created": today,
            "updated": today,
            "tags": [],
            "related": [],
            "document_id": job.document_id,
        },
    )
    node_lines = []
    for node in indexed_document.nodes[:MAX_SOURCE_STRUCTURE_NODES]:
        label = node.title.strip() or node.node_id
        locator = f"p.{node.page_start}" if node.page_start else f"line {node.line_start}" if node.line_start else node.node_id
        summary = node.summary or node.visual_summary or node.prefix_summary or ""
        node_lines.append(f"- **{label}** ({locator}): {summary}".rstrip())
    canonical_excerpt = indexed_document.canonical_markdown.strip()
    if len(canonical_excerpt) > MAX_SOURCE_TEXT_PREVIEW_CHARS:
        canonical_excerpt = (
            canonical_excerpt[:MAX_SOURCE_TEXT_PREVIEW_CHARS].rstrip()
            + "\n\n[Truncated in wiki source page; full extracted text is stored in raw cache.]"
        )
    return (
        f"{header}"
        f"# {indexed_document.display_name}\n\n"
        f"Original file: `{job.file_name}`\n\n"
        f"Raw cache: `{raw_cache_path}`\n\n"
        f"{indexed_document.doc_description or ''}\n\n"
        + "## Structure\n\n"
        + ("\n".join(node_lines) if node_lines else "No structured nodes were produced.")
        + "\n\n## Extracted Text Preview\n\n"
        + canonical_excerpt
        + "\n"
    )


SOURCE_EVIDENCE_MARKER = "<!-- openagents:source-evidence -->"


def _ensure_source_page_metadata(
    *,
    content: str,
    job: QueuedKnowledgeBuildJob,
    source_id: str,
    raw_cache_path: str,
) -> str:
    section = (
        f"{SOURCE_EVIDENCE_MARKER}\n"
        "## Source Evidence\n\n"
        f"- Original file: `{job.file_name}`\n"
        f"- Raw cache: `{raw_cache_path}`\n"
        f"- Source id: `{source_id}`\n"
        f"{SOURCE_EVIDENCE_MARKER}"
    )
    # The marker keeps OpenAgents-owned evidence metadata idempotent while the
    # model remains responsible for the domain summary above it.
    stripped = re.sub(
        rf"\n*{re.escape(SOURCE_EVIDENCE_MARKER)}[\s\S]*?{re.escape(SOURCE_EVIDENCE_MARKER)}\n*",
        "\n\n",
        content.rstrip(),
    ).rstrip()
    return stripped + "\n\n" + section + "\n"


def _frontmatter(title: str, page_type: str, sources: list[str], extra: dict[str, Any] | None = None) -> str:
    lines = ["---", f"title: {json.dumps(title, ensure_ascii=False)}", f"type: {json.dumps(page_type)}"]
    if sources:
        lines.append("sources:")
        lines.extend(f"  - {json.dumps(source, ensure_ascii=False)}" for source in sources)
    for key, value in (extra or {}).items():
        if isinstance(value, list):
            lines.append(f"{key}: [{', '.join(json.dumps(item, ensure_ascii=False) for item in value)}]")
        else:
            lines.append(f"{key}: {json.dumps(value, ensure_ascii=False)}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def _update_ingest_cache(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    source_file_name: str,
    source_content: str,
    content_sha256: str | None,
    files_written: list[str],
) -> None:
    try:
        payload = json.loads(store.read_text(workspace, ".llm-wiki/ingest-cache.json"))
    except Exception:
        payload = {"entries": {}}
    entries = payload.get("entries")
    if not isinstance(entries, dict):
        entries = {}
    entries[source_file_name] = {
        "hash": content_sha256 or hashlib.sha256(source_content.encode("utf-8")).hexdigest(),
        "timestamp": int(time.time() * 1000),
        "filesWritten": files_written,
    }
    payload["entries"] = entries
    store.write_text(workspace, ".llm-wiki/ingest-cache.json", json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _delete_stale_cached_files(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    source_file_name: str,
    source_id: str,
    next_files_written: list[str],
) -> None:
    try:
        payload = json.loads(store.read_text(workspace, ".llm-wiki/ingest-cache.json"))
    except Exception:
        return
    entries = payload.get("entries")
    if not isinstance(entries, dict):
        return
    entry = entries.get(source_file_name)
    if not isinstance(entry, dict):
        return
    previous_files = entry.get("filesWritten")
    if not isinstance(previous_files, list):
        return
    keep = set(next_files_written)
    for path in previous_files:
        if not isinstance(path, str) or path in keep:
            continue
        if path in {"wiki/index.md", "wiki/overview.md", "wiki/log.md"}:
            continue
        # Source-owned paths are safe to delete outright. Shared entity/concept
        # pages may be contributed by multiple source ingests, so stale cleanup
        # removes only this source from frontmatter and deletes the page only
        # when no source contributors remain.
        try:
            if _is_source_owned_workspace_path(path, source_id):
                store.delete_file(workspace, path)
            else:
                _remove_source_from_shared_page(
                    store=store,
                    workspace=workspace,
                    path=path,
                    source_file_name=source_file_name,
                )
        except FileNotFoundError:
            continue


def _is_source_owned_workspace_path(path: str, source_id: str) -> bool:
    return (
        path.startswith("raw/sources/.cache/")
        or path == f"wiki/sources/{source_id}.md"
        or path.startswith(f"wiki/concepts/{source_id}--")
    )


def _remove_source_from_shared_page(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    path: str,
    source_file_name: str,
) -> None:
    if not path.startswith("wiki/") or not path.endswith(".md"):
        store.delete_file(workspace, path)
        return
    content = store.read_text(workspace, path)
    updated, should_delete = remove_source_from_frontmatter(content, source_file_name)
    if should_delete:
        store.delete_file(workspace, path)
        return
    store.write_text(workspace, path, updated)


def _rewrite_workspace_overview_if_needed(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    generated_paths: set[str],
) -> None:
    if "wiki/index.md" in generated_paths and "wiki/overview.md" in generated_paths:
        return

    pages = store.list_wiki_pages(workspace)
    # Multi-document workspaces rewrite the overview after each source ingest;
    # sort by path because WikiPage is a value object with no natural ordering.
    source_pages = sorted((page for page in pages if page.path.startswith("wiki/sources/")), key=lambda page: page.path)
    concept_pages = sorted((page for page in pages if page.path.startswith("wiki/concepts/")), key=lambda page: page.path)
    entity_pages = sorted((page for page in pages if page.path.startswith("wiki/entities/")), key=lambda page: page.path)
    comparison_pages = sorted((page for page in pages if page.path.startswith("wiki/comparisons/")), key=lambda page: page.path)
    synthesis_pages = sorted((page for page in pages if page.path.startswith("wiki/synthesis/")), key=lambda page: page.path)

    index_lines = [_frontmatter("Index", "index", []), "# Index\n"]
    for section_title, section_pages in [
        ("Sources", source_pages),
        ("Entities", entity_pages),
        ("Concepts", concept_pages),
        ("Comparisons", comparison_pages),
        ("Synthesis", synthesis_pages),
    ]:
        if not section_pages:
            continue
        index_lines.extend(["", f"## {section_title}", ""])
        for page in section_pages:
            title = extract_title(page.content, PurePosixPath(page.path).name)
            summary = _page_index_summary(page.content)
            suffix = f" — {summary}" if summary else ""
            index_lines.append(f"- [[{PurePosixPath(page.path).stem}|{title}]] (`{page.path}`){suffix}")

    overview_lines = [
        _frontmatter("Overview", "overview", []),
        "# Overview",
        "",
        f"{workspace.name} contains {len(source_pages)} source page(s), {len(concept_pages)} concept page(s), "
        f"{len(entity_pages)} entity page(s), {len(comparison_pages)} comparison page(s), and {len(synthesis_pages)} synthesis page(s).",
        "",
    ]
    overview_lines.extend(_overview_section("Source Coverage", source_pages, limit=12))
    overview_lines.extend(_overview_section("Core Concepts", concept_pages, limit=16))
    overview_lines.extend(_overview_section("Entities", entity_pages, limit=12))
    overview_lines.extend(_overview_section("Synthesis", synthesis_pages, limit=8))

    # llm-wiki treats index/overview as model-maintained wiki files. The
    # deterministic fallback is only used when a provider omitted either page,
    # so successful compiled overviews are not overwritten by a path catalog.
    if "wiki/index.md" not in generated_paths:
        store.write_text(workspace, "wiki/index.md", "\n".join(index_lines).rstrip() + "\n")
    if "wiki/overview.md" not in generated_paths:
        store.write_text(workspace, "wiki/overview.md", "\n".join(overview_lines).rstrip() + "\n")


def _overview_section(title: str, pages: list[WikiPage], *, limit: int) -> list[str]:
    if not pages:
        return []
    lines = [f"## {title}", ""]
    for page in pages[:limit]:
        page_title = extract_title(page.content, PurePosixPath(page.path).name)
        summary = _page_index_summary(page.content)
        suffix = f": {summary}" if summary else ""
        lines.append(f"- [[{PurePosixPath(page.path).stem}|{page_title}]]{suffix}")
    if len(pages) > limit:
        lines.append(f"- ... {len(pages) - limit} more page(s)")
    lines.append("")
    return lines


def _page_index_summary(content: str) -> str:
    body = FRONTMATTER_RE.sub("", content, count=1).strip()
    lines: list[str] = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("---"):
            continue
        if line.startswith("Original file:") or line.startswith("Raw cache:"):
            continue
        line = re.sub(r"\s+", " ", line)
        lines.append(line)
        if sum(len(item) for item in lines) > 260:
            break
    return _trim_excerpt(" ".join(lines), 260)


def _trim_excerpt(text: str, limit: int) -> str:
    compact = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(compact) <= limit:
        return compact
    return compact[:limit].rstrip() + "..."


def _append_workspace_log(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    job: QueuedKnowledgeBuildJob,
    files_written: list[str],
) -> None:
    try:
        existing = store.read_text(workspace, "wiki/log.md").rstrip()
    except FileNotFoundError:
        existing = _frontmatter("Log", "log", []) + "# Log"
    line = f"- {time.strftime('%Y-%m-%d %H:%M:%S')}: indexed `{job.file_name}` -> {', '.join(files_written)}"
    store.write_text(workspace, "wiki/log.md", existing + "\n" + line + "\n")


def _build_graph_for_workspace(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
) -> dict[str, Any]:
    raw_nodes: dict[str, dict[str, Any]] = {}
    for page in store.list_wiki_pages(workspace):
        node_id = PurePosixPath(page.path).stem
        node_type = extract_type(page.content)
        if node_type == "query":
            continue
        raw_nodes[node_id] = {
            "id": node_id,
            "label": extract_title(page.content, PurePosixPath(page.path).name),
            "type": node_type,
            "path": page.path,
            "sources": _extract_sources(page.content),
            "links": _extract_workspace_links(page.content),
            "out": set(),
            "in": set(),
        }
    for source_id, node in raw_nodes.items():
        for raw_link in node["links"]:
            target_id = _resolve_link_target(raw_link, raw_nodes)
            if target_id and target_id != source_id:
                node["out"].add(target_id)
                raw_nodes[target_id]["in"].add(source_id)

    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for source_id, node in raw_nodes.items():
        for target_id in sorted(node["out"]):
            key = tuple(sorted((source_id, target_id)))
            if key in seen:
                continue
            seen.add(key)
            edges.append(
                {
                    "source": source_id,
                    "target": target_id,
                    "weight": _calculate_relevance(raw_nodes[source_id], raw_nodes[target_id], raw_nodes),
                }
            )

    assignments, communities = _louvain_style_communities(raw_nodes, edges)
    nodes = [
        {
            "id": node["id"],
            "label": node["label"],
            "type": node["type"],
            "path": node["path"],
            "linkCount": len(node["out"]) + len(node["in"]),
            "community": assignments.get(node["id"], 0),
        }
        for node in raw_nodes.values()
    ]
    nodes.sort(key=lambda item: (item["community"], item["type"], item["label"]))
    return {
        "nodes": nodes,
        "edges": edges,
        "communities": communities,
        "insights": _graph_insights(nodes, edges, communities),
    }


def _calculate_relevance(a: dict[str, Any], b: dict[str, Any], graph_nodes: dict[str, dict[str, Any]]) -> float:
    direct = (1 if b["id"] in a["out"] else 0) + (1 if a["id"] in b["out"] else 0)
    source_overlap = len(set(a["sources"]).intersection(set(b["sources"])))
    neighbors_a = set(a["out"]).union(set(a["in"]))
    neighbors_b = set(b["out"]).union(set(b["in"]))
    adamic = 0.0
    for neighbor_id in neighbors_a.intersection(neighbors_b):
        neighbor = graph_nodes.get(neighbor_id)
        if not neighbor:
            continue
        degree = len(neighbor["out"]) + len(neighbor["in"])
        adamic += 1 / math.log(max(degree, 2))
    affinity = TYPE_AFFINITY.get(str(a["type"]), {}).get(str(b["type"]), 0.5)
    return round(direct * 3.0 + source_overlap * 4.0 + adamic * 1.5 + affinity, 3)


def _louvain_style_communities(
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    adjacency = {node_id: {} for node_id in nodes}
    for edge in edges:
        weight = float(edge.get("weight") or 1.0)
        adjacency[edge["source"]][edge["target"]] = adjacency[edge["source"]].get(edge["target"], 0.0) + weight
        adjacency[edge["target"]][edge["source"]] = adjacency[edge["target"]].get(edge["source"], 0.0) + weight
    node_ids = sorted(nodes)
    assignments: dict[str, int] = {node_id: index for index, node_id in enumerate(node_ids)}
    degrees = {node_id: sum(adjacency[node_id].values()) for node_id in node_ids}
    community_totals: dict[int, float] = {assignments[node_id]: degrees[node_id] for node_id in node_ids}
    total_weight = sum(float(edge.get("weight") or 1.0) for edge in edges)

    if total_weight > 0:
        m2 = 2.0 * total_weight
        # This is the deterministic first phase of Louvain local moving. It
        # follows llm_wiki's community intent without adding a Python graph
        # dependency to the worker image.
        for _iteration in range(20):
            moved = False
            for node_id in node_ids:
                current = assignments[node_id]
                node_degree = degrees[node_id]
                community_totals[current] = community_totals.get(current, 0.0) - node_degree
                weights_by_community: dict[int, float] = {}
                for neighbor_id, weight in adjacency[node_id].items():
                    community_id = assignments[neighbor_id]
                    weights_by_community[community_id] = weights_by_community.get(community_id, 0.0) + weight
                best_community = current
                best_gain = 0.0
                for community_id in sorted(weights_by_community):
                    gain = weights_by_community[community_id] - node_degree * community_totals.get(community_id, 0.0) / m2
                    if gain > best_gain + 1e-9:
                        best_gain = gain
                        best_community = community_id
                assignments[node_id] = best_community
                community_totals[best_community] = community_totals.get(best_community, 0.0) + node_degree
                if best_community != current:
                    moved = True
            if not moved:
                break

    groups: dict[int, list[str]] = {}
    for node_id, community_id in assignments.items():
        groups.setdefault(community_id, []).append(node_id)
    edge_set = {tuple(sorted((edge["source"], edge["target"]))) for edge in edges}
    communities: list[dict[str, Any]] = []
    for community_id, members in groups.items():
        possible = len(members) * (len(members) - 1) / 2 if len(members) > 1 else 1
        actual = sum(1 for left, right in edge_set if left in members and right in members)
        top = sorted(members, key=lambda item: len(nodes[item]["out"]) + len(nodes[item]["in"]), reverse=True)[:5]
        communities.append(
            {
                "id": community_id,
                "nodeCount": len(members),
                "cohesion": round(actual / possible, 3),
                "topNodes": [nodes[item]["label"] for item in top],
            }
        )
    communities.sort(key=lambda item: (-int(item["nodeCount"]), int(item["id"])))
    # llm_wiki renumbers communities after sorting by size so node.community
    # points at the displayed community order, not an incidental DFS order.
    remap: dict[int, int] = {}
    for next_id, community in enumerate(communities):
        old_id = int(community["id"])
        remap[old_id] = next_id
        community["id"] = next_id
    assignments = {node_id: remap.get(community_id, community_id) for node_id, community_id in assignments.items()}
    return assignments, communities


def _graph_insights(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    communities: list[dict[str, Any]],
) -> dict[str, Any]:
    structural = {"index", "log", "overview"}
    isolated = [
        node
        for node in nodes
        if int(node["linkCount"]) <= 1 and node["id"] not in structural and node["type"] != "overview"
    ][:8]
    sparse = [
        community
        for community in communities
        if float(community.get("cohesion") or 0) < 0.15 and int(community.get("nodeCount") or 0) >= 3
    ][:5]
    return {
        "isolated_nodes": [{"id": node["id"], "label": node["label"]} for node in isolated],
        "sparse_communities": sparse,
        "edge_count": len(edges),
    }


def _workspace_payload(workspace: KnowledgeWorkspaceRecord) -> dict[str, Any]:
    return {
        "workspace_id": workspace.id,
        "name": workspace.name,
        "owner_id": workspace.owner_id,
        "description": workspace.description,
        "ready_document_count": workspace.ready_document_count,
        "document_count": workspace.document_count,
    }


def _tree_from_paths(paths: list[str]) -> list[dict[str, Any]]:
    root: dict[str, Any] = {"children": {}}
    for path in sorted(paths):
        current = root
        parts = path.split("/")
        for index, part in enumerate(parts):
            children = current.setdefault("children", {})
            current = children.setdefault(part, {"name": part, "path": "/".join(parts[: index + 1]), "children": {}})
        current["is_dir"] = False
    return _tree_children(root)


def _tree_children(node: dict[str, Any]) -> list[dict[str, Any]]:
    children = []
    for child in sorted(node.get("children", {}).values(), key=lambda item: (not item.get("children"), item["name"])):
        payload = {"name": child["name"], "path": child["path"], "is_dir": bool(child.get("children"))}
        nested = _tree_children(child)
        if nested:
            payload["children"] = nested
        children.append(payload)
    return children


def _frontmatter_body(content: str) -> str:
    match = FRONTMATTER_RE.search(content)
    return match.group("body") if match else ""


def _frontmatter_match(content: str) -> re.Match[str] | None:
    return FRONTMATTER_RE.match(content or "")


def _frontmatter_body_text(content: str) -> str:
    match = _frontmatter_match(content)
    if not match:
        return content
    return content[match.end() :].lstrip("\n")


def _extract_sources(content: str) -> list[str]:
    fm = _frontmatter_body(content)
    sources: list[str] = []
    block_match = SOURCES_BLOCK_RE.search(fm)
    if block_match:
        for line in block_match.group(1).splitlines():
            item = re.sub(r"^\s+-\s+", "", line).strip().strip("\"'")
            if item:
                sources.append(item)
    inline_match = SOURCES_INLINE_RE.search(fm)
    if inline_match:
        sources.extend(item.strip().strip("\"'") for item in inline_match.group(1).split(",") if item.strip())
    return list(dict.fromkeys(sources))


def _extract_workspace_links(content: str) -> list[str]:
    """Return body wikilinks plus normalized frontmatter related slugs.

    llm_wiki primarily expects relationship edges to appear as body
    `[[wikilink]]` references. Provider output can still put those relations
    only in `related`, so the graph treats normalized `related` values as
    curated edges instead of relying on malformed YAML wikilinks.
    """

    links = list(WIKILINK_RE.findall(content))
    fm = _frontmatter_body(content)
    related_match = re.search(r"^related:\s*\[([^\]]*)\]", fm, re.MULTILINE)
    if related_match:
        links.extend(item.strip().strip("\"'") for item in related_match.group(1).split(",") if item.strip())
    related_block_match = re.search(r"^related:\s*\n((?:\s+-\s+.+\n?)*)", fm, re.MULTILINE)
    if related_block_match:
        for line in related_block_match.group(1).splitlines():
            links.append(re.sub(r"^\s+-\s+", "", line).strip().strip("\"'"))
    return list(dict.fromkeys(link for link in links if link))


def _resolve_link_target(raw: str, nodes: dict[str, dict[str, Any]]) -> str | None:
    raw_text = str(raw or "").strip()
    if raw_text in nodes:
        return raw_text
    normalized = raw_text.lower().replace(" ", "-")
    normalized_key = _link_resolution_key(raw_text)
    for node_id, node in nodes.items():
        node_lower = str(node_id).lower()
        if node_lower == normalized or node_lower == raw_text.lower() or node_lower.replace(" ", "-") == normalized:
            return str(node_id)
        # Providers sometimes use the display title in `related` while the
        # actual page filename uses punctuation-normalized slugs. Resolve both
        # through the same coarse key so curated graph edges survive.
        label = str(node.get("label") or "")
        if normalized_key and normalized_key in {_link_resolution_key(str(node_id)), _link_resolution_key(label)}:
            return str(node_id)
    return None


def _link_resolution_key(value: str) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "-", str(value or "").lower()).strip("-")


def _token_match_score(text: str, tokens: list[str]) -> int:
    lower = text.lower()
    return sum(1 for token in tokens if token and token in lower)


def _count_occurrences(haystack_lower: str, needle_lower: str) -> int:
    if not needle_lower:
        return 0
    count = 0
    pos = 0
    while True:
        index = haystack_lower.find(needle_lower, pos)
        if index < 0:
            return count
        count += 1
        pos = index + len(needle_lower)


def _build_snippet(content: str, query: str) -> str:
    lower = content.lower()
    needle = str(query or "").lower()
    index = lower.find(needle) if needle else -1
    if index < 0:
        return content[: SNIPPET_CONTEXT * 2].replace("\n", " ")
    start = max(0, index - SNIPPET_CONTEXT)
    end = min(len(content), index + len(needle) + SNIPPET_CONTEXT)
    snippet = content[start:end].replace("\n", " ")
    if start > 0:
        snippet = "..." + snippet
    if end < len(content):
        snippet += "..."
    return snippet


def _extract_image_refs(content: str) -> list[dict[str, str]]:
    seen: set[str] = set()
    refs: list[dict[str, str]] = []
    for match in IMAGE_REF_RE.finditer(content):
        url = match.group(2)
        if url in seen:
            continue
        seen.add(url)
        refs.append({"url": url, "alt": match.group(1)})
    return refs


def _source_snippets(*, content: str, query: str, tokens: list[str]) -> list[str]:
    lower = content.lower()
    anchors = [query.lower()] if query else []
    anchors.extend(token for token in tokens if token not in anchors)
    offsets: list[int] = []
    for anchor in anchors:
        if not anchor:
            continue
        pos = lower.find(anchor)
        while pos >= 0 and len(offsets) < 12:
            offsets.append(pos)
            pos = lower.find(anchor, pos + len(anchor))
        if offsets:
            break
    if not offsets:
        return [content[:1200].replace("\n", " ").strip()] if content.strip() else []
    snippets = []
    for offset in offsets[:8]:
        start = max(0, offset - 450)
        end = min(len(content), offset + 750)
        snippet = content[start:end].replace("\n", " ").strip()
        if start > 0:
            snippet = "..." + snippet
        if end < len(content):
            snippet += "..."
        snippets.append(snippet)
    return snippets
