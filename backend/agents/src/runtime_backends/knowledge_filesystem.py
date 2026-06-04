from __future__ import annotations

import fnmatch
from collections.abc import Iterable

from deepagents.backends.filesystem import (
    check_empty_content,
    format_content_with_line_numbers,
    format_read_pagination_footer,
)
from deepagents.backends.protocol import (
    BackendProtocol,
    EditResult,
    FileDownloadResponse,
    FileInfo,
    FileUploadResponse,
    GrepMatch,
    WriteResult,
)

from src.knowledge import KnowledgeService
from src.knowledge.models import KnowledgeWorkspaceRecord
from src.knowledge.runtime_mount import knowledge_workspace_mount_name
from src.knowledge.storage import KnowledgeAssetStore, get_knowledge_asset_store
from src.knowledge.source_workspace_store import KnowledgeWorkspaceStore, WorkspaceFile, normalize_workspace_path

KNOWLEDGE_ROUTE_PREFIX = "/mnt/user-data/knowledge/"
_MAX_GREP_MATCHES = 1000


class ThreadKnowledgeFilesystemBackend(BackendProtocol):
    """Expose attached knowledge workspaces as a read-only virtual filesystem.

    The route gives agents the same interaction loop as normal project files:
    `glob` to discover, `grep` to locate exact lines, and `read_file` to inspect
    bounded context. It intentionally does not reveal host paths, object-store
    keys, or database ids except through the stable workspace directory suffix.
    """

    def __init__(
        self,
        *,
        user_id: str,
        thread_id: str,
        service: KnowledgeService | None = None,
        asset_store: KnowledgeAssetStore | None = None,
    ) -> None:
        self._user_id = user_id
        self._thread_id = thread_id
        self._service = service or KnowledgeService()
        self._asset_store = asset_store
        self._workspace_store: KnowledgeWorkspaceStore | None = None

    @property
    def asset_store(self) -> KnowledgeAssetStore:
        if self._asset_store is None:
            self._asset_store = get_knowledge_asset_store()
        return self._asset_store

    @property
    def workspace_store(self) -> KnowledgeWorkspaceStore:
        if self._workspace_store is None:
            self._workspace_store = KnowledgeWorkspaceStore(asset_store=self.asset_store)
        return self._workspace_store

    def _workspaces(self) -> list[KnowledgeWorkspaceRecord]:
        return self._service.get_thread_workspace_records(
            user_id=self._user_id,
            thread_id=self._thread_id,
            ready_only=True,
        )

    def _workspace_aliases(self, workspace: KnowledgeWorkspaceRecord) -> set[str]:
        return {
            knowledge_workspace_mount_name(workspace),
            str(workspace.id or "").strip(),
            str(workspace.name or "").strip(),
        }

    def _resolve_workspace(self, segment: str) -> KnowledgeWorkspaceRecord | None:
        candidate = segment.strip()
        if not candidate:
            return None
        matches = [
            workspace
            for workspace in self._workspaces()
            if candidate in self._workspace_aliases(workspace)
        ]
        return matches[0] if len(matches) == 1 else None

    def _split_path(self, path: str | None) -> tuple[str | None, str]:
        normalized = _normalize_backend_path(path)
        if normalized == "/":
            return None, ""
        first, _, rest = normalized.lstrip("/").partition("/")
        return first, rest

    def _resolve_path(self, path: str | None) -> tuple[KnowledgeWorkspaceRecord | None, str]:
        workspace_segment, relative_path = self._split_path(path)
        if workspace_segment is None:
            return None, ""
        workspace = self._resolve_workspace(workspace_segment)
        if workspace is None:
            return None, relative_path
        if not relative_path:
            return workspace, ""
        return workspace, normalize_workspace_path(relative_path)

    def _list_files(self, workspace: KnowledgeWorkspaceRecord, relative_prefix: str = "") -> list[WorkspaceFile]:
        try:
            files = self.workspace_store.list_files(workspace, relative_prefix)
        except (FileNotFoundError, ValueError):
            return []
        if files or not relative_prefix:
            return files
        try:
            # `grep(path=<file>)` should behave like the normal filesystem
            # backend. Object-store directory listing APIs only list children,
            # so an exact file path needs a direct read probe.
            self.workspace_store.read_text(workspace, relative_prefix)
        except (FileNotFoundError, UnicodeDecodeError, ValueError):
            return []
        return [
            WorkspaceFile(
                path=relative_prefix,
                storage_ref=self.workspace_store.storage_ref(workspace, relative_prefix),
            )
        ]

    def ls_info(self, path: str) -> list[FileInfo]:
        workspace, relative_path = self._resolve_path(path)
        if workspace is None and _normalize_backend_path(path) == "/":
            return [
                {
                    "path": f"/{knowledge_workspace_mount_name(item)}/",
                    "is_dir": True,
                    "size": 0,
                    "modified_at": "",
                }
                for item in self._workspaces()
            ]
        if workspace is None:
            return []

        children: dict[str, FileInfo] = {}
        relative_dir = relative_path.strip("/")
        for file in self._list_files(workspace, relative_dir):
            child = _direct_child_path(
                workspace=workspace,
                base_relative_path=relative_dir,
                file_path=file.path,
            )
            if child is not None:
                children[child["path"]] = child
        return [children[key] for key in sorted(children)]

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        workspace, relative_path = self._resolve_path(file_path)
        if workspace is None or not relative_path:
            return f"Error: File '{file_path}' not found"
        try:
            content = self.workspace_store.read_text(workspace, relative_path)
        except FileNotFoundError:
            return f"Error: File '{file_path}' not found"
        except UnicodeDecodeError as exc:
            return f"Error reading file '{file_path}': {exc}"

        empty_msg = check_empty_content(content)
        if empty_msg:
            return empty_msg
        lines = content.splitlines()
        start_idx = max(0, int(offset))
        line_limit = max(1, int(limit))
        if start_idx >= len(lines):
            return f"Error: Line offset {offset} exceeds file length ({len(lines)} lines)"
        end_idx = min(start_idx + line_limit, len(lines))
        formatted = format_content_with_line_numbers(lines[start_idx:end_idx], start_line=start_idx + 1)
        footer = format_read_pagination_footer(
            start_idx=start_idx,
            end_idx=end_idx,
            total_lines=len(lines),
        )
        return f"{formatted}\n\n{footer}" if formatted else footer

    def grep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> list[GrepMatch] | str:
        normalized_pattern = str(pattern or "")
        if not normalized_pattern:
            return []
        matches: list[GrepMatch] = []
        for workspace, file in self._iter_search_files(path, glob):
            try:
                content = self.workspace_store.read_text(workspace, file.path)
            except (FileNotFoundError, UnicodeDecodeError):
                continue
            virtual_path = f"/{knowledge_workspace_mount_name(workspace)}/{file.path}"
            for line_number, line in enumerate(content.splitlines(), start=1):
                if normalized_pattern not in line:
                    continue
                matches.append(
                    {
                        "path": virtual_path,
                        "line": line_number,
                        "text": line,
                    }
                )
                if len(matches) >= _MAX_GREP_MATCHES:
                    return matches
        return matches

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        normalized_pattern = str(pattern or "*").lstrip("/") or "*"
        results: list[FileInfo] = []
        for workspace, file in self._iter_search_files(path, None):
            candidate = f"{knowledge_workspace_mount_name(workspace)}/{file.path}"
            relative_candidate = file.path
            if not (
                fnmatch.fnmatchcase(candidate, normalized_pattern)
                or fnmatch.fnmatchcase(relative_candidate, normalized_pattern)
            ):
                continue
            results.append(
                {
                    "path": f"/{knowledge_workspace_mount_name(workspace)}/{file.path}",
                    "is_dir": False,
                    "size": 0,
                    "modified_at": "",
                }
            )
        results.sort(key=lambda item: item.get("path", ""))
        return results

    def write(self, file_path: str, content: str) -> WriteResult:
        return WriteResult(error=f"Path '{file_path}' is read-only.")

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ) -> EditResult:
        return EditResult(error=f"Path '{file_path}' is read-only.")

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return [FileUploadResponse(path=path, error="permission_denied") for path, _content in files]

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        responses: list[FileDownloadResponse] = []
        for path in paths:
            workspace, relative_path = self._resolve_path(path)
            if workspace is None or not relative_path:
                responses.append(FileDownloadResponse(path=path, content=None, error="file_not_found"))
                continue
            try:
                storage_ref = self.workspace_store.storage_ref(workspace, relative_path)
                content = self.asset_store.read_bytes(storage_ref)
            except FileNotFoundError:
                responses.append(FileDownloadResponse(path=path, content=None, error="file_not_found"))
                continue
            except ValueError:
                responses.append(FileDownloadResponse(path=path, content=None, error="invalid_path"))
                continue
            responses.append(FileDownloadResponse(path=path, content=content, error=None))
        return responses

    def _iter_search_files(
        self,
        path: str | None,
        include_glob: str | None,
    ) -> Iterable[tuple[KnowledgeWorkspaceRecord, WorkspaceFile]]:
        workspace, relative_path = self._resolve_path(path or "/")
        if workspace is None and _normalize_backend_path(path or "/") != "/":
            return []
        workspaces = [workspace] if workspace is not None else self._workspaces()
        files: list[tuple[KnowledgeWorkspaceRecord, WorkspaceFile]] = []
        for item in workspaces:
            assert item is not None
            for file in self._list_files(item, relative_path):
                if include_glob and not fnmatch.fnmatchcase(file.path, include_glob):
                    continue
                files.append((item, file))
        return files


