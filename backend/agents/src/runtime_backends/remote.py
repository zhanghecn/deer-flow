from __future__ import annotations

import base64
import logging
from typing import Any

from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import (
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileInfo,
    FileUploadResponse,
    GrepMatch,
    SandboxBackendProtocol,
    WriteResult,
)

from src.config.paths import Paths, get_paths
from src.remote.store import RemoteRelayStore

from .local import resolve_shared_skills_mount
from .read_only_filesystem import ReadOnlyFilesystemBackend

logger = logging.getLogger(__name__)

DEFAULT_REMOTE_OPERATION_TIMEOUT_SECONDS = 120
REMOTE_EXECUTION_BACKEND = "remote"


def _encode_bytes(content: bytes) -> str:
    return base64.b64encode(content).decode("ascii")


def _decode_bytes(content: str) -> bytes:
    return base64.b64decode(content.encode("ascii"))


class RemoteShellBackend(SandboxBackendProtocol):
    """Backend that relays filesystem and shell operations to a connected CLI."""

    def __init__(
        self,
        *,
        session_id: str,
        store: RemoteRelayStore | None = None,
        default_timeout_seconds: int = DEFAULT_REMOTE_OPERATION_TIMEOUT_SECONDS,
    ) -> None:
        self._session_id = session_id
        self._store = store or RemoteRelayStore()
        self._default_timeout_seconds = default_timeout_seconds

    @property
    def id(self) -> str:
        return f"remote-{self._session_id}"

    @property
    def session_id(self) -> str:
        return self._session_id

    def _round_trip(
        self,
        *,
        operation: str,
        payload: dict[str, Any],
        timeout_seconds: int,
    ) -> dict[str, Any]:
        request = self._store.submit_request(
            session_id=self._session_id,
            operation=operation,
            payload=payload,
            response_timeout_seconds=timeout_seconds,
        )
        response = self._store.wait_for_response(
            session_id=self._session_id,
            request_id=request.request_id,
            timeout_seconds=timeout_seconds,
        )
        if not response.success:
            raise RuntimeError(response.error or f"Remote operation '{operation}' failed.")
        return dict(response.payload)

    def ls_info(self, path: str) -> list[FileInfo]:
        payload = self._round_trip(
            operation="ls_info",
            payload={"path": path},
            timeout_seconds=self._default_timeout_seconds,
        )
        return [item for item in payload.get("entries", []) if isinstance(item, dict)]

    def read(
        self,
        file_path: str,
        offset: int = 0,
        limit: int = 2000,
    ) -> str:
        try:
            payload = self._round_trip(
                operation="read",
                payload={"file_path": file_path, "offset": int(offset), "limit": int(limit)},
                timeout_seconds=self._default_timeout_seconds,
            )
        except RuntimeError as exc:
            return f"Error reading file '{file_path}': {exc}"
        return str(payload.get("content", ""))

    def grep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> list[GrepMatch] | str:
        try:
            payload = self._round_trip(
                operation="grep_raw",
                payload={"pattern": pattern, "path": path, "glob": glob},
                timeout_seconds=self._default_timeout_seconds,
            )
        except RuntimeError as exc:
            return str(exc)
        return [item for item in payload.get("matches", []) if isinstance(item, dict)]

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        payload = self._round_trip(
            operation="glob_info",
            payload={"pattern": pattern, "path": path},
            timeout_seconds=self._default_timeout_seconds,
        )
        return [item for item in payload.get("entries", []) if isinstance(item, dict)]

    def write(
        self,
        file_path: str,
        content: str,
    ) -> WriteResult:
        try:
            payload = self._round_trip(
                operation="write",
                payload={"file_path": file_path, "content": content},
                timeout_seconds=self._default_timeout_seconds,
            )
        except RuntimeError as exc:
            return WriteResult(error=str(exc))
        error = payload.get("error")
        if error is not None:
            return WriteResult(error=str(error))
        return WriteResult(path=str(payload.get("path") or file_path), files_update=None)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ) -> EditResult:
        try:
            payload = self._round_trip(
                operation="edit",
                payload={
                    "file_path": file_path,
                    "old_string": old_string,
                    "new_string": new_string,
                    "replace_all": replace_all,
                },
                timeout_seconds=self._default_timeout_seconds,
            )
        except RuntimeError as exc:
            return EditResult(error=str(exc))
        error = payload.get("error")
        if error is not None:
            return EditResult(error=str(error))
        return EditResult(
            path=str(payload.get("path") or file_path),
            files_update=None,
            occurrences=int(payload.get("occurrences") or 0),
        )

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        effective_timeout = timeout if timeout is not None else self._default_timeout_seconds
        try:
            payload = self._round_trip(
                operation="execute",
                payload={"command": command, "timeout": effective_timeout},
                timeout_seconds=max(effective_timeout, 1),
            )
        except TimeoutError:
            return ExecuteResponse(
                output=f"Error: Remote command timed out after {effective_timeout} seconds.",
                exit_code=124,
                truncated=False,
            )
        except RuntimeError as exc:
            return ExecuteResponse(output=str(exc), exit_code=1, truncated=False)

        return ExecuteResponse(
            output=str(payload.get("output", "")),
            exit_code=int(payload.get("exit_code")) if payload.get("exit_code") is not None else None,
            truncated=bool(payload.get("truncated", False)),
        )

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        try:
            payload = self._round_trip(
                operation="upload_files",
                payload={
                    "files": [
                        {
                            "path": path,
                            "content_b64": _encode_bytes(content),
                        }
                        for path, content in files
                    ]
                },
                timeout_seconds=self._default_timeout_seconds,
            )
        except RuntimeError as exc:
            logger.error("Remote upload_files failed in session %s: %s", self._session_id, exc)
            return [FileUploadResponse(path=path, error="invalid_path") for path, _ in files]

        responses: list[FileUploadResponse] = []
        for item in payload.get("responses", []):
            if not isinstance(item, dict):
                continue
            responses.append(
                FileUploadResponse(
                    path=str(item.get("path", "")),
                    error=item.get("error"),
                )
            )
        return responses

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        try:
            payload = self._round_trip(
                operation="download_files",
                payload={"paths": paths},
                timeout_seconds=self._default_timeout_seconds,
            )
        except RuntimeError as exc:
            logger.error("Remote download_files failed in session %s: %s", self._session_id, exc)
            return [FileDownloadResponse(path=path, content=None, error="file_not_found") for path in paths]

        responses: list[FileDownloadResponse] = []
        for item in payload.get("responses", []):
            if not isinstance(item, dict):
                continue
            content_b64 = item.get("content_b64")
            content = _decode_bytes(str(content_b64)) if isinstance(content_b64, str) else None
            responses.append(
                FileDownloadResponse(
                    path=str(item.get("path", "")),
                    content=content,
                    error=item.get("error"),
                )
            )
        return responses


def build_remote_workspace_backend(
    *,
    session_id: str,
    paths: Paths | None = None,
) -> CompositeBackend | RemoteShellBackend:
    resolved_paths = paths or get_paths()
    store = RemoteRelayStore(paths=resolved_paths)
    session = store.get_session(session_id)
    if session.status != "connected":
        raise RuntimeError(
            f"Remote session '{session_id}' is not connected. Start `openagents-cli connect` before requesting remote execution."
        )
    remote_backend = RemoteShellBackend(session_id=session_id, store=store)
    shared_skills_mount = resolve_shared_skills_mount(resolved_paths)
    if shared_skills_mount is None:
        return remote_backend

    shared_skills_dir, route_prefix = shared_skills_mount
    # Remote execution relays `/mnt/user-data/...` to the user machine. Shared
    # archived skills still live on the server, so expose them through a local
    # read-only routed backend instead of trying to mirror them into the client.
    return CompositeBackend(
        default=remote_backend,
        routes={
            route_prefix: ReadOnlyFilesystemBackend(
                root_dir=shared_skills_dir,
                virtual_mode=True,
            )
        },
    )
