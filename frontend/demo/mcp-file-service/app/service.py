"""Storage and tool helpers for the standalone file MCP workbench."""

from __future__ import annotations

import fnmatch
import json
import mimetypes
import os
import re
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import UploadFile

EMPTY_CONTENT_WARNING = "System reminder: File exists but has empty contents"
VIRTUAL_UPLOAD_ROOTS = (
    PurePosixPath("/mnt/user-data/uploads"),
    PurePosixPath("/mnt/user-data"),
)


@dataclass(frozen=True)
class ToolArgument:
    """Static tool argument metadata for the admin catalog surface."""

    name: str
    type: str
    required: bool
    description: str
    default: str | int | None = None


@dataclass(frozen=True)
class ToolDescriptor:
    """Human-readable tool metadata shared by the UI and MCP workbench."""

    name: str
    summary: str
    returns: str
    arguments: tuple[ToolArgument, ...]


def _iso8601(value: float) -> str:
    return datetime.fromtimestamp(value, tz=UTC).isoformat()


def build_tool_catalog() -> list[dict[str, Any]]:
    """Return a stable tool catalog for the demo admin API."""

    descriptors = (
        ToolDescriptor(
            name="fs_ls",
            summary="List files and directories in a given relative path.",
            returns="JSON payload with entries, cursor, limit, and has_more.",
            arguments=(
                ToolArgument("path", "string", False, "Relative directory under the uploaded root."),
                ToolArgument("cursor", "integer", False, "Zero-based pagination cursor.", default=0),
                ToolArgument("limit", "integer", False, "Maximum number of file rows to return.", default=20),
            ),
        ),
        ToolDescriptor(
            name="fs_read",
            summary="Read one file using offset and limit semantics aligned with filesystem middleware.",
            returns="JSON payload with file metadata, line window, and next_offset.",
            arguments=(
                ToolArgument("file_path", "string", True, "Relative file path under the uploaded root."),
                ToolArgument("offset", "integer", False, "Zero-based line offset.", default=0),
                ToolArgument("limit", "integer", False, "Maximum number of lines to return.", default=2000),
            ),
        ),
        ToolDescriptor(
            name="fs_grep",
            summary="Search file contents by text or regex pattern and optional glob filter.",
            returns="JSON payload with matches, files-with-matches, or per-file counts.",
            arguments=(
                ToolArgument("pattern", "string", True, "Text or regex-like pattern to search for."),
                ToolArgument("path", "string", False, "Relative directory to search under."),
                ToolArgument("glob", "string", False, "File glob filter such as *.md or **/*.txt.", default="*"),
                ToolArgument("output_mode", "string", False, "One of content, files_with_matches, or count.", default="content"),
                ToolArgument("cursor", "integer", False, "Zero-based pagination cursor.", default=0),
                ToolArgument("limit", "integer", False, "Maximum number of matches to return.", default=20),
            ),
        ),
        ToolDescriptor(
            name="fs_glob",
            summary="Match file paths by glob pattern.",
            returns="JSON payload with matching file rows.",
            arguments=(
                ToolArgument("pattern", "string", False, "Glob such as *.md or Final_*.*.", default="*"),
                ToolArgument("path", "string", False, "Relative directory to search under."),
            ),
        ),
    )
    return [
        {
            "name": item.name,
            "summary": item.summary,
            "returns": item.returns,
            "arguments": [
                {
                    "name": arg.name,
                    "type": arg.type,
                    "required": arg.required,
                    "description": arg.description,
                    "default": arg.default,
                }
                for arg in item.arguments
            ],
        }
        for item in descriptors
    ]


