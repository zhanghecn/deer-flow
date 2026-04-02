from __future__ import annotations

import logging
import os
import re
import shlex
import time

from agent_sandbox import Sandbox as AioSandboxClient
from agent_sandbox.core.api_error import ApiError
from deepagents.backends.protocol import (
    EditResult,
    ExecuteResponse,
    FileDownloadResponse,
    FileInfo,
    FileUploadResponse,
    GrepMatch,
    WriteResult,
)

from src.config.paths import VIRTUAL_PATH_PREFIX
from src.sandbox.sandbox import Sandbox

logger = logging.getLogger(__name__)
MAX_READ_LINE_LENGTH = 5000
MAX_LOG_TEXT_LENGTH = 120
VIRTUAL_WORKSPACE = f"{VIRTUAL_PATH_PREFIX}/workspace"
SHELL_PATH = "/usr/bin/bash"
DEFAULT_EXEC_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
READ_ONLY_BIND_DIRS = ("/usr", "/etc", "/bin", "/lib", "/lib64", "/sbin", "/opt")


def _preview_log_text(value: object, *, max_chars: int = MAX_LOG_TEXT_LENGTH) -> str:
    text = str(value).replace("\n", "\\n")
    if len(text) <= max_chars:
        return text
    return f"{text[: max_chars - 3]}..."


def _count_response_errors(responses: list[object]) -> int:
    error_count = 0
    for response in responses:
        error = getattr(response, "error", None)
        if error is not None:
            error_count += 1
    return error_count


def _total_downloaded_bytes(responses: list[FileDownloadResponse]) -> int:
    return sum(len(response.content or b"") for response in responses)


def _first_item(values: list[str]) -> str | None:
    if not values:
        return None
    return values[0]


