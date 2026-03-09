from __future__ import annotations

import logging

from agent_sandbox import Sandbox as AioSandboxClient
from deepagents.backends.protocol import ExecuteResponse, FileDownloadResponse, FileUploadResponse

from src.config.paths import VIRTUAL_PATH_PREFIX
from src.sandbox.sandbox import Sandbox

logger = logging.getLogger(__name__)


class AioSandbox(Sandbox):
    """deepagents-compatible sandbox backed by the AIO sandbox HTTP API."""

    def __init__(self, id: str, base_url: str, home_dir: str | None = None):
        super().__init__(sandbox_id=id)
        self._base_url = base_url
        self._client = AioSandboxClient(base_url=base_url, timeout=600)
        self._home_dir = home_dir
        self._default_timeout = 600

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def home_dir(self) -> str:
        if self._home_dir is None:
            context = self._client.sandbox.get_context()
            self._home_dir = getattr(context, "home_dir", None) or VIRTUAL_PATH_PREFIX
        return self._home_dir

    @staticmethod
    def _is_absolute_path(path: str) -> bool:
        return path.startswith("/")

    @staticmethod
    def _upload_error_for(path: str) -> FileUploadResponse:
        return FileUploadResponse(path=path, error="invalid_path")

    @staticmethod
    def _download_error_for(path: str) -> FileDownloadResponse:
        return FileDownloadResponse(path=path, content=None, error="invalid_path")

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        effective_timeout = timeout if timeout is not None else self._default_timeout

        try:
            result = self._client.shell.exec_command(
                command=command,
                exec_dir=self.home_dir,
                timeout=float(effective_timeout),
                hard_timeout=float(effective_timeout),
                truncate=True,
            )
            output = getattr(result, "output", None) or ""
            status = str(getattr(result, "status", "") or "")
            exit_code = getattr(result, "exit_code", None)
            return ExecuteResponse(
                output=output,
                exit_code=exit_code,
                truncated=status in {"hard_timeout", "no_change_timeout"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to execute command in sandbox %s: %s", self.id, exc)
            return ExecuteResponse(
                output=f"Error executing command in sandbox: {exc}",
                exit_code=1,
                truncated=False,
            )

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        responses: list[FileUploadResponse] = []
        for path, content in files:
            if not self._is_absolute_path(path):
                responses.append(self._upload_error_for(path))
                continue
            try:
                self._client.file.upload_file(file=content, path=path)
                responses.append(FileUploadResponse(path=path, error=None))
            except PermissionError:
                responses.append(FileUploadResponse(path=path, error="permission_denied"))
            except FileNotFoundError:
                responses.append(FileUploadResponse(path=path, error="file_not_found"))
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to upload file to sandbox %s: %s", self.id, exc)
                responses.append(FileUploadResponse(path=path, error="invalid_path"))
        return responses

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        responses: list[FileDownloadResponse] = []
        for path in paths:
            if not self._is_absolute_path(path):
                responses.append(self._download_error_for(path))
                continue
            try:
                content = b"".join(self._client.file.download_file(path=path))
                responses.append(FileDownloadResponse(path=path, content=content, error=None))
            except PermissionError:
                responses.append(FileDownloadResponse(path=path, content=None, error="permission_denied"))
            except FileNotFoundError:
                responses.append(FileDownloadResponse(path=path, content=None, error="file_not_found"))
            except IsADirectoryError:
                responses.append(FileDownloadResponse(path=path, content=None, error="is_directory"))
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to download file from sandbox %s: %s", self.id, exc)
                responses.append(FileDownloadResponse(path=path, content=None, error="file_not_found"))
        return responses
