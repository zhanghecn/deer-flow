from __future__ import annotations

import logging
import time
from typing import Any

from deepagents.backends import CompositeBackend
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
)

logger = logging.getLogger(__name__)
_MAX_PREVIEW_CHARS = 120


def _preview_text(value: object, *, max_chars: int = _MAX_PREVIEW_CHARS) -> str:
    text = str(value).replace("\n", "\\n")
    if len(text) <= max_chars:
        return text
    return f"{text[: max_chars - 3]}..."


def _first_path(paths: list[str]) -> str | None:
    if not paths:
        return None
    return paths[0]


def _upload_batch_summary(files: list[tuple[str, bytes]]) -> tuple[str | None, int]:
    if not files:
        return None, 0
    return files[0][0], sum(len(content) for _path, content in files)


def _count_errors(responses: list[object]) -> int:
    return sum(1 for response in responses if getattr(response, "error", None) is not None)


def _total_downloaded_bytes(responses: list[FileDownloadResponse]) -> int:
    return sum(len(response.content or b"") for response in responses)


def _runtime_target_id(backend: BackendProtocol) -> str:
    target = getattr(backend, "default", backend)
    target_id = getattr(target, "id", None)
    if target_id:
        return str(target_id)
    return type(target).__name__


def _render_fields(**fields: object) -> str:
    parts: list[str] = []
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, str):
            parts.append(f"{key}={_preview_text(value)!r}")
        else:
            parts.append(f"{key}={value}")
    return " ".join(parts)


class _OperationLogger:
    """Small runtime audit logger shared by all backend wrappers."""

    def __init__(self, *, backend_kind: str, thread_id: str) -> None:
        self._backend_kind = backend_kind
        self._thread_id = thread_id

    def success(
        self,
        *,
        operation: str,
        started_at: float,
        target_id: str,
        **fields: object,
    ) -> None:
        self._emit(
            log_method=logger.info,
            operation=operation,
            started_at=started_at,
            target_id=target_id,
            **fields,
        )

    def failure(
        self,
        *,
        operation: str,
        started_at: float,
        target_id: str,
        error: Exception,
        **fields: object,
    ) -> None:
        self._emit(
            log_method=logger.error,
            operation=operation,
            started_at=started_at,
            target_id=target_id,
            exception_type=type(error).__name__,
            exception=_preview_text(error),
            **fields,
        )

    def _emit(
        self,
        *,
        log_method,
        operation: str,
        started_at: float,
        target_id: str,
        **fields: object,
    ) -> None:
        duration_ms = (time.perf_counter() - started_at) * 1000
        detail = _render_fields(**fields)
        suffix = f" {detail}" if detail else ""
        log_method(
            "Runtime backend op backend=%s thread_id=%s target=%s operation=%s duration_ms=%.1f%s",
            self._backend_kind,
            self._thread_id,
            target_id,
            operation,
            duration_ms,
            suffix,
        )


