from __future__ import annotations

from deepagents.backends.protocol import (
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileInfo,
    FileUploadResponse,
    WriteResult,
)

from src.runtime_backends.protected_paths import (
    RUNTIME_OWNED_PERMISSION_ERROR,
    ProtectedRuntimeBackend,
)


class FakeSandboxBackend:
    """Small backend double that records mutations for protected-path tests."""

    id = "fake-sandbox"

    def __init__(self) -> None:
        self.writes: list[tuple[str, str]] = []
        self.edits: list[str] = []
        self.uploads: list[tuple[str, bytes]] = []
        self.commands: list[str] = []

    def ls_info(self, path: str) -> list[FileInfo]:
        return []

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        return "read"

    def grep_raw(self, pattern: str, path: str | None = None, glob: str | None = None):
        return []

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        return []

    def write(self, file_path: str, content: str) -> WriteResult:
        self.writes.append((file_path, content))
        return WriteResult(path=file_path, files_update=None)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ) -> EditResult:
        self.edits.append(file_path)
        return EditResult(path=file_path, files_update=None, occurrences=1)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        self.uploads.extend(files)
        return [FileUploadResponse(path=path, error=None) for path, _content in files]

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return [FileDownloadResponse(path=path, content=b"", error=None) for path in paths]

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        self.commands.append(command)
        return ExecuteResponse(output="ok", exit_code=0, truncated=False)


def test_agent_file_tools_cannot_write_runtime_audit_paths() -> None:
    backend = FakeSandboxBackend()
    protected = ProtectedRuntimeBackend(backend)

    result = protected.write(
        "/mnt/user-data/workspace/.openagents-task-audit/task-calls/fake.json",
        "{}",
    )

    assert RUNTIME_OWNED_PERMISSION_ERROR in result.error
    assert backend.writes == []


def test_runtime_middleware_can_write_runtime_audit_paths() -> None:
    backend = FakeSandboxBackend()
    protected = ProtectedRuntimeBackend(backend)

    result = protected.write_runtime_owned_file(
        "/mnt/user-data/workspace/.openagents-task-audit/task-calls/real.json",
        "{}",
    )

    assert result.error is None
    assert backend.writes == [
        ("/mnt/user-data/workspace/.openagents-task-audit/task-calls/real.json", "{}")
    ]


def test_upload_files_blocks_only_runtime_owned_targets() -> None:
    backend = FakeSandboxBackend()
    protected = ProtectedRuntimeBackend(backend)

    results = protected.upload_files(
        [
            ("/mnt/user-data/workspace/.openagents-task-audit/task-calls/fake.json", b"{}"),
            ("/mnt/user-data/workspace/report.md", b"ok"),
        ]
    )

    assert results[0].error == "permission_denied"
    assert results[1].error is None
    assert backend.uploads == [("/mnt/user-data/workspace/report.md", b"ok")]


def test_execute_cannot_reference_runtime_audit_paths() -> None:
    backend = FakeSandboxBackend()
    protected = ProtectedRuntimeBackend(backend)

    result = protected.execute(
        "cat > /mnt/user-data/workspace/.openagents-task-audit/task-calls/fake.json"
    )

    assert result.exit_code == 1
    assert RUNTIME_OWNED_PERMISSION_ERROR in result.output
    assert backend.commands == []


def test_execute_delegates_to_shell_capable_composite_wrappers() -> None:
    backend = FakeSandboxBackend()
    protected = ProtectedRuntimeBackend(backend)

    result = protected.execute("python -V", timeout=10)

    assert result.exit_code == 0
    assert result.output == "ok"
    assert backend.commands == ["python -V"]