class AioSandbox(Sandbox):
    """deepagents-compatible sandbox backed by the AIO sandbox HTTP API."""

    def __init__(
        self,
        id: str,
        base_url: str,
        home_dir: str | None = None,
        runtime_root: str | None = None,
    ):
        super().__init__(sandbox_id=id)
        self._base_url = base_url
        self._client = AioSandboxClient(base_url=base_url, timeout=600)
        self._runtime_root = str(runtime_root).rstrip("/") if runtime_root else None
        self._home_dir = home_dir or self._runtime_root
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

    @property
    def runtime_root(self) -> str:
        return self._runtime_root or self.home_dir

    @staticmethod
    def _is_absolute_path(path: str) -> bool:
        return path.startswith("/")

    @staticmethod
    def _upload_error_for(path: str) -> FileUploadResponse:
        return FileUploadResponse(path=path, error="invalid_path")

    @staticmethod
    def _download_error_for(path: str) -> FileDownloadResponse:
        return FileDownloadResponse(path=path, content=None, error="invalid_path")

    @staticmethod
    def _result_value(result: object, field_name: str):
        payload = getattr(result, "data", None) or result
        if isinstance(payload, dict):
            return payload.get(field_name)
        return getattr(payload, field_name, None)

    @staticmethod
    def _api_error_message(exc: ApiError) -> str:
        if isinstance(exc.body, dict):
            message = exc.body.get("message")
            if isinstance(message, str):
                return message
        return str(exc)

    def _apply_runtime_alias(self, value: str) -> str:
        normalized = str(value).strip()
        runtime_root = self.runtime_root

        if normalized in {"", "/", "."}:
            return runtime_root

        if normalized == runtime_root or normalized.startswith(f"{runtime_root}/"):
            return normalized

        replacements = {
            VIRTUAL_PATH_PREFIX: runtime_root,
            "/workspace": f"{runtime_root}/workspace",
            "/uploads": f"{runtime_root}/uploads",
            "/outputs": f"{runtime_root}/outputs",
            "/agents": f"{runtime_root}/agents",
            "/authoring": f"{runtime_root}/authoring",
        }

        for alias, target in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
            if normalized == alias or normalized.startswith(f"{alias}/"):
                return f"{target}{normalized[len(alias):]}"
        return normalized

    def _normalize_runtime_path(self, path: str) -> str:
        return self._apply_runtime_alias(path)

    def _normalize_runtime_pattern(self, pattern: str) -> str:
        return self._apply_runtime_alias(pattern)

    def _to_virtual_runtime_path(self, path: str) -> str:
        normalized = str(path).strip()
        runtime_root = self.runtime_root.rstrip("/")
        if normalized == runtime_root:
            return VIRTUAL_PATH_PREFIX
        if normalized.startswith(f"{runtime_root}/"):
            return f"{VIRTUAL_PATH_PREFIX}{normalized[len(runtime_root):]}"
        return normalized

    def _shell_visible_runtime_path(self, path: str) -> str:
        normalized = self._normalize_runtime_path(path)
        if self._exec_isolation_disabled():
            return normalized
        return self._to_virtual_runtime_path(normalized)

    def _shell_visible_runtime_pattern(self, pattern: str) -> str:
        normalized = self._normalize_runtime_pattern(pattern)
        if self._exec_isolation_disabled():
            return normalized
        return self._to_virtual_runtime_path(normalized)

    def _command_path_replacements(self, target_root: str) -> dict[str, str]:
        runtime_root = self.runtime_root
        replacements = {
            VIRTUAL_PATH_PREFIX: target_root,
            "/workspace": f"{target_root}/workspace",
            "/uploads": f"{target_root}/uploads",
            "/outputs": f"{target_root}/outputs",
            "/agents": f"{target_root}/agents",
            "/authoring": f"{target_root}/authoring",
        }
        if runtime_root != target_root:
            replacements[runtime_root] = target_root
        return replacements

    def _rewrite_command_paths(self, command: str, *, target_root: str | None = None) -> str:
        replacements = self._command_path_replacements(target_root or self.runtime_root)

        rewritten = command
        for virtual_path, target in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
            pattern = rf"(?<![A-Za-z0-9_./-]){re.escape(virtual_path)}(?=(/|\b))"
            rewritten = re.sub(pattern, target, rewritten)
        return rewritten

    @staticmethod
    def _exec_isolation_disabled() -> bool:
        value = str(os.getenv("OPENAGENTS_SANDBOX_EXEC_ISOLATION", "")).strip().lower()
        return value in {"0", "false", "off", "disabled"}

    @staticmethod
    def _quote_command(argv: list[str]) -> str:
        return " ".join(shlex.quote(part) for part in argv)

    def _build_exec_jail_command(self, command: str) -> str:
        runtime_command = self._rewrite_command_paths(command, target_root=VIRTUAL_PATH_PREFIX)

        argv = [
            "bwrap",
            "--die-with-parent",
            "--new-session",
            "--unshare-user",
            "--unshare-ipc",
            "--unshare-pid",
            "--unshare-uts",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--tmpfs",
            "/tmp",
            "--bind",
            self.runtime_root,
            VIRTUAL_PATH_PREFIX,
            "--setenv",
            "HOME",
            "/tmp",
            "--setenv",
            "TMPDIR",
            "/tmp",
            "--setenv",
            "PATH",
            DEFAULT_EXEC_PATH,
            "--setenv",
            "OPENAGENTS_RUNTIME_ROOT",
            VIRTUAL_PATH_PREFIX,
            "--setenv",
            "OPENAGENTS_WORKSPACE",
            VIRTUAL_WORKSPACE,
            "--setenv",
            "OPENAGENTS_UPLOADS",
            f"{VIRTUAL_PATH_PREFIX}/uploads",
            "--setenv",
            "OPENAGENTS_OUTPUTS",
            f"{VIRTUAL_PATH_PREFIX}/outputs",
            "--setenv",
            "OPENAGENTS_AGENTS",
            f"{VIRTUAL_PATH_PREFIX}/agents",
            "--chdir",
            VIRTUAL_WORKSPACE,
        ]
        for directory in READ_ONLY_BIND_DIRS:
            if os.path.exists(directory):
                argv.extend(["--ro-bind", directory, directory])
        argv.extend([SHELL_PATH, "-lc", runtime_command])
        return self._quote_command(argv)

    def _log_transport_success(
        self,
        *,
        operation: str,
        started_at: float,
        **fields: object,
    ) -> None:
        duration_ms = (time.perf_counter() - started_at) * 1000
        rendered_fields = " ".join(
            f"{key}={_preview_log_text(value)!r}" if isinstance(value, str) else f"{key}={value}"
            for key, value in fields.items()
            if value is not None
        )
        suffix = f" {rendered_fields}" if rendered_fields else ""
        logger.info(
            "sandbox-aio transport sandbox_id=%s base_url=%s runtime_root=%s operation=%s duration_ms=%.1f%s",
            self.id,
            self.base_url,
            self.runtime_root,
            operation,
            duration_ms,
            suffix,
        )

    def _log_transport_failure(
        self,
        *,
        operation: str,
        started_at: float,
        error: Exception,
        **fields: object,
    ) -> None:
        duration_ms = (time.perf_counter() - started_at) * 1000
        rendered_fields = " ".join(
            f"{key}={_preview_log_text(value)!r}" if isinstance(value, str) else f"{key}={value}"
            for key, value in {
                **fields,
                "exception_type": type(error).__name__,
                "exception": _preview_log_text(error),
            }.items()
            if value is not None
        )
        suffix = f" {rendered_fields}" if rendered_fields else ""
        logger.error(
            "sandbox-aio transport sandbox_id=%s base_url=%s runtime_root=%s operation=%s duration_ms=%.1f%s",
            self.id,
            self.base_url,
            self.runtime_root,
            operation,
            duration_ms,
            suffix,
        )

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        started_at = time.perf_counter()
        effective_timeout = timeout if timeout is not None else self._default_timeout
        rewritten_command = (
            self._build_exec_jail_command(command)
            if not self._exec_isolation_disabled()
            else self._rewrite_command_paths(command)
        )

        try:
            result = self._client.shell.exec_command(
                command=rewritten_command,
                exec_dir=self.home_dir,
                timeout=float(effective_timeout),
                hard_timeout=float(effective_timeout),
                truncate=True,
            )
            output = str(self._result_value(result, "output") or "")
            status = str(self._result_value(result, "status") or "")
            exit_code = self._result_value(result, "exit_code")
            response = ExecuteResponse(
                output=output,
                exit_code=exit_code,
                truncated=status in {"hard_timeout", "no_change_timeout"},
            )
            # The runtime backend logger records the virtual command the agent asked
            # for. We also log the concrete payload sent to sandbox-aio so operators
            # can verify path rewriting and isolation behavior in production.
            self._log_transport_success(
                operation="execute",
                started_at=started_at,
                requested_command=command,
                transport_command=rewritten_command,
                exec_dir=self.home_dir,
                timeout=effective_timeout,
                exit_code=response.exit_code,
                truncated=response.truncated,
            )
            return response
        except Exception as exc:  # noqa: BLE001
            self._log_transport_failure(
                operation="execute",
                started_at=started_at,
                error=exc,
                requested_command=command,
                transport_command=rewritten_command,
                exec_dir=self.home_dir,
                timeout=effective_timeout,
            )
            return ExecuteResponse(
                output=f"Error executing command in sandbox: {exc}",
                exit_code=1,
                truncated=False,
            )

    def ls_info(self, path: str) -> list[FileInfo]:
        shell_path = self._shell_visible_runtime_path(path)
        infos = super().ls_info(shell_path)
        return [
            {
                **info,
                "path": self._to_virtual_runtime_path(info["path"]),
            }
            for info in infos
        ]

    def grep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ) -> list[GrepMatch] | str:
        normalized_path = self._normalize_runtime_path(path) if path else None
        result = super().grep_raw(pattern, path=normalized_path, glob=glob)
        if isinstance(result, str):
            return result
        return [
            {
                **match,
                "path": self._to_virtual_runtime_path(match["path"]),
            }
            for match in result
        ]

    def glob_info(self, pattern: str, path: str = "/") -> list[FileInfo]:
        shell_path = self._shell_visible_runtime_path(path)
        shell_pattern = self._shell_visible_runtime_pattern(pattern)
        infos = super().glob_info(shell_pattern, path=shell_path)
        return [
            {
                **info,
                "path": self._to_virtual_runtime_path(info["path"]),
            }
            for info in infos
        ]

    @staticmethod
    def _read_footer(start_idx: int, end_idx: int, total_lines: int) -> str:
        shown_lines = max(end_idx - start_idx, 0)
        remaining_lines = max(total_lines - end_idx, 0)
        if shown_lines == 0:
            return f"(Showing 0 lines at offset {start_idx}. {remaining_lines} lines remaining of {total_lines}.)"
        if remaining_lines > 0:
            return (
                f"(Showing lines {start_idx + 1}-{end_idx} of {total_lines}. "
                f"{remaining_lines} lines remaining. Use offset={end_idx} to continue.)"
            )
        return f"(End of file - total {total_lines} lines)"

    def read(
        self,
        file_path: str,
        offset: int = 0,
        limit: int = 2000,
    ) -> str:
        result = self.download_files([file_path])[0]
        if result.error == "file_not_found":
            return f"Error: File '{file_path}' not found"
        if result.error is not None or result.content is None:
            return f"Error reading file '{file_path}'"

        content = result.content.decode("utf-8", errors="replace")
        if not content or content.strip() == "":
            return "System reminder: File exists but has empty contents"

        lines = content.splitlines()
        total_lines = len(lines)
        if offset >= total_lines:
            return f"Error: Line offset {offset} exceeds file length ({total_lines} lines)"

        start_idx = offset
        end_idx = min(start_idx + max(limit, 0), total_lines)
        selected_lines = lines[start_idx:end_idx]

        rendered_lines: list[str] = []
        for index, line in enumerate(selected_lines):
            line_num = offset + index + 1
            if len(line) <= MAX_READ_LINE_LENGTH:
                rendered_lines.append(f"{line_num:6d}\t{line}")
                continue

            for chunk_idx, start in enumerate(range(0, len(line), MAX_READ_LINE_LENGTH)):
                chunk = line[start : start + MAX_READ_LINE_LENGTH]
                if chunk_idx == 0:
                    rendered_lines.append(f"{line_num:6d}\t{chunk}")
                    continue
                rendered_lines.append(f"{f'{line_num}.{chunk_idx}':>6}\t{chunk}")

        body = "\n".join(rendered_lines)
        return f"{body}\n\n{self._read_footer(start_idx, end_idx, total_lines)}"

    def write(
        self,
        file_path: str,
        content: str,
    ) -> WriteResult:
        existing = self.download_files([file_path])[0]
        if existing.error is None:
            return WriteResult(error=f"Error: File '{file_path}' already exists")
        if existing.error not in {"file_not_found", None}:
            return WriteResult(error=f"Failed to write file '{file_path}'")

        upload_result = self.upload_files([(file_path, content.encode("utf-8"))])[0]
        if upload_result.error is not None:
            return WriteResult(error=f"Failed to write file '{file_path}'")
        return WriteResult(path=file_path, files_update=None)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ) -> EditResult:
        existing = self.download_files([file_path])[0]
        if existing.error == "file_not_found":
            return EditResult(error=f"Error: File '{file_path}' not found")
        if existing.error is not None or existing.content is None:
            return EditResult(error=f"Failed to edit file '{file_path}'")

        content = existing.content.decode("utf-8", errors="replace")
        occurrences = content.count(old_string)
        if occurrences == 0:
            return EditResult(error=f"Error: String not found in file: '{old_string}'")
        if occurrences > 1 and not replace_all:
            return EditResult(
                error=f"Error: String '{old_string}' appears multiple times. Use replace_all=true to replace all occurrences."
            )

        next_content = content.replace(old_string, new_string) if replace_all else content.replace(old_string, new_string, 1)
        upload_result = self.upload_files([(file_path, next_content.encode("utf-8"))])[0]
        if upload_result.error is not None:
            return EditResult(error=f"Failed to edit file '{file_path}'")
        return EditResult(path=file_path, files_update=None, occurrences=occurrences)

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        started_at = time.perf_counter()
        responses: list[FileUploadResponse] = []
        transport_paths: list[str] = []
        for requested_path, content in files:
            path = self._normalize_runtime_path(requested_path)
            transport_paths.append(path)
            virtual_path = self._to_virtual_runtime_path(path)
            if not self._is_absolute_path(path):
                responses.append(self._upload_error_for(virtual_path))
                continue
            try:
                self._client.file.upload_file(file=content, path=path)
                responses.append(FileUploadResponse(path=virtual_path, error=None))
            except ApiError as exc:
                if exc.status_code == 403:
                    responses.append(FileUploadResponse(path=virtual_path, error="permission_denied"))
                    continue
                if exc.status_code == 404:
                    responses.append(FileUploadResponse(path=virtual_path, error="file_not_found"))
                    continue
                logger.error("Failed to upload file to sandbox %s: %s", self.id, exc)
                responses.append(FileUploadResponse(path=virtual_path, error="invalid_path"))
            except PermissionError:
                responses.append(FileUploadResponse(path=virtual_path, error="permission_denied"))
            except FileNotFoundError:
                responses.append(FileUploadResponse(path=virtual_path, error="file_not_found"))
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to upload file to sandbox %s: %s", self.id, exc)
                responses.append(FileUploadResponse(path=virtual_path, error="invalid_path"))
        self._log_transport_success(
            operation="upload_files",
            started_at=started_at,
            files_count=len(files),
            first_path=_first_item([path for path, _content in files]),
            first_transport_path=_first_item(transport_paths),
            total_bytes=sum(len(content) for _path, content in files),
            errors=_count_response_errors(responses),
        )
        return responses

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        started_at = time.perf_counter()
        responses: list[FileDownloadResponse] = []
        transport_paths: list[str] = []
        for requested_path in paths:
            path = self._normalize_runtime_path(requested_path)
            transport_paths.append(path)
            virtual_path = self._to_virtual_runtime_path(path)
            if not self._is_absolute_path(path):
                responses.append(self._download_error_for(virtual_path))
                continue
            try:
                content = b"".join(self._client.file.download_file(path=path))
                responses.append(FileDownloadResponse(path=virtual_path, content=content, error=None))
            except ApiError as exc:
                message = self._api_error_message(exc).lower()
                if exc.status_code == 403:
                    responses.append(FileDownloadResponse(path=virtual_path, content=None, error="permission_denied"))
                    continue
                if exc.status_code == 404:
                    responses.append(FileDownloadResponse(path=virtual_path, content=None, error="file_not_found"))
                    continue
                if "directory" in message:
                    responses.append(FileDownloadResponse(path=virtual_path, content=None, error="is_directory"))
                    continue
                logger.error("Failed to download file from sandbox %s: %s", self.id, exc)
                responses.append(FileDownloadResponse(path=virtual_path, content=None, error="file_not_found"))
            except PermissionError:
                responses.append(FileDownloadResponse(path=virtual_path, content=None, error="permission_denied"))
            except FileNotFoundError:
                responses.append(FileDownloadResponse(path=virtual_path, content=None, error="file_not_found"))
            except IsADirectoryError:
                responses.append(FileDownloadResponse(path=virtual_path, content=None, error="is_directory"))
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to download file from sandbox %s: %s", self.id, exc)
                responses.append(FileDownloadResponse(path=virtual_path, content=None, error="file_not_found"))
        self._log_transport_success(
            operation="download_files",
            started_at=started_at,
            files_count=len(paths),
            first_path=_first_item(paths),
            first_transport_path=_first_item(transport_paths),
            total_bytes=_total_downloaded_bytes(responses),
            errors=_count_response_errors(responses),
        )
        return responses
