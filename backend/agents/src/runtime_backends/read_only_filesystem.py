from __future__ import annotations

from deepagents.backends import FilesystemBackend
from deepagents.backends.protocol import EditResult, FileUploadResponse, WriteResult


class ReadOnlyFilesystemBackend(FilesystemBackend):
    """Expose a filesystem tree through BackendProtocol without mutation support.

    The archived skills library is a canonical source of truth. Runtime agents
    may inspect it, but they must not mutate it through routed filesystem calls.
    """

    def write(
        self,
        file_path: str,
        content: str,
    ) -> WriteResult:
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
