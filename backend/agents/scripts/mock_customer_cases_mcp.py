"""Mock customer MCP server backed by the provided numerology case files.

This simulates the customer-hosted private system from the original task:

- list which files exist
- read file content by page
- grep file content
- glob files

The data lives outside Deer Flow knowledge-base ingestion and is fetched only
through MCP tools at runtime.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
from pathlib import Path, PurePosixPath

from mcp.server.fastmcp import FastMCP

ROOT = Path(
    os.getenv(
        "CUSTOMER_CASES_ROOT",
        "/openagents-home/runtime/mock-customer-data/cases",
    )
).resolve()

mcp = FastMCP("customer-cases")


def _safe_relative_path(value: str) -> Path:
    normalized = str(value or "").strip().strip("/")
    if not normalized:
        return Path(".")
    relative = PurePosixPath(normalized)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("path must stay inside the customer cases root")
    return Path(relative.as_posix())


def _resolve_file(path: str) -> Path:
    relative = _safe_relative_path(path)
    resolved = (ROOT / relative).resolve()
    if ROOT not in resolved.parents and resolved != ROOT:
        raise ValueError("resolved path escapes the customer cases root")
    if not resolved.exists():
        raise FileNotFoundError(f"file not found: {path}")
    return resolved


@mcp.tool()
def list_files(path: str = "", cursor: int = 0, limit: int = 20) -> str:
    """List files available under the customer cases root."""

    base = _resolve_file(path) if path else ROOT
    files = sorted(
        item.relative_to(ROOT).as_posix()
        for item in base.rglob("*")
        if item.is_file()
    )
    next_cursor = cursor + limit
    payload = {
        "items": files[cursor:next_cursor],
        "cursor": cursor,
        "limit": limit,
        "has_more": next_cursor < len(files),
        "next_cursor": next_cursor if next_cursor < len(files) else None,
    }
    return json.dumps(payload, ensure_ascii=False)


@mcp.tool()
def read_file_page(path: str, page: int = 1, page_size: int = 4000) -> str:
    """Read one page of a customer file without returning the whole document."""

    file_path = _resolve_file(path)
    if not file_path.is_file():
        raise ValueError(f"path is not a file: {path}")

    text = file_path.read_text(encoding="utf-8")
    start = max(page - 1, 0) * page_size
    end = start + page_size
    payload = {
        "path": file_path.relative_to(ROOT).as_posix(),
        "page": page,
        "page_size": page_size,
        "has_more": end < len(text),
        "content": text[start:end],
    }
    return json.dumps(payload, ensure_ascii=False)


@mcp.tool()
def grep_files(pattern: str, path: str = "", glob_pattern: str = "*.md", cursor: int = 0, limit: int = 20) -> str:
    """Search file contents under the customer cases root."""

    base = _resolve_file(path) if path else ROOT
    regex = re.compile(pattern, re.IGNORECASE)
    matches: list[dict[str, object]] = []
    for candidate in sorted(item for item in base.rglob("*") if item.is_file()):
        relative = candidate.relative_to(ROOT).as_posix()
        if not fnmatch.fnmatch(relative, glob_pattern):
            continue
        text = candidate.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), start=1):
            if regex.search(line):
                matches.append(
                    {
                        "path": relative,
                        "line_number": line_number,
                        "line": line,
                    }
                )
    next_cursor = cursor + limit
    payload = {
        "items": matches[cursor:next_cursor],
        "cursor": cursor,
        "limit": limit,
        "has_more": next_cursor < len(matches),
        "next_cursor": next_cursor if next_cursor < len(matches) else None,
    }
    return json.dumps(payload, ensure_ascii=False)


@mcp.tool()
def glob_files(pattern: str = "*.md", path: str = "") -> str:
    """Glob files under the customer cases root."""

    base = _resolve_file(path) if path else ROOT
    payload = {
        "items": sorted(
            item.relative_to(ROOT).as_posix()
            for item in base.rglob("*")
            if item.is_file() and fnmatch.fnmatch(item.relative_to(ROOT).as_posix(), pattern)
        )
    }
    return json.dumps(payload, ensure_ascii=False)


if __name__ == "__main__":
    mcp.run("stdio")
