"""Manual debug helper for building PageIndex-style knowledge indexes.

Usage:
    cd backend/agents
    uv run python tests/test_knowledge_index_build_debug.py

Optional pytest entry:
    cd backend/agents
    OPENAGENTS_RUN_INDEX_DEBUG=1 uv run python -m pytest -s tests/test_knowledge_index_build_debug.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config.runtime_db import get_runtime_db_store
from src.knowledge.pageindex import build_document_index

_SUPPORTED_FILE_KINDS = {
    ".pdf": "pdf",
    ".doc": "doc",
    ".docx": "docx",
    ".md": "markdown",
    ".markdown": "markdown",
}


class _ConsoleObserver:
    def __init__(self, *, display_name: str) -> None:
        self._display_name = display_name
        self._last_stage_line: tuple[str, str, int | None, int | None, int | None] | None = None

    def update_stage(
        self,
        *,
        stage: str,
        message: str,
        progress_percent: int | None = None,
        total_steps: int | None = None,
        completed_steps: int | None = None,
    ) -> None:
        payload = (stage, message, progress_percent, total_steps, completed_steps)
        if payload == self._last_stage_line:
            return
        self._last_stage_line = payload
        progress_label = (
            f" progress={progress_percent}%"
            if progress_percent is not None
            else ""
        )
        steps_label = ""
        if total_steps is not None:
            steps_label = f" steps={completed_steps or 0}/{total_steps}"
        print(
            f"[knowledge-index-debug][{self._display_name}]"
            f" stage={stage}{progress_label}{steps_label} {message}",
            flush=True,
        )

    def log_event(
        self,
        *,
        stage: str,
        step_name: str,
        status: str,
        message: str,
        elapsed_ms: int | None = None,
        retry_count: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        details: list[str] = []
        if elapsed_ms is not None:
            details.append(f"elapsed_ms={elapsed_ms}")
        if retry_count:
            details.append(f"retry_count={retry_count}")
        if input_tokens is not None:
            details.append(f"input_tokens={input_tokens}")
        if output_tokens is not None:
            details.append(f"output_tokens={output_tokens}")
        if metadata:
            compact_metadata = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
            details.append(f"metadata={compact_metadata}")
        suffix = f" ({', '.join(details)})" if details else ""
        print(
            f"[knowledge-index-debug][{self._display_name}]"
            f" event={stage}.{step_name} status={status} {message}{suffix}",
            flush=True,
        )


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _default_fixtures_dir() -> Path:
    return (_repo_root().parent / "PageIndex" / "tests" / "pdfs").resolve()


def _default_output_root() -> Path:
    return (_repo_root() / ".openagents" / "knowledge-debug").resolve()


def _timestamp_label() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def _file_kind_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix not in _SUPPORTED_FILE_KINDS:
        raise ValueError(f"Unsupported file suffix for debug indexing: {path}")
    return _SUPPORTED_FILE_KINDS[suffix]


def _candidate_documents(fixtures_dir: Path) -> list[Path]:
    candidates = [
        path
        for path in fixtures_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in _SUPPORTED_FILE_KINDS
    ]
    return sorted(candidates, key=lambda item: item.stat().st_size, reverse=True)


def _detect_markdown_companion(source_path: Path) -> Path | None:
    if source_path.suffix.lower() in {".md", ".markdown"}:
        return source_path

    for suffix in (".md", ".markdown"):
        candidate = source_path.with_suffix(suffix)
        if candidate.is_file():
            return candidate
    return None


def _sanitize_name(value: str) -> str:
    safe = []
    for char in value:
        if char.isalnum() or char in {"-", "_", "."}:
            safe.append(char)
        else:
            safe.append("_")
    return "".join(safe).strip("_") or "document"


def _root_titles(structure: list[dict[str, Any]], *, limit: int = 12) -> list[str]:
    titles: list[str] = []
    for node in structure[:limit]:
        title = str(node.get("title") or "").strip()
        if title:
            titles.append(title)
    return titles


def _tail_page_titles(nodes: list[dict[str, Any]], *, limit: int = 8) -> list[str]:
    sortable = [
        (int(node.get("page_start") or 0), str(node.get("title") or "").strip())
        for node in nodes
        if node.get("page_start") is not None and str(node.get("title") or "").strip()
    ]
    sortable.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [f"p.{page}: {title}" for page, title in sortable[:limit]]


def _sample_summaries(nodes: list[dict[str, Any]], *, limit: int = 6) -> list[str]:
    samples: list[str] = []
    for node in nodes:
        title = str(node.get("title") or "").strip()
        summary = str(
            node.get("prefix_summary")
            or node.get("summary")
            or ""
        ).strip()
        if not title or not summary:
            continue
        samples.append(f"{title}: {summary}")
        if len(samples) >= limit:
            break
    return samples


def _interesting_titles(nodes: list[dict[str, Any]]) -> list[str]:
    keywords = ("hybrid monte carlo", "woodbury", "appendix", "matrix", "image", "figure")
    matched: list[str] = []
    for node in nodes:
        title = str(node.get("title") or "").strip()
        searchable = " ".join(
            str(node.get(field) or "").strip()
            for field in ("title", "summary", "prefix_summary", "node_text")
        ).casefold()
        if not title:
            continue
        if any(keyword in searchable for keyword in keywords):
            page_start = node.get("page_start")
            label = f"p.{page_start}: {title}" if page_start is not None else title
            matched.append(label)
    return matched[:20]


def _resolve_default_model_name() -> str | None:
    try:
        enabled_model = get_runtime_db_store().get_any_enabled_model()
    except Exception:
        return None
    return enabled_model.name if enabled_model is not None else None


def run_index_debug(
    *,
    source_paths: list[Path],
    output_root: Path,
    model_name: str | None = None,
) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=True)
    summaries: list[dict[str, Any]] = []
    resolved_model_name = model_name or _resolve_default_model_name()

    for source_path in source_paths:
        file_kind = _file_kind_for(source_path)
        markdown_path = _detect_markdown_companion(source_path)
        preview_path = source_path if file_kind in {"pdf", "doc", "docx"} else None
        started_at = time.perf_counter()
        observer = _ConsoleObserver(display_name=source_path.name)
        print(
            f"[knowledge-index-debug][{source_path.name}]"
            f" starting file_kind={file_kind} model={resolved_model_name}",
            flush=True,
        )
        indexed_document = build_document_index(
            source_path=source_path,
            file_kind=file_kind,
            display_name=source_path.name,
            markdown_path=markdown_path,
            preview_path=preview_path,
            model_name=resolved_model_name,
            observer=observer,
        )
        elapsed_seconds = round(time.perf_counter() - started_at, 3)
        payload = indexed_document.model_dump(mode="json")
        nodes = payload.get("nodes") or []

        document_dir = output_root / _sanitize_name(source_path.stem)
        document_dir.mkdir(parents=True, exist_ok=True)
        output_json = document_dir / "document_index.json"
        output_json.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        summary = {
            "display_name": source_path.name,
            "source_path": str(source_path),
            "file_kind": file_kind,
            "size_bytes": source_path.stat().st_size,
            "elapsed_seconds": elapsed_seconds,
            "page_count": payload.get("page_count"),
            "node_count": len(nodes),
            "locator_type": payload.get("locator_type"),
            "doc_description": payload.get("doc_description"),
            "nodes_with_summary": sum(1 for node in nodes if node.get("summary")),
            "nodes_with_prefix_summary": sum(1 for node in nodes if node.get("prefix_summary")),
            "nodes_with_text": sum(1 for node in nodes if node.get("node_text")),
            "output_json": str(output_json),
            "top_level_titles": _root_titles(payload.get("structure") or []),
            "tail_page_titles": _tail_page_titles(nodes),
            "interesting_titles": _interesting_titles(nodes),
            "sample_summaries": _sample_summaries(nodes),
        }
        summaries.append(summary)

        print(flush=True)
        print(f"[knowledge-index-debug] {source_path.name}", flush=True)
        print(f"  source_path: {source_path}", flush=True)
        print(f"  size_bytes: {summary['size_bytes']}", flush=True)
        print(f"  elapsed_seconds: {elapsed_seconds}", flush=True)
        print(f"  page_count: {summary['page_count']}", flush=True)
        print(f"  node_count: {summary['node_count']}", flush=True)
        print(f"  locator_type: {summary['locator_type']}", flush=True)
        print(f"  model_name: {resolved_model_name}", flush=True)
        print(f"  nodes_with_summary: {summary['nodes_with_summary']}", flush=True)
        print(f"  nodes_with_prefix_summary: {summary['nodes_with_prefix_summary']}", flush=True)
        print(f"  nodes_with_text: {summary['nodes_with_text']}", flush=True)
        print(f"  output_json: {output_json}", flush=True)
        print("  top_level_titles:", flush=True)
        for title in summary["top_level_titles"][:8]:
            print(f"    - {title}", flush=True)
        if summary["sample_summaries"]:
            print("  sample_summaries:", flush=True)
            for item in summary["sample_summaries"][:5]:
                print(f"    - {item}", flush=True)
        if summary["interesting_titles"]:
            print("  interesting_titles:", flush=True)
            for title in summary["interesting_titles"][:10]:
                print(f"    - {title}", flush=True)

    manifest = {
        "output_root": str(output_root),
        "model_name": resolved_model_name,
        "documents": summaries,
    }
    manifest_path = output_root / "summary.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(flush=True)
    print(f"[knowledge-index-debug] summary_json: {manifest_path}", flush=True)
    return manifest


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build debug knowledge indexes for the largest fixture files.")
    parser.add_argument(
        "paths",
        nargs="*",
        help="Optional explicit files to index. When omitted, the largest supported files under ../PageIndex/tests/pdfs are used.",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=2,
        help="Number of largest files to index when explicit paths are not provided.",
    )
    parser.add_argument(
        "--fixtures-dir",
        default=str(_default_fixtures_dir()),
        help="Directory scanned for default source files.",
    )
    parser.add_argument(
        "--output-root",
        default="",
        help="Optional output root. Defaults to .openagents/knowledge-debug/<timestamp>/",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("OPENAGENTS_KNOWLEDGE_DEBUG_MODEL", "").strip(),
        help="Optional model name for LLM-assisted description and heading-page matching.",
    )
    return parser.parse_args(argv)


def _resolve_source_paths(args: argparse.Namespace) -> list[Path]:
    if args.paths:
        return [Path(path).expanduser().resolve() for path in args.paths]

    fixtures_dir = Path(args.fixtures_dir).expanduser().resolve()
    if not fixtures_dir.is_dir():
        raise FileNotFoundError(f"Fixtures directory not found: {fixtures_dir}")

    candidates = _candidate_documents(fixtures_dir)
    if not candidates:
        raise FileNotFoundError(f"No supported fixture files found under: {fixtures_dir}")
    return candidates[: max(1, args.top)]


def _resolve_output_root(args: argparse.Namespace) -> Path:
    if args.output_root:
        return Path(args.output_root).expanduser().resolve()
    return _default_output_root() / _timestamp_label()


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    source_paths = _resolve_source_paths(args)
    output_root = _resolve_output_root(args)
    run_index_debug(
        source_paths=source_paths,
        output_root=output_root,
        model_name=args.model or None,
    )
    return 0


@pytest.mark.skipif(
    os.getenv("OPENAGENTS_RUN_INDEX_DEBUG") != "1",
    reason="Set OPENAGENTS_RUN_INDEX_DEBUG=1 to run the heavy manual index debug test.",
)
def test_build_index_for_two_largest_pageindex_files() -> None:
    source_paths = _candidate_documents(_default_fixtures_dir())[:2]
    output_root = _default_output_root() / f"pytest-{_timestamp_label()}"
    manifest = run_index_debug(
        source_paths=source_paths,
        output_root=output_root,
        model_name=os.getenv("OPENAGENTS_KNOWLEDGE_DEBUG_MODEL", "").strip() or None,
    )

    assert len(manifest["documents"]) == 2
    for document in manifest["documents"]:
        assert document["node_count"] > 0
        assert Path(document["output_json"]).is_file()


if __name__ == "__main__":
    raise SystemExit(main())
