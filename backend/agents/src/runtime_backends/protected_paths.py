from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from deepagents.backends.protocol import (
    BackendProtocol,
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileInfo,
    FileUploadResponse,
    GrepMatch,
    SandboxBackendProtocol,
    WriteResult,
    execute_accepts_timeout,
)


RUNTIME_OWNED_PREFIXES = (
    "/mnt/user-data/workspace/.openagents-task-audit",
    "/mnt/user-data/workspace/.openagents-knowledge-audit",
    "/workspace/.openagents-task-audit",
    "/workspace/.openagents-knowledge-audit",
)
RUNTIME_OWNED_COMMAND_MARKERS = (
    ".openagents-task-audit",
    ".openagents-knowledge-audit",
)
RUNTIME_OWNED_PERMISSION_ERROR = (
    "Path is runtime-owned and read-only to agent file and shell tools."
)


def _normalize_path(path: str) -> str:
    normalized = str(path or "").strip()
    while "//" in normalized:
        normalized = normalized.replace("//", "/")
    return normalized.rstrip("/") or normalized


def is_runtime_owned_path(path: str) -> bool:
    """Return whether a model-visible path belongs to runtime-owned audit state."""

    normalized = _normalize_path(path)
    for prefix in RUNTIME_OWNED_PREFIXES:
        normalized_prefix = _normalize_path(prefix)
        if normalized == normalized_prefix or normalized.startswith(f"{normalized_prefix}/"):
            return True
    return False


def command_references_runtime_owned_path(command: str) -> bool:
    """Detect explicit shell access to protected runtime audit directories.

    Sandbox execution also mounts these directories read-only. This textual
    guard keeps local and remote backends from accepting obvious mutation or
    inspection commands against runtime-owned evidence files, where a shell
    backend cannot provide a subdirectory read-only mount.
    """

    return any(marker in str(command or "") for marker in RUNTIME_OWNED_COMMAND_MARKERS)


def _permission_write_result(path: str) -> WriteResult:
    return WriteResult(error=f"{RUNTIME_OWNED_PERMISSION_ERROR} path={path}")


def _permission_edit_result(path: str) -> EditResult:
    return EditResult(error=f"{RUNTIME_OWNED_PERMISSION_ERROR} path={path}")


def _permission_upload_result(path: str) -> FileUploadResponse:
    return FileUploadResponse(path=path, error="permission_denied")


def _call_with_optional_timeout(method: Any, owner_type: type[Any], command: str, timeout: int | None):
    """Call a backend execute method without assuming it subclasses the protocol.

    OpenAgents often wraps shell-capable defaults in `CompositeBackend` variants
    that expose `execute()` but do not inherit `SandboxBackendProtocol`.
    Capability detection must therefore follow the actual method surface, while
    still preserving older backends that do not accept the newer `timeout` kwarg.
    """

    if timeout is not None and execute_accepts_timeout(owner_type):
        return method(command, timeout=timeout)
    return method(command)


