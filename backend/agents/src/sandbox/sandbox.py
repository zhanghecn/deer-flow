from __future__ import annotations

from abc import ABC, abstractmethod

from deepagents.backends.protocol import FileDownloadResponse, FileUploadResponse
from deepagents.backends.sandbox import BaseSandbox


class Sandbox(BaseSandbox, ABC):
    """Compatibility base class for runtime sandboxes used by OpenAgents."""

    def __init__(self, sandbox_id: str) -> None:
        self._sandbox_id = sandbox_id

    @property
    def id(self) -> str:
        return self._sandbox_id

    @abstractmethod
    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """Upload multiple files to the sandbox."""

    @abstractmethod
    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """Download multiple files from the sandbox."""