class LoggedCompositeBackend(CompositeBackend):
    """Composite wrapper that keeps the existing backend shape intact."""

    def __init__(
        self,
        wrapped_backend: CompositeBackend,
        *,
        backend_kind: str,
        thread_id: str,
    ) -> None:
        super().__init__(default=wrapped_backend.default, routes=wrapped_backend.routes)
        self.__wrapped_backend__ = wrapped_backend
        self._operation_logger = _OperationLogger(
            backend_kind=backend_kind,
            thread_id=thread_id,
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped_backend__, name)

    @property
    def _target_id(self) -> str:
        return _runtime_target_id(self)

    def ls_info(self, path: str) -> list[FileInfo]:
        started_at = time.perf_counter()
        try:
            result = super().ls_info(path)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="ls_info",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                path=path,
            )
            raise
        self._operation_logger.success(
            operation="ls_info",
            started_at=started_at,
            target_id=self._target_id,
            path=path,
            entries=len(result),
        )
        return result

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        started_at = time.perf_counter()
        try:
            result = super().read(file_path, offset=offset, limit=limit)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="read",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                file_path=file_path,
                offset=offset,
                limit=limit,
            )
            raise
        self._operation_logger.success(
            operation="read",
            started_at=started_at,
            target_id=self._target_id,
            file_path=file_path,
            content_chars=len(result),
        )
        return result

    def grep_raw(self, pattern: str, path: str | None = None, glob: str | None = None) -> list[GrepMatch] | str:
        started_at = time.perf_counter()
        try:
            result = super().grep_raw(pattern, path=path, glob=glob)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="grep_raw",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                pattern=pattern,
                path=path,
            )
            raise
        self._operation_logger.success(
            operation="grep_raw",
            started_at=started_at,
            target_id=self._target_id,
            pattern=pattern,
            path=path,
            matches=len(result) if not isinstance(result, str) else None,
        )
        return result

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        started_at = time.perf_counter()
        try:
            result = super().glob_info(pattern, path=path)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="glob_info",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                pattern=pattern,
                path=path,
            )
            raise
        self._operation_logger.success(
            operation="glob_info",
            started_at=started_at,
            target_id=self._target_id,
            pattern=pattern,
            path=path,
            entries=len(result),
        )
        return result

    def write(self, file_path: str, content: str) -> WriteResult:
        started_at = time.perf_counter()
        try:
            result = super().write(file_path, content)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="write",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                file_path=file_path,
                content_chars=len(content),
            )
            raise
        self._operation_logger.success(
            operation="write",
            started_at=started_at,
            target_id=self._target_id,
            file_path=file_path,
            content_chars=len(content),
            error=result.error,
        )
        return result

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        started_at = time.perf_counter()
        try:
            result = super().edit(file_path, old_string, new_string, replace_all=replace_all)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="edit",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                file_path=file_path,
            )
            raise
        self._operation_logger.success(
            operation="edit",
            started_at=started_at,
            target_id=self._target_id,
            file_path=file_path,
            occurrences=result.occurrences,
            error=result.error,
        )
        return result

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        started_at = time.perf_counter()
        first_path, total_bytes = _upload_batch_summary(files)
        try:
            result = super().upload_files(files)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="upload_files",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                files_count=len(files),
                first_path=first_path,
                total_bytes=total_bytes,
            )
            raise
        self._operation_logger.success(
            operation="upload_files",
            started_at=started_at,
            target_id=self._target_id,
            files_count=len(files),
            first_path=first_path,
            total_bytes=total_bytes,
            errors=_count_errors(result),
        )
        return result

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        started_at = time.perf_counter()
        try:
            result = super().download_files(paths)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="download_files",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                files_count=len(paths),
                first_path=_first_path(paths),
            )
            raise
        self._operation_logger.success(
            operation="download_files",
            started_at=started_at,
            target_id=self._target_id,
            files_count=len(paths),
            first_path=_first_path(paths),
            total_bytes=_total_downloaded_bytes(result),
            errors=_count_errors(result),
        )
        return result

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        started_at = time.perf_counter()
        try:
            result = super().execute(command, timeout=timeout)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="execute",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                command=command,
                timeout=timeout,
            )
            raise
        self._operation_logger.success(
            operation="execute",
            started_at=started_at,
            target_id=self._target_id,
            command=command,
            timeout=timeout,
            exit_code=result.exit_code,
            truncated=result.truncated,
        )
        return result


