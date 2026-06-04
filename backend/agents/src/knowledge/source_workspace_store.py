from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from src.knowledge.models import SourceDocument, KnowledgeWorkspaceRecord, QueuedKnowledgeBuildJob
from src.knowledge.storage import KnowledgeAssetStore, get_knowledge_asset_store

WORKSPACE_ROOT_DIR = "workspace"
SOURCE_DIR = "sources"


@dataclass(frozen=True)
class WorkspaceFile:
    path: str
    storage_ref: str


class KnowledgeWorkspaceStore:
    """Read/write the agent-facing source workspace for a knowledge base.

    Runtime agents only see normalized source Markdown files under `sources/`
    and use ordinary filesystem tools to search them. This store deliberately
    exposes no compiled wiki, PageTree, or chunk/index surface.
    """

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
            if path and _is_source_workspace_file(f"{safe_prefix}/{path}" if safe_prefix else path)
        ]


def normalize_workspace_path(value: str) -> str:
    normalized = PurePosixPath(str(value or "").replace("\\", "/")).as_posix().lstrip("/")
    if normalized in {"", "."}:
        raise ValueError("Workspace path is required.")
    if normalized == ".." or normalized.startswith("../") or "/../" in normalized:
        raise ValueError("Workspace path must stay within the knowledge workspace.")
    return normalized


def sync_source_document_to_workspace(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
    job: QueuedKnowledgeBuildJob,
    source_document: SourceDocument,
    content_sha256: str | None,
    observer: Any | None = None,
) -> list[str]:
    slug = source_slug(job.display_name, job.document_id)
    source_path = f"{SOURCE_DIR}/{slug}.md"
    _delete_non_source_workspace_files(store=store, workspace=workspace)
    store.write_text(workspace, source_path, source_document.canonical_markdown)
    files_written = [source_path]
    _observer_log_event(
        observer,
        stage="workspace",
        step_name="source_workspace_sync",
        status="completed",
        message=f"Wrote source workspace file for {job.display_name}",
        metadata={
            "files": files_written,
            "content_sha256": content_sha256,
        },
    )
    return files_written


def source_slug(display_name: str, document_id: str) -> str:
    source_path = PurePosixPath(str(display_name or "source").replace("\\", "/"))
    stem = source_path.with_suffix("").as_posix()
    slug = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff\u3400-\u4dbf]+", "-", stem).strip("-").lower()
    if not slug:
        slug = "source"
    return f"{slug}-{document_id[:8]}"


def _is_source_workspace_file(path: str) -> bool:
    normalized = str(path or "").replace("\\", "/").lstrip("/")
    return normalized.startswith(f"{SOURCE_DIR}/") and normalized.endswith(".md")


def _delete_non_source_workspace_files(
    *,
    store: KnowledgeWorkspaceStore,
    workspace: KnowledgeWorkspaceRecord,
) -> None:
    for file in store._asset_store.list_relative_paths(store.workspace_prefix(workspace)):  # noqa: SLF001 - cleanup needs raw workspace visibility.
        normalized = normalize_workspace_path(file)
        if _is_source_workspace_file(normalized):
            continue
        # Deprecated compiled/cache artifacts must not remain in the mounted
        # knowledge package because agents now reason from source text only.
        store.delete_file(workspace, normalized)


def _observer_log_event(observer: Any | None, **kwargs: Any) -> None:
    if observer is None or not hasattr(observer, "log_event"):
        return
    observer.log_event(**kwargs)
