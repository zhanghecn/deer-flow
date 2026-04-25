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
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from fastapi import UploadFile

from .documents import DocumentTooling

EMPTY_CONTENT_WARNING = "System reminder: File exists but has empty contents"
BINARY_DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
}
TEXT_MIME_TYPES = {
    "application/javascript",
    "application/json",
    "application/ld+json",
    "application/ndjson",
    "application/toml",
    "application/x-javascript",
    "application/x-sh",
    "application/x-toml",
    "application/x-yaml",
    "application/xml",
    "application/yaml",
    "image/svg+xml",
}
TEXT_SNIFF_BYTES = 4096
DOCUMENT_LIST_FULL_TREE_MAX_FILES = 350
DOCUMENT_LIST_MAX_LIMIT = 500
VIRTUAL_UPLOAD_ROOTS = (
    PurePosixPath("/mnt/user-data/uploads"),
    # The generic runtime also uses `/mnt/user-data/workspace` as its virtual
    # working root. Accept it here so the demo MCP can serve the same uploads
    # without leaking host filesystem access or requiring runtime-specific prompts.
    PurePosixPath("/mnt/user-data/workspace"),
    PurePosixPath("/mnt/user-data"),
)

FileContentKind = Literal["text", "binary_document", "binary_file"]


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


@dataclass(frozen=True)
class FileContentAccess:
    """Explicit text-vs-binary classification for generic filesystem tools.

    The demo used to hide PDF / Office files behind generated Markdown shadow
    files. That blurred the contract: `fs_read` looked generic but actually
    depended on an implicit conversion pipeline. Keep the classification
    explicit so generic text tools only claim text capability.
    """

    kind: FileContentKind
    mime_type: str
    text_readable: bool


def _iso8601(value: float) -> str:
    return datetime.fromtimestamp(value, tz=UTC).isoformat()


DOCUMENT_TOOL_DESCRIPTORS = (
    ToolDescriptor(
        name="document_list",
        summary=(
            "List the current knowledge-base document tree. Small KBs include "
            "a complete compact tree so inventory questions usually need one call."
        ),
        returns="JSON payload with directory/file entries, optional complete tree, metadata, and pagination.",
        arguments=(
            ToolArgument("path", "string", False, "Relative directory under the uploaded root."),
            ToolArgument("cursor", "integer", False, "Zero-based pagination cursor.", default=0),
            ToolArgument("limit", "integer", False, "Maximum number of rows to return.", default=400),
        ),
    ),
    ToolDescriptor(
        name="document_search",
        summary=(
            "Grep parsed document text, OCR text, tables, and visual summaries "
            "across PDF, image, and Office files with a Claude Code-like "
            "pattern/output_mode contract, then call document_read for locators."
        ),
        returns="JSON payload with grep-style files_with_matches, content, or count output plus locator metadata.",
        arguments=(
            ToolArgument("pattern", "string", True, "Regular expression or literal grep pattern."),
            ToolArgument("path", "string", False, "Optional file or directory scope under the uploaded root."),
            ToolArgument("glob", "string", False, "Glob filter such as *.pdf or **/*.docx."),
            ToolArgument("output_mode", "string", False, "content, files_with_matches, or count.", default="files_with_matches"),
            ToolArgument("context", "integer", False, "Lines before and after each content match.", default=0),
            ToolArgument("before", "integer", False, "Lines before each content match.", default=0),
            ToolArgument("after", "integer", False, "Lines after each content match.", default=0),
            ToolArgument("head_limit", "integer", False, "Maximum output rows; 0 means unlimited.", default=250),
            ToolArgument("offset", "integer", False, "Rows to skip before applying head_limit.", default=0),
        ),
    ),
    ToolDescriptor(
        name="document_read",
        summary=(
            "Read one document using page/slide/sheet/region cursors. The response "
            "includes `contains_visual`, `has_more`, and rich content blocks so the "
            "agent can decide whether to continue reading or fetch an asset."
        ),
        returns="JSON payload with locator metadata, pagination, and content_blocks.",
        arguments=(
            ToolArgument("path", "string", True, "Relative file path under the uploaded root."),
            ToolArgument("cursor", "integer", False, "Zero-based unit cursor.", default=0),
            ToolArgument("limit", "integer", False, "Maximum number of units to return.", default=3),
        ),
    ),
    ToolDescriptor(
        name="document_fetch_asset",
        summary=(
            "Fetch one visual asset referenced by `document_read`. Small images are "
            "inlined as base64 so the demo can verify end-to-end visual asset access."
        ),
        returns="JSON payload with asset metadata and optional inlined base64 content.",
        arguments=(
            ToolArgument("path", "string", True, "Relative file path under the uploaded root."),
            ToolArgument("asset_ref", "string", True, "Asset reference returned by document_read."),
        ),
    ),
)