class LoggedBackend(BackendProtocol):
    """Wrapper for direct local or remote backends."""

    def __init__(
        self,
        wrapped_backend: BackendProtocol,
        *,
        backend_kind: str,
        thread_id: str,
    ) -> None:
        self.__wrapped_backend__ = wrapped_backend
        self._operation_logger = _OperationLogger(
            backend_kind=backend_kind,
            thread_id=thread_id,
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self.__wrapped_backend__, name)

    @property
    def _target_id(self) -> str:
        return _runtime_target_id(self.__wrapped_backend__)

    def ls_info(self, path: str) -> list[FileInfo]:
        started_at = time.perf_counter()
        try:
            result = self.__wrapped_backend__.ls_info(path)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="ls_info",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                path=path,
            )
            raise
        self._operation_logger.success(
            operation="ls_info",
            started_at=started_at,
            target_id=self._target_id,
            path=path,
            entries=len(result),
        )
        return result

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        started_at = time.perf_counter()
        try:
            result = self.__wrapped_backend__.read(file_path, offset=offset, limit=limit)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="read",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                file_path=file_path,
                offset=offset,
                limit=limit,
            )
            raise
        self._operation_logger.success(
            operation="read",
            started_at=started_at,
            target_id=self._target_id,
            file_path=file_path,
            content_chars=len(result),
        )
        return result

    def grep_raw(self, pattern: str, path: str | None = None, glob: str | None = None) -> list[GrepMatch] | str:
        started_at = time.perf_counter()
        try:
            result = self.__wrapped_backend__.grep_raw(pattern, path=path, glob=glob)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="grep_raw",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                pattern=pattern,
                path=path,
            )
            raise
        self._operation_logger.success(
            operation="grep_raw",
            started_at=started_at,
            target_id=self._target_id,
            pattern=pattern,
            path=path,
            matches=len(result) if not isinstance(result, str) else None,
        )
        return result

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        started_at = time.perf_counter()
        try:
            result = self.__wrapped_backend__.glob_info(pattern, path=path)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="glob_info",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                pattern=pattern,
                path=path,
            )
            raise
        self._operation_logger.success(
            operation="glob_info",
            started_at=started_at,
            target_id=self._target_id,
            pattern=pattern,
            path=path,
            entries=len(result),
        )
        return result

    def write(self, file_path: str, content: str) -> WriteResult:
        started_at = time.perf_counter()
        try:
            result = self.__wrapped_backend__.write(file_path, content)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="write",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                file_path=file_path,
                content_chars=len(content),
            )
            raise
        self._operation_logger.success(
            operation="write",
            started_at=started_at,
            target_id=self._target_id,
            file_path=file_path,
            content_chars=len(content),
            error=result.error,
        )
        return result

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        started_at = time.perf_counter()
        try:
            result = self.__wrapped_backend__.edit(
                file_path,
                old_string,
                new_string,
                replace_all=replace_all,
            )
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="edit",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                file_path=file_path,
            )
            raise
        self._operation_logger.success(
            operation="edit",
            started_at=started_at,
            target_id=self._target_id,
            file_path=file_path,
            occurrences=result.occurrences,
            error=result.error,
        )
        return result

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        started_at = time.perf_counter()
        first_path, total_bytes = _upload_batch_summary(files)
        try:
            result = self.__wrapped_backend__.upload_files(files)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="upload_files",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                files_count=len(files),
                first_path=first_path,
                total_bytes=total_bytes,
            )
            raise
        self._operation_logger.success(
            operation="upload_files",
            started_at=started_at,
            target_id=self._target_id,
            files_count=len(files),
            first_path=first_path,
            total_bytes=total_bytes,
            errors=_count_errors(result),
        )
        return result

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        started_at = time.perf_counter()
        try:
            result = self.__wrapped_backend__.download_files(paths)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="download_files",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                files_count=len(paths),
                first_path=_first_path(paths),
            )
            raise
        self._operation_logger.success(
            operation="download_files",
            started_at=started_at,
            target_id=self._target_id,
            files_count=len(paths),
            first_path=_first_path(paths),
            total_bytes=_total_downloaded_bytes(result),
            errors=_count_errors(result),
        )
        return result


class LoggedSandboxBackend(LoggedBackend, SandboxBackendProtocol):
    """Wrapper for shell-capable backends."""

    @property
    def id(self) -> str:
        return str(getattr(self.__wrapped_backend__, "id"))

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        started_at = time.perf_counter()
        try:
            result = self.__wrapped_backend__.execute(command, timeout=timeout)
        except Exception as exc:  # noqa: BLE001
            self._operation_logger.failure(
                operation="execute",
                started_at=started_at,
                target_id=self._target_id,
                error=exc,
                command=command,
                timeout=timeout,
            )
            raise
        self._operation_logger.success(
            operation="execute",
            started_at=started_at,
            target_id=self._target_id,
            command=command,
            timeout=timeout,
            exit_code=result.exit_code,
            truncated=result.truncated,
        )
        return result


def wrap_runtime_backend_with_logging(
    backend: BackendProtocol,
    *,
    backend_kind: str,
    thread_id: str,
) -> BackendProtocol:
    """Wrap runtime backends so operators can see which backend did the work."""

    if isinstance(backend, (LoggedCompositeBackend, LoggedSandboxBackend, LoggedBackend)):
        return backend
    if isinstance(backend, CompositeBackend):
        return LoggedCompositeBackend(
            backend,
            backend_kind=backend_kind,
            thread_id=thread_id,
        )
    if isinstance(backend, SandboxBackendProtocol):
        return LoggedSandboxBackend(
            backend,
            backend_kind=backend_kind,
            thread_id=thread_id,
        )
    return LoggedBackend(
        backend,
        backend_kind=backend_kind,
        thread_id=thread_id,
    )


__all__ = [
    "LoggedBackend",
    "LoggedCompositeBackend",
    "LoggedSandboxBackend",
    "wrap_runtime_backend_with_logging",
]