class FileMcpService:
    """Owns uploaded file storage and the MCP-facing file search helpers."""

    def __init__(self, root: Path, *, seed_root: Path | None = None) -> None:
        self.root = root.resolve()
        self.seed_root = seed_root.resolve() if seed_root else None
        self.root.mkdir(parents=True, exist_ok=True)
        self._seed_if_empty()

    def _seed_if_empty(self) -> None:
        """Optionally copy a read-only starter dataset into an empty service root."""

        if self.seed_root is None or not self.seed_root.exists():
            return
        if any(self.root.iterdir()):
            return
        shutil.copytree(self.seed_root, self.root, dirs_exist_ok=True)

    def _safe_relative_path(self, value: str) -> Path:
        raw_value = str(value or "").strip()
        normalized_path = PurePosixPath(raw_value or ".")

        # Real OpenAgents runs often expose uploaded knowledge files through the
        # virtual `/mnt/user-data/uploads/...` contract. Agents may echo that
        # absolute-looking path back into MCP calls, so strip only the known
        # virtual prefixes and keep every other path subject to the normal
        # in-root safety check.
        for virtual_root in VIRTUAL_UPLOAD_ROOTS:
            if normalized_path == virtual_root:
                normalized_path = PurePosixPath(".")
                break
            try:
                normalized_path = normalized_path.relative_to(virtual_root)
                break
            except ValueError:
                continue

        normalized = normalized_path.as_posix().strip("/")
        if not normalized:
            return Path(".")
        relative = PurePosixPath(normalized)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("path must stay inside the uploaded file root")
        return Path(relative.as_posix())

    def _resolve_path(self, value: str) -> Path:
        relative = self._safe_relative_path(value)
        resolved = (self.root / relative).resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise ValueError("resolved path escapes the uploaded file root")
        return resolved

    def _resolve_existing_path(self, value: str) -> Path:
        resolved = self._resolve_path(value)
        if resolved.exists():
            return resolved

        relative = self._safe_relative_path(value)

        # OpenAgents runtime paths can include extra virtual prefixes such as
        # `/mnt/user-data/agents/dev/<agent>/...` even though this demo service
        # only stores the uploaded knowledge root. When that happens, recover by
        # scanning suffixes until one matches a real uploaded path. This keeps
        # the MCP contract tolerant to runtime-specific absolute paths without
        # exposing host filesystem access.
        parts = relative.parts
        for index in range(1, len(parts)):
            fallback = (self.root / Path(*parts[index:])).resolve()
            if fallback.exists() and (fallback == self.root or self.root in fallback.parents):
                return fallback

        if str(relative) in {".", "agents"}:
            return self.root

        # Some runtime prompts still ask the MCP server to inspect
        # `/mnt/user-data/agents[/dev|/prod|/<agent>]` even though this service
        # only exposes the uploaded knowledge tree. Treat that whole namespace
        # as an alias for the uploaded root instead of failing the call.
        if parts and parts[0] == "agents":
            return self.root
        raise FileNotFoundError(f"path not found: {value}")

    def _file_row(self, file_path: Path) -> dict[str, Any]:
        stat = file_path.stat()
        relative = file_path.relative_to(self.root).as_posix()
        return {
            "path": relative,
            "name": file_path.name,
            "entry_type": "file",
            "size_bytes": stat.st_size,
            "updated_at": _iso8601(stat.st_mtime),
            "mime_type": mimetypes.guess_type(relative)[0] or "application/octet-stream",
        }

    def _directory_row(self, dir_path: Path) -> dict[str, Any]:
        relative = dir_path.relative_to(self.root).as_posix()
        return {
            "path": relative,
            "name": dir_path.name,
            "entry_type": "directory",
            "size_bytes": None,
            "updated_at": _iso8601(dir_path.stat().st_mtime),
            "mime_type": None,
        }

    def ls_payload(
        self,
        *,
        path: str = "",
        cursor: int = 0,
        limit: int = 20,
    ) -> dict[str, Any]:
        """List direct children so the MCP behaves like filesystem ls, not recursive export."""

        base = self._resolve_existing_path(path) if path else self.root
        if not base.is_dir():
            raise ValueError(f"path is not a directory: {path}")

        rows: list[dict[str, Any]] = []
        for item in sorted(
            base.iterdir(),
            key=lambda candidate: (not candidate.is_dir(), candidate.name.lower()),
        ):
            rows.append(
                self._directory_row(item) if item.is_dir() else self._file_row(item)
            )

        safe_cursor = max(cursor, 0)
        safe_limit = min(max(limit, 1), 200)
        next_cursor = safe_cursor + safe_limit
        return {
            "items": rows[safe_cursor:next_cursor],
            "cursor": safe_cursor,
            "limit": safe_limit,
            "total": len(rows),
            "has_more": next_cursor < len(rows),
            "next_cursor": next_cursor if next_cursor < len(rows) else None,
        }

    def list_files_payload(
        self,
        *,
        path: str = "",
        cursor: int = 0,
        limit: int = 20,
    ) -> dict[str, Any]:
        """List files under the uploaded root or one nested directory."""

        base = self._resolve_existing_path(path) if path else self.root
        if not base.is_dir():
            raise ValueError(f"path is not a directory: {path}")
        safe_cursor = max(cursor, 0)
        safe_limit = min(max(limit, 1), 200)
        items = [self._file_row(item) for item in sorted(base.rglob("*")) if item.is_file()]
        next_cursor = safe_cursor + safe_limit
        return {
            "items": items[safe_cursor:next_cursor],
            "cursor": safe_cursor,
            "limit": safe_limit,
            "total": len(items),
            "has_more": next_cursor < len(items),
            "next_cursor": next_cursor if next_cursor < len(items) else None,
        }

    def read_file_payload(
        self,
        *,
        file_path: str,
        offset: int = 0,
        limit: int = 2000,
    ) -> dict[str, Any]:
        """Read one file using line offsets to mirror FilesystemMiddleware semantics."""

        resolved_file = self._resolve_existing_path(file_path)
        if not resolved_file.is_file():
            raise ValueError(f"path is not a file: {file_path}")

        safe_offset = max(offset, 0)
        safe_limit = min(max(limit, 1), 5000)
        all_lines = resolved_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        window = all_lines[safe_offset : safe_offset + safe_limit]
        rendered_lines = [
            f"{line_number:>6}\t{line}"
            for line_number, line in enumerate(window, start=safe_offset + 1)
        ]
        next_offset = safe_offset + len(window)
        has_more = next_offset < len(all_lines)
        footer = (
            f"\n\n(lines {safe_offset + 1}-{next_offset} of {len(all_lines)}; next_offset={next_offset})"
            if window and has_more
            else "\n\n(End of file)"
        )
        content = "\n".join(rendered_lines) if rendered_lines else EMPTY_CONTENT_WARNING
        return {
            **self._file_row(resolved_file),
            "file_path": file_path,
            "offset": safe_offset,
            "limit": safe_limit,
            "total_lines": len(all_lines),
            "returned_lines": len(window),
            "has_more": has_more,
            "next_offset": next_offset if has_more else None,
            "content": f"{content}{footer}",
        }

    def preview_file_payload(
        self,
        *,
        path: str,
        page: int = 1,
        page_size: int = 4000,
    ) -> dict[str, Any]:
        """Keep the UI preview endpoint text-first while MCP uses line windows."""

        resolved_file = self._resolve_existing_path(path)
        if not resolved_file.is_file():
            raise ValueError(f"path is not a file: {path}")
        safe_page = max(page, 1)
        safe_page_size = min(max(page_size, 256), 20_000)
        text = resolved_file.read_text(encoding="utf-8", errors="ignore")
        start = (safe_page - 1) * safe_page_size
        end = start + safe_page_size
        return {
            **self._file_row(resolved_file),
            "page": safe_page,
            "page_size": safe_page_size,
            "total_chars": len(text),
            "has_more": end < len(text),
            "content": text[start:end],
        }

    @staticmethod
    def _normalize_grep_output_mode(output_mode: str) -> tuple[str, str]:
        """Coerce model-generated grep modes into a stable canonical contract.

        Real model traces occasionally send close-but-not-exact values such as
        `count`, `files`, or other grep-style aliases. The MCP layer should be
        tolerant here because the intent is still unambiguous, and a hard 400
        turns a recoverable tool-call mismatch into a failed user run.
        """

        requested_mode = str(output_mode or "").strip()
        normalized = requested_mode.lower().replace("-", "_").replace(" ", "_")
        if not normalized:
            return "content", requested_mode

        alias_map = {
            "content": "content",
            "matches": "content",
            "match_content": "content",
            "files_with_matches": "files_with_matches",
            "file_with_matches": "files_with_matches",
            "files": "files_with_matches",
            "file": "files_with_matches",
            "filenames": "files_with_matches",
            "paths": "files_with_matches",
            "count": "count",
            "counts": "count",
            "summary": "count",
            "stats": "count",
            "totals": "count",
        }
        return alias_map.get(normalized, "content"), requested_mode

    @staticmethod
    def _line_matches_pattern(*, line: str, normalized_pattern: str, raw_pattern: str) -> bool:
        """Match grep input as literal text first, then regex when clearly intended.

        LLMs often generate grep-style alternations such as `foo|bar`. Literal
        matching keeps simple terms cheap and predictable, while the regex
        fallback preserves those broader grep queries without forcing the model
        to learn a second MCP-specific search dialect.
        """

        lowered_line = line.lower()
        if normalized_pattern in lowered_line:
            return True

        if not any(token in raw_pattern for token in ("|", "\\", "[", "]", "(", ")", "{", "}", "^", "$", ".", "*", "+", "?")):
            return False

        try:
            return re.search(raw_pattern, line, flags=re.IGNORECASE) is not None
        except re.error:
            return False

    def grep_payload(
        self,
        *,
        pattern: str,
        path: str = "",
        glob: str = "*",
        output_mode: str = "content",
        cursor: int = 0,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Search the uploaded files by literal match and optional file glob filter."""

        base = self._resolve_existing_path(path) if path else self.root
        safe_cursor = max(cursor, 0)
        safe_limit = min(max(limit, 1), 200)
        normalized_pattern = pattern.strip().lower()
        if not normalized_pattern:
            raise ValueError("pattern is required")
        resolved_output_mode, requested_output_mode = self._normalize_grep_output_mode(output_mode)

        # Agents naturally pass the exact file path they just discovered from
        # `fs_ls` or `fs_glob`. Accept both a directory scope and a single-file
        # scope so MCP usage matches operator intuition instead of forcing the
        # model to normalize paths manually before every grep call.
        if base.is_file():
            candidates = [base]
        elif base.is_dir():
            candidates = sorted(base.rglob("*"))
        else:
            raise ValueError(f"path is not a file or directory: {path}")

        matches: list[dict[str, Any]] = []
        for candidate in candidates:
            if not candidate.is_file():
                continue
            relative = candidate.relative_to(self.root).as_posix()
            if not fnmatch.fnmatch(relative, glob):
                continue
            text = candidate.read_text(encoding="utf-8", errors="ignore")
            for line_number, line in enumerate(text.splitlines(), start=1):
                if self._line_matches_pattern(
                    line=line,
                    normalized_pattern=normalized_pattern,
                    raw_pattern=pattern,
                ):
                    matches.append(
                        {
                            "path": relative,
                            "line_number": line_number,
                            "line": line,
                        }
                    )

        response_metadata = {
            "output_mode": resolved_output_mode,
            "requested_output_mode": requested_output_mode,
        }

        if resolved_output_mode == "files_with_matches":
            unique_files = sorted({item["path"] for item in matches})
            next_cursor = safe_cursor + safe_limit
            return {
                "items": unique_files[safe_cursor:next_cursor],
                "cursor": safe_cursor,
                "limit": safe_limit,
                "total": len(unique_files),
                "has_more": next_cursor < len(unique_files),
                "next_cursor": next_cursor if next_cursor < len(unique_files) else None,
                **response_metadata,
            }

        if resolved_output_mode == "count":
            file_counts: dict[str, int] = {}
            for item in matches:
                file_counts[item["path"]] = file_counts.get(item["path"], 0) + 1
            rows = [
                {"path": path_name, "match_count": count}
                for path_name, count in sorted(file_counts.items())
            ]
            next_cursor = safe_cursor + safe_limit
            return {
                "items": rows[safe_cursor:next_cursor],
                "cursor": safe_cursor,
                "limit": safe_limit,
                "total": len(rows),
                "total_matches": len(matches),
                "has_more": next_cursor < len(rows),
                "next_cursor": next_cursor if next_cursor < len(rows) else None,
                **response_metadata,
            }

        next_cursor = safe_cursor + safe_limit
        return {
            "items": matches[safe_cursor:next_cursor],
            "cursor": safe_cursor,
            "limit": safe_limit,
            "total": len(matches),
            "has_more": next_cursor < len(matches),
            "next_cursor": next_cursor if next_cursor < len(matches) else None,
            **response_metadata,
        }

    def glob_payload(self, *, pattern: str = "*", path: str = "") -> dict[str, Any]:
        """Match uploaded files by glob without reading content."""

        base = self._resolve_existing_path(path) if path else self.root
        if not base.is_dir():
            raise ValueError(f"path is not a directory: {path}")
        items = [
            self._file_row(item)
            for item in sorted(base.rglob("*"))
            if item.is_file()
            and fnmatch.fnmatch(item.relative_to(self.root).as_posix(), pattern)
        ]
        return {
            "items": items,
            "total": len(items),
        }

    async def store_uploads(
        self,
        files: list[UploadFile],
        *,
        relative_paths: list[str] | None = None,
    ) -> dict[str, Any]:
        """Persist uploaded files and return the rows needed by the UI refresh."""

        if not files:
            raise ValueError("at least one file must be uploaded")

        normalized_paths = relative_paths or []
        saved: list[dict[str, Any]] = []
        for index, upload in enumerate(files):
            chosen_name = (
                normalized_paths[index]
                if index < len(normalized_paths) and normalized_paths[index].strip()
                else upload.filename or f"upload-{index + 1}"
            )
            destination = self._resolve_path(chosen_name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            content = await upload.read()
            destination.write_bytes(content)
            saved.append(self._file_row(destination))
            await upload.close()
        return {
            "saved": saved,
            "saved_count": len(saved),
        }

    def delete_file(self, path: str) -> None:
        """Delete one uploaded file while keeping directory traversal blocked."""

        file_path = self._resolve_existing_path(path)
        if not file_path.is_file():
            raise ValueError(f"path is not a file: {path}")
        file_path.unlink()

    def reset_uploaded_files(self) -> dict[str, Any]:
        """Clear the mutable dataset and optionally repopulate the seed snapshot."""

        removed = 0
        for candidate in sorted(self.root.rglob("*"), reverse=True):
            if candidate.is_file():
                candidate.unlink()
                removed += 1
            elif candidate.is_dir() and candidate != self.root:
                candidate.rmdir()
        self._seed_if_empty()
        return {
            "removed_files": removed,
            "remaining_files": self.list_files_payload(limit=1)["total"],
        }

    def health_payload(self, *, base_url: str) -> dict[str, Any]:
        """Return a compact health row for the demo shell header."""

        listing = self.list_files_payload(limit=1)
        return {
            "status": "ok",
            "storage_root": str(self.root),
            "seed_root": str(self.seed_root) if self.seed_root else None,
            "file_count": listing["total"],
            # FastMCP's generated HTTP app already owns an internal `/mcp` route,
            # so the outer service mounts it under `/mcp-http`.
            "mcp_url": f"{base_url.rstrip('/')}/mcp-http/mcp",
            "tool_catalog": build_tool_catalog(),
        }

    def tool_payload_json(self, payload: dict[str, Any]) -> str:
        """Serialize MCP tool payloads with UTF-8 preserved for Chinese content."""

        return json.dumps(payload, ensure_ascii=False)


def build_workbench_service_from_env() -> FileMcpService:
    """Construct the storage service from process env for both API and MCP usage."""

    root = Path(
        os.getenv(
            "MCP_WORKBENCH_DATA_DIR",
            "/data/files",
        )
    )
    seed_value = os.getenv("MCP_WORKBENCH_SEED_DIR", "").strip()
    return FileMcpService(
        root,
        seed_root=Path(seed_value) if seed_value else None,
    )