def _normalize_backend_path(path: str | None) -> str:
    value = str(path or "/").replace("\\", "/").strip()
    if not value.startswith("/"):
        value = f"/{value}"
    parts = [part for part in value.split("/") if part]
    if any(part == ".." for part in parts):
        raise ValueError("Path traversal not allowed in knowledge mount")
    return "/" + "/".join(parts) if parts else "/"


def _direct_child_path(
    *,
    workspace: KnowledgeWorkspaceRecord,
    base_relative_path: str,
    file_path: str,
) -> FileInfo | None:
    base = base_relative_path.strip("/")
    if base:
        if file_path == base:
            return {
                "path": f"/{knowledge_workspace_mount_name(workspace)}/{file_path}",
                "is_dir": False,
                "size": 0,
                "modified_at": "",
            }
        if not file_path.startswith(f"{base}/"):
            return None
        tail = file_path[len(base) :].lstrip("/")
        child_prefix = f"/{knowledge_workspace_mount_name(workspace)}/{base}"
    else:
        tail = file_path
        child_prefix = f"/{knowledge_workspace_mount_name(workspace)}"

    first, _, remainder = tail.partition("/")
    if not first:
        return None
    child_path = f"{child_prefix}/{first}"
    if remainder:
        return {"path": f"{child_path}/", "is_dir": True, "size": 0, "modified_at": ""}
    return {"path": child_path, "is_dir": False, "size": 0, "modified_at": ""}
