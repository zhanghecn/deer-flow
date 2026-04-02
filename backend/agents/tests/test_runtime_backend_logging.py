from __future__ import annotations

import logging

from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import (
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
    SandboxBackendProtocol,
    WriteResult,
)

from src.runtime_backends.operation_logging import wrap_runtime_backend_with_logging


class _FakeSandboxBackend(SandboxBackendProtocol):
    @property
    def id(self) -> str:
        return "fake-sandbox"

    def ls_info(self, path: str):
        return [{"path": path, "is_dir": True, "size": 0, "modified_at": ""}]

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        return "hello"

    def grep_raw(self, pattern: str, path: str | None = None, glob: str | None = None):
        return []

    def glob_info(self, pattern: str, path: str = "/"):
        return []

    def write(self, file_path: str, content: str) -> WriteResult:
        return WriteResult(path=file_path, files_update=None)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        return EditResult(path=file_path, files_update=None, occurrences=1)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        return [FileUploadResponse(path=path, error=None) for path, _ in files]

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return [FileDownloadResponse(path=path, content=b"payload", error=None) for path in paths]

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        return ExecuteResponse(output=f"ran: {command}", exit_code=0, truncated=False)


def test_wrap_runtime_backend_with_logging_logs_direct_backend_operations(caplog):
    backend = _FakeSandboxBackend()
    wrapped = wrap_runtime_backend_with_logging(
        backend,
        backend_kind="remote",
        thread_id="thread-direct",
    )
    caplog.set_level(logging.INFO, logger="src.runtime_backends.operation_logging")

    wrapped.execute("echo hello", timeout=5)
    wrapped.upload_files([("/tmp/demo.txt", b"hello")])

    assert getattr(wrapped, "__wrapped_backend__", None) is backend
    assert "backend=remote thread_id=thread-direct target=fake-sandbox operation=execute" in caplog.text
    assert "backend=remote thread_id=thread-direct target=fake-sandbox operation=upload_files" in caplog.text
    assert "first_path='/tmp/demo.txt'" in caplog.text


def test_wrap_runtime_backend_with_logging_preserves_composite_backend_shape(caplog):
    default_backend = _FakeSandboxBackend()
    backend = CompositeBackend(default=default_backend, routes={})
    wrapped = wrap_runtime_backend_with_logging(
        backend,
        backend_kind="sandbox",
        thread_id="thread-composite",
    )
    caplog.set_level(logging.INFO, logger="src.runtime_backends.operation_logging")

    result = wrapped.download_files(["/tmp/demo.txt"])

    assert isinstance(wrapped, CompositeBackend)
    assert wrapped.default is default_backend
    assert result[0].content == b"payload"
    assert "backend=sandbox thread_id=thread-composite target=fake-sandbox operation=download_files" in caplog.text
    assert "first_path='/tmp/demo.txt'" in caplog.text