@dataclass
class ProtectedRuntimeBackend(SandboxBackendProtocol):
    """Block agent mutation of runtime-owned audit paths.

    Task and knowledge audits are evidence produced by runtime middleware, not
    user-authored workspace files. The model may read them through validators,
    but normal file tools must not create or patch them. Runtime middleware can
    still call `write_runtime_owned_file()` as the privileged internal path.
    """

    wrapped_backend: BackendProtocol

    def __post_init__(self) -> None:
        self.__wrapped_backend__ = self.wrapped_backend

    @property
    def id(self) -> str:
        return str(getattr(self.wrapped_backend, "id", "protected-runtime"))

    def ls_info(self, path: str) -> list[FileInfo]:
        return self.wrapped_backend.ls_info(path)

    async def als_info(self, path: str) -> list[FileInfo]:
        return await self.wrapped_backend.als_info(path)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        return self.wrapped_backend.read(file_path, offset=offset, limit=limit)

    async def aread(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        return await self.wrapped_backend.aread(file_path, offset=offset, limit=limit)

    def grep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> list[GrepMatch] | str:
        return self.wrapped_backend.grep_raw(pattern, path=path, glob=glob)

    async def agrep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> list[GrepMatch] | str:
        return await self.wrapped_backend.agrep_raw(pattern, path=path, glob=glob)

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        return self.wrapped_backend.glob_info(pattern, path=path)

    async def aglob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        return await self.wrapped_backend.aglob_info(pattern, path=path)

    def write(self, file_path: str, content: str) -> WriteResult:
        if is_runtime_owned_path(file_path):
            return _permission_write_result(file_path)
        return self.wrapped_backend.write(file_path, content)

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        if is_runtime_owned_path(file_path):
            return _permission_write_result(file_path)
        return await self.wrapped_backend.awrite(file_path, content)

    def write_runtime_owned_file(self, file_path: str, content: str) -> WriteResult:
        """Privileged write path for runtime middleware-owned evidence files."""

        return self.wrapped_backend.write(file_path, content)

    async def awrite_runtime_owned_file(self, file_path: str, content: str) -> WriteResult:
        return await self.wrapped_backend.awrite(file_path, content)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ) -> EditResult:
        if is_runtime_owned_path(file_path):
            return _permission_edit_result(file_path)
        return self.wrapped_backend.edit(
            file_path,
            old_string,
            new_string,
            replace_all=replace_all,
        )

    async def aedit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ) -> EditResult:
        if is_runtime_owned_path(file_path):
            return _permission_edit_result(file_path)
        return await self.wrapped_backend.aedit(
            file_path,
            old_string,
            new_string,
            replace_all=replace_all,
        )

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        results: list[FileUploadResponse] = []
        allowed: list[tuple[int, str, bytes]] = []
        for index, (path, content) in enumerate(files):
            if is_runtime_owned_path(path):
                results.append(_permission_upload_result(path))
                continue
            results.append(FileUploadResponse(path=path, error=None))
            allowed.append((index, path, content))
        if not allowed:
            return results
        upload_results = self.wrapped_backend.upload_files(
            [(path, content) for _index, path, content in allowed]
        )
        for (index, _path, _content), upload_result in zip(allowed, upload_results, strict=False):
            results[index] = upload_result
        return results

    async def aupload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return await asyncio.to_thread(self.upload_files, files)

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return self.wrapped_backend.download_files(paths)

    async def adownload_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return await self.wrapped_backend.adownload_files(paths)

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        if command_references_runtime_owned_path(command):
            return ExecuteResponse(
                output=f"Error: {RUNTIME_OWNED_PERMISSION_ERROR}",
                exit_code=1,
                truncated=False,
            )
        execute = getattr(self.wrapped_backend, "execute", None)
        if callable(execute):
            return _call_with_optional_timeout(
                execute,
                type(self.wrapped_backend),
                command,
                timeout,
            )
        raise NotImplementedError("Wrapped backend does not support command execution.")

    async def aexecute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        if command_references_runtime_owned_path(command):
            return ExecuteResponse(
                output=f"Error: {RUNTIME_OWNED_PERMISSION_ERROR}",
                exit_code=1,
                truncated=False,
            )
        aexecute = getattr(self.wrapped_backend, "aexecute", None)
        if callable(aexecute):
            return await _call_with_optional_timeout(
                aexecute,
                type(self.wrapped_backend),
                command,
                timeout,
            )
        return await asyncio.to_thread(self.execute, command, timeout=timeout)


def protect_runtime_owned_paths(backend: BackendProtocol) -> ProtectedRuntimeBackend:
    """Wrap a runtime backend with audit-path immutability for agent tools."""

    if isinstance(backend, ProtectedRuntimeBackend):
        return backend
    return ProtectedRuntimeBackend(backend)