def build_tool_catalog() -> list[dict[str, Any]]:
    """Return the stable document-tool catalog for the demo admin API."""

    descriptors = DOCUMENT_TOOL_DESCRIPTORS
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

    def __init__(
        self,
        root: Path,
        *,
        seed_root: Path | None = None,
        cache_root: Path | None = None,
        ocr_languages: tuple[str, ...] | None = None,
        tesseract_binary: str = "tesseract",
    ) -> None:
        self.root = root.resolve()
        self.seed_root = seed_root.resolve() if seed_root else None
        self.cache_root = (
            cache_root.resolve() if cache_root else self.root.parent / "document-cache"
        )
        # Document parsing stays inside the 8084 demo service so richer document
        # semantics do not leak into the shared runtime or prompt layers.
        self.document_tools = DocumentTooling(
            root=self.root,
            describe_access=self._describe_file_content_access,
            cache_root=self.cache_root,
            ocr_languages=ocr_languages or ("eng", "chi_sim"),
            tesseract_binary=tesseract_binary,
        )
        self.root.mkdir(parents=True, exist_ok=True)
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self._seed_if_empty()

    def prime_document_cache(self) -> None:
        """Build cached manifests/markdown/assets for the current corpus."""

        self.document_tools.prime_cache()

    def _seed_if_empty(self) -> None:
        """Optionally copy a read-only starter dataset into an empty service root."""

        if self.seed_root is None or not self.seed_root.exists():
            return
        if any(self.root.iterdir()):
            return
        shutil.copytree(self.seed_root, self.root, dirs_exist_ok=True)

    @staticmethod
    def _is_probably_text_file(file_path: Path) -> bool:
        """Sniff a small byte prefix so extensionless text files stay readable.

        MIME/extension rules are the primary contract. The byte sniff only keeps
        obviously textual uploads from being misclassified as binary when they
        lack a useful extension.
        """

        with file_path.open("rb") as handle:
            sample = handle.read(TEXT_SNIFF_BYTES)
        if not sample:
            return True
        if b"\x00" in sample:
            return False
        try:
            sample.decode("utf-8")
        except UnicodeDecodeError:
            return False
        return True

    def _describe_file_content_access(self, file_path: Path) -> FileContentAccess:
        """Classify whether generic filesystem tools may treat this file as text."""

        relative = file_path.relative_to(self.root).as_posix()
        mime_type = mimetypes.guess_type(relative)[0] or "application/octet-stream"
        extension = file_path.suffix.lower()
        if extension in BINARY_DOCUMENT_EXTENSIONS:
            return FileContentAccess(
                kind="binary_document",
                mime_type=mime_type,
                text_readable=False,
            )
        if mime_type.startswith("text/") or mime_type in TEXT_MIME_TYPES:
            return FileContentAccess(kind="text", mime_type=mime_type, text_readable=True)
        if self._is_probably_text_file(file_path):
            return FileContentAccess(kind="text", mime_type=mime_type, text_readable=True)
        return FileContentAccess(
            kind="binary_file",
            mime_type=mime_type,
            text_readable=False,
        )

    @staticmethod
    def _matches_glob(*, requested_path: str, pattern: str) -> bool:
        """Match one relative file path against a glob filter."""

        return fnmatch.fnmatch(requested_path, pattern)

    @staticmethod
    def _text_only_tool_message(
        *,
        tool_name: str,
        file_name: str,
        access: FileContentAccess,
    ) -> str:
        if access.kind == "binary_document":
            return (
                f"{tool_name} only supports text files. '{file_name}' is "
                f"{access.mime_type}. PDF and Office files stay binary on the "
                "text-preview surface, so generic line reads will not work. "
                "Use the document_* MCP tools for parsed document access."
            )
        return (
            f"{tool_name} only supports text files. '{file_name}' is "
            f"{access.mime_type}."
        )

    def _require_text_file(
        self,
        *,
        file_path: Path,
        tool_name: str,
    ) -> FileContentAccess:
        """Fail fast when a generic text tool is pointed at a binary file."""

        access = self._describe_file_content_access(file_path)
        if access.text_readable:
            return access
        raise ValueError(
            self._text_only_tool_message(
                tool_name=tool_name,
                file_name=file_path.name,
                access=access,
            )
        )

    @staticmethod
    def _sorted_file_paths(base: Path, *, recursive: bool) -> list[Path]:
        iterator = base.rglob("*") if recursive else base.iterdir()
        return [
            candidate.resolve()
            for candidate in sorted(iterator, key=lambda item: item.as_posix().lower())
            if candidate.is_file()
        ]

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
        access = self._describe_file_content_access(file_path)
        row = {
            "path": relative,
            "name": file_path.name,
            "entry_type": "file",
            "size_bytes": stat.st_size,
            "updated_at": _iso8601(stat.st_mtime),
            "mime_type": access.mime_type,
            "content_kind": access.kind,
            "text_readable": access.text_readable,
        }
        return row

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
            if item.is_dir():
                rows.append(self._directory_row(item))
                continue
            rows.append(self._file_row(item.resolve()))

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

    def document_list_payload(
        self,
        *,
        path: str = "",
        cursor: int = 0,
        limit: int = 400,
    ) -> dict[str, Any]:
        """List the KB tree without exposing raw filesystem-only semantics.

        This is the browse/list counterpart to `document_search`. Directory
        entries remain visible, and small KBs also include a compact recursive
        tree so the agent can choose a target document without pagination.
        """

        base = self._resolve_existing_path(path) if path else self.root
        if not base.is_dir():
            raise ValueError(f"path is not a directory: {path}")

        rows: list[dict[str, Any]] = []
        for item in sorted(
            base.iterdir(),
            key=lambda candidate: (not candidate.is_dir(), candidate.name.lower()),
        ):
            if item.is_dir():
                directory_row = self._directory_row(item)
                # Preserve whether another drill-down step exists without
                # forcing the agent to guess from the path alone.
                directory_row["has_children"] = any(item.iterdir())
                rows.append(directory_row)
                continue

            document_row = self._file_row(item.resolve())
            document_row.update(self.document_tools.describe_document(item.resolve()))
            rows.append(document_row)

        safe_cursor = max(cursor, 0)
        safe_limit = min(max(limit, 1), DOCUMENT_LIST_MAX_LIMIT)
        next_cursor = safe_cursor + safe_limit
        payload = {
            "items": rows[safe_cursor:next_cursor],
            "cursor": safe_cursor,
            "limit": safe_limit,
            "total": len(rows),
            "has_more": next_cursor < len(rows),
            "next_cursor": next_cursor if next_cursor < len(rows) else None,
        }
        payload.update(self._document_tree_summary(base))
        return payload

    def _document_tree_summary(self, base: Path) -> dict[str, Any]:
        document_paths: list[Path] = []
        for item in self._sorted_file_paths(base, recursive=True):
            # The compact tree is an agent planning surface, not a raw text-file
            # list. Ask the document parser whether the file is supported so
            # standalone OCR/image documents are not hidden from small KBs.
            if self.document_tools.describe_document(item).get("supported"):
                document_paths.append(item)
        directory_paths = [
            item
            for item in sorted(
                (candidate for candidate in base.rglob("*") if candidate.is_dir()),
                key=lambda candidate: candidate.relative_to(self.root).as_posix().lower(),
            )
        ]

        summary: dict[str, Any] = {
            "tree_root": base.relative_to(self.root).as_posix() if base != self.root else "",
            "document_total": len(document_paths),
            "directory_total": len(directory_paths),
            "complete_tree": len(document_paths) <= DOCUMENT_LIST_FULL_TREE_MAX_FILES,
            "complete_tree_limit": DOCUMENT_LIST_FULL_TREE_MAX_FILES,
        }
        if not summary["complete_tree"]:
            return summary

        # Keep the recursive inventory compact: paths plus document kind are
        # enough for planning, while `document_read` still owns content access.
        summary["document_paths"] = [
            path.relative_to(self.root).as_posix() for path in document_paths
        ]
        summary["tree"] = self._render_compact_document_tree(base, document_paths)
        return summary

    def _render_compact_document_tree(self, base: Path, document_paths: list[Path]) -> list[str]:
        directories: set[Path] = set()
        for path in document_paths:
            parent = path.parent
            while parent != base and (parent == self.root or self.root in parent.parents):
                directories.add(parent)
                parent = parent.parent
        included = sorted(
            {*directories, *document_paths},
            key=lambda item: (item.relative_to(base).as_posix().lower(), item.is_file()),
        )
        lines: list[str] = []
        for item in included:
            relative_to_base = item.relative_to(base).as_posix()
            depth = len(PurePosixPath(relative_to_base).parts) - 1
            suffix = "/" if item.is_dir() else ""
            if item.is_file():
                description = self.document_tools.describe_document(item)
                kind = description.get("document_kind") or self._describe_file_content_access(item).kind
                suffix = f" [{kind}]"
            lines.append(f"{'  ' * depth}{item.name}{suffix}")
        return lines

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
        items = [
            self._file_row(item)
            for item in self._sorted_file_paths(base, recursive=True)
        ]
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

        requested_file = self._resolve_existing_path(file_path)
        if not requested_file.is_file():
            raise ValueError(f"path is not a file: {file_path}")

        self._require_text_file(file_path=requested_file, tool_name="fs_read")
        safe_offset = max(offset, 0)
        safe_limit = min(max(limit, 1), 5000)
        all_lines = requested_file.read_text(encoding="utf-8", errors="ignore").splitlines()
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
            **self._file_row(requested_file),
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

        requested_file = self._resolve_existing_path(path)
        if not requested_file.is_file():
            raise ValueError(f"path is not a file: {path}")
        access = self._describe_file_content_access(requested_file)
        safe_page = max(page, 1)
        safe_page_size = min(max(page_size, 256), 20_000)
        if not access.text_readable:
            message = self._text_only_tool_message(
                tool_name="preview",
                file_name=requested_file.name,
                access=access,
            )
            return {
                **self._file_row(requested_file),
                "page": safe_page,
                "page_size": safe_page_size,
                "total_chars": 0,
                "has_more": False,
                "content": (
                    f"{message}\n\n"
                    "Recommended demo flow on the current agent-facing MCP:\n"
                    "- document_list(path?, cursor?, limit?) to inspect the KB tree\n"
                    "- document_search(pattern, path?, glob?, output_mode?, head_limit?, offset?) to grep parsed document evidence\n"
                    "- document_read(path, cursor?, limit?) to read the matched document"
                ),
            }
        text = requested_file.read_text(encoding="utf-8", errors="ignore")
        start = (safe_page - 1) * safe_page_size
        end = start + safe_page_size
        return {
            **self._file_row(requested_file),
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
            self._require_text_file(file_path=base, tool_name="fs_grep")
            candidates = [base.resolve()]
        elif base.is_dir():
            candidates = self._sorted_file_paths(base, recursive=True)
        else:
            raise ValueError(f"path is not a file or directory: {path}")

        matches: list[dict[str, Any]] = []
        skipped_binary_files = 0
        for candidate in candidates:
            relative = candidate.relative_to(self.root).as_posix()
            if not self._matches_glob(requested_path=relative, pattern=glob):
                continue
            access = self._describe_file_content_access(candidate)
            if not access.text_readable:
                skipped_binary_files += 1
                continue
            text = candidate.read_text(encoding="utf-8", errors="ignore")
            for line_number, line in enumerate(text.splitlines(), start=1):
                if self._line_matches_pattern(
                    line=line,
                    normalized_pattern=normalized_pattern,
                    raw_pattern=pattern,
                ):
                    item = {
                        "path": relative,
                        "line_number": line_number,
                        "line": line,
                    }
                    matches.append(item)

        response_metadata = {
            "output_mode": resolved_output_mode,
            "requested_output_mode": requested_output_mode,
            "skipped_binary_files": skipped_binary_files,
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
            for item in self._sorted_file_paths(base, recursive=True)
            if self._matches_glob(
                requested_path=item.relative_to(self.root).as_posix(),
                pattern=pattern,
            )
        ]
        return {
            "items": items,
            "total": len(items),
        }

    def document_search_payload(
        self,
        *,
        pattern: str | None = None,
        query: str | None = None,
        path: str = "",
        glob: str | None = None,
        output_mode: str = "files_with_matches",
        cursor: int = 0,
        limit: int = 10,
        context: int | None = None,
        before: int | None = None,
        after: int | None = None,
        show_line_numbers: bool = True,
        case_insensitive: bool = False,
        head_limit: int | None = None,
        offset: int = 0,
        multiline: bool = False,
    ) -> dict[str, Any]:
        """Grep parsed document evidence instead of generic text-file bytes."""

        effective_pattern = pattern if pattern is not None else query
        if effective_pattern is None:
            raise ValueError("pattern is required")
        base = self._resolve_existing_path(path) if path else self.root
        if base.is_file():
            candidates = [base.resolve()]
        elif base.is_dir():
            candidates = self._sorted_file_paths(base, recursive=True)
        else:
            raise ValueError(f"path is not a file or directory: {path}")
        return self.document_tools.search(
            files=candidates,
            pattern=effective_pattern,
            output_mode=output_mode,
            glob=glob,
            cursor=cursor,
            limit=limit,
            context_before=before,
            context_after=after,
            context=context,
            show_line_numbers=show_line_numbers,
            case_insensitive=case_insensitive,
            head_limit=head_limit,
            offset=offset,
            multiline=multiline,
        )

    def document_read_payload(
        self,
        *,
        path: str,
        cursor: int = 0,
        limit: int = 3,
    ) -> dict[str, Any]:
        """Read one parsed document window using the unified document contract."""

        requested_file = self._resolve_existing_path(path)
        if not requested_file.is_file():
            raise ValueError(f"path is not a file: {path}")
        return self.document_tools.read(
            file_path=requested_file,
            cursor=cursor,
            limit=limit,
        )

    def document_fetch_asset_payload(
        self,
        *,
        path: str,
        asset_ref: str,
    ) -> dict[str, Any]:
        """Fetch one referenced visual asset from a parsed document."""

        requested_file = self._resolve_existing_path(path)
        if not requested_file.is_file():
            raise ValueError(f"path is not a file: {path}")
        return self.document_tools.fetch_asset(
            file_path=requested_file,
            asset_ref=asset_ref,
        )

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
            # Upload-time indexing keeps the external MCP responsive for the
            # next user turn instead of waiting for a later cold parse.
            try:
                self.document_tools.prepare_cached_document(destination)
            except ValueError:
                # Unsupported binaries are still stored and listable even when
                # this demo build cannot parse them into the richer cache.
                pass
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
        self.document_tools.invalidate_cached_document(file_path)

    def reset_uploaded_files(self) -> dict[str, Any]:
        """Clear the mutable dataset and optionally repopulate the seed snapshot."""

        removed = 0
        for candidate in sorted(self.root.rglob("*"), reverse=True):
            if candidate.is_file():
                candidate.unlink()
                removed += 1
            elif candidate.is_dir() and candidate != self.root:
                candidate.rmdir()
        shutil.rmtree(self.cache_root, ignore_errors=True)
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self._seed_if_empty()
        self.prime_document_cache()
        return {
            "removed_files": removed,
            "remaining_files": self.list_files_payload(limit=1)["total"],
        }

    def health_payload(
        self,
        *,
        base_url: str,
        agent_mcp_path: str = "/mcp-http-agent/mcp",
        workbench_mcp_path: str = "/mcp-http/mcp",
    ) -> dict[str, Any]:
        """Return a compact health row for the demo shell header."""

        listing = self.list_files_payload(limit=1)
        return {
            "status": "ok",
            "storage_root": str(self.root),
            "cache_root": str(self.cache_root),
            "seed_root": str(self.seed_root) if self.seed_root else None,
            "file_count": listing["total"],
            "mcp_url": f"{base_url.rstrip('/')}{agent_mcp_path}",
            "agent_mcp_url": f"{base_url.rstrip('/')}{agent_mcp_path}",
            "workbench_mcp_url": f"{base_url.rstrip('/')}{workbench_mcp_path}",
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
    cache_value = os.getenv("MCP_WORKBENCH_CACHE_DIR", "").strip()
    ocr_languages = tuple(
        item.strip()
        for item in os.getenv("MCP_WORKBENCH_OCR_LANGUAGES", "eng,chi_sim").split(",")
        if item.strip()
    )
    tesseract_binary = os.getenv("MCP_WORKBENCH_TESSERACT_BIN", "tesseract").strip() or "tesseract"
    return FileMcpService(
        root,
        seed_root=Path(seed_value) if seed_value else None,
        cache_root=Path(cache_value) if cache_value else None,
        ocr_languages=ocr_languages,
        tesseract_binary=tesseract_binary,
    )
