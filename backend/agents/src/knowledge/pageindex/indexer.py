from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
import re
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pymupdf

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate

from src.knowledge.models import (
    CanonicalSourceMapEntry,
    DocumentDescriptionOutput,
    DocumentTreeNode,
    HeadingPagePrediction,
    IndexedDocument,
    KnowledgeEvidenceRef,
    NodeSummaryOutput,
)
from src.knowledge.pageindex.canonical import CanonicalPage, build_canonical_document
from src.config.runtime_db import get_runtime_db_store
from src.models import create_chat_model

logger = logging.getLogger(__name__)
_NORMALIZE_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff]+")
_MARKDOWN_HEADER_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_CODE_FENCE_RE = re.compile(r"^```")
_MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_PAGE_IMAGE_NAME_RE = re.compile(r"img-p(?P<page>\d{4})-(?P<index>\d{2,})\.", re.IGNORECASE)
_SUMMARY_COPY_WORD_THRESHOLD = 90
_SUMMARY_INPUT_CHAR_LIMIT = 7000
_SUMMARY_OUTPUT_CHAR_LIMIT = 800
_PARENT_CHILDREN_CONTEXT_LIMIT = 12
_SUMMARY_CONCURRENCY = 6
_SUMMARY_MAX_IMAGES = 4
_MAX_LEAF_PAGE_SPAN = 10
_MAX_LEAF_TEXT_CHARS = 12000
_LEAF_CHILD_WINDOW_SIZE = 5

_LEAF_SUMMARY_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You summarize one document section for tree-based retrieval. "
            "Return structured output. "
            "`summary` must be a dense factual retrieval summary with distinctive topics, methods, entities, formulas, and unusual terms. "
            "`visual_summary` must capture visually grounded facts only when figures, diagrams, layouts, tables, or embedded images materially help retrieval; otherwise leave it empty. "
            "`distinctive_terms` should contain short keywords or phrases worth searching for. "
            "Keep `summary` under 800 characters and `visual_summary` under 320 characters. "
            "Do not mention page numbers. Do not add filler.",
        ),
        (
            "human",
            "Section title: {title}\n"
            "Locator: {locator}\n\n"
            "Section text:\n{text}",
        ),
    ]
)

_PARENT_SUMMARY_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You write a high-level branch summary for a document tree node. "
            "The goal is to help an agent decide whether to expand this branch. "
            "Return structured output. "
            "`summary` should summarize the scope of the branch, highlight the main subtopics, and preserve distinctive terminology from descendants. "
            "`visual_summary` should mention recurring visual material only when it materially helps a retriever decide to expand this branch. "
            "`distinctive_terms` should contain short keywords or phrases worth searching for. "
            "Keep `summary` under 700 characters and `visual_summary` under 280 characters. "
            "Do not mention page numbers. Keep it concise and information-dense.",
        ),
        (
            "human",
            "Branch title: {title}\n"
            "Locator: {locator}\n\n"
            "Branch context:\n{context}",
        ),
    ]
)

_DOCUMENT_DESCRIPTION_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Write one sentence that helps an agent decide whether a document is relevant. "
            "Mention the document's core subject matter and distinctive scope. "
            "Also return short keywords that describe the document's distinctive coverage.",
        ),
        (
            "human",
            "Document name: {display_name}\n"
            "Document type: {file_kind}\n\n"
            "Top-level structure:\n{structure}",
        ),
    ]
)

_HEADING_PAGE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You locate section headings in document pages. Only return a page number when the heading clearly starts on that page.",
        ),
        (
            "human",
            "Heading:\n{heading}\n\nPages:\n{pages}",
        ),
    ]
)


@dataclass
class _ParsedNode:
    title: str
    depth: int
    line_start: int | None
    line_end: int | None
    text: str
    node_id: str
    parent_node_id: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    heading_slug: str | None = None
    summary: str | None = None
    visual_summary: str | None = None
    summary_quality: str = "fallback"
    evidence_refs: list[KnowledgeEvidenceRef] = field(default_factory=list)
    prefix_summary: str | None = None
    image_paths: list[Path] = field(default_factory=list)
    children: list["_ParsedNode"] = field(default_factory=list)


@dataclass
class _PdfPage:
    page_number: int
    text: str
    normalized_text: str
    markdown_text: str = ""
    image_paths: list[Path] = field(default_factory=list)


@dataclass
class _ModelBundle:
    summary_model: Any | None = None
    description_model: Any | None = None
    heading_page_model: Any | None = None
    summary_supports_vision: bool = False


@dataclass
class _StructuredInvokeResult:
    value: Any
    attempts: int


def _invoke_structured_with_retry(
    structured_model: Any,
    messages: list,
    *,
    attempts: int = 3,
) -> _StructuredInvokeResult:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return _StructuredInvokeResult(
                value=structured_model.invoke(messages),
                attempts=attempt,
            )
        except Exception as exc:  # pragma: no cover - network/provider variability
            last_error = exc
            logger.debug(
                "Knowledge structured output attempt %s/%s failed: %s",
                attempt,
                attempts,
                exc,
            )
    if last_error is not None:
        raise last_error
    raise RuntimeError("Structured output invocation failed without an exception.")


async def _ainvoke_structured_with_retry(
    structured_model: Any,
    messages: list,
    *,
    attempts: int = 3,
) -> _StructuredInvokeResult:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return _StructuredInvokeResult(
                value=await structured_model.ainvoke(messages),
                attempts=attempt,
            )
        except Exception as exc:  # pragma: no cover - network/provider variability
            last_error = exc
            logger.debug(
                "Knowledge async structured output attempt %s/%s failed: %s",
                attempt,
                attempts,
                exc,
            )
            if attempt < attempts:
                await asyncio.sleep(min(1.5, 0.4 * attempt))
    if last_error is not None:
        raise last_error
    raise RuntimeError("Async structured output invocation failed without an exception.")


def _model_bundle(model_name: str | None) -> _ModelBundle:
    if not model_name:
        return _ModelBundle()

    model_config = get_runtime_db_store().get_model(model_name)
    model = create_chat_model(name=model_name, thinking_enabled=False, temperature=0)
    return _ModelBundle(
        summary_model=model.with_structured_output(NodeSummaryOutput),
        description_model=model.with_structured_output(DocumentDescriptionOutput),
        heading_page_model=model.with_structured_output(HeadingPagePrediction),
        summary_supports_vision=bool(model_config and model_config.supports_vision),
    )


def build_document_index(
    *,
    source_path: Path,
    file_kind: str,
    display_name: str,
    markdown_path: Path | None = None,
    preview_path: Path | None = None,
    model_name: str | None = None,
    observer: Any | None = None,
) -> IndexedDocument:
    normalized_kind = file_kind.lower().strip()
    models = _model_bundle(model_name)
    _observer_stage(
        observer,
        stage="canonicalize",
        message=f"Building canonical markdown for {display_name}",
        progress_percent=5,
    )
    canonical = build_canonical_document(
        source_path=source_path,
        file_kind=normalized_kind,
        markdown_path=markdown_path,
        preview_path=preview_path,
    )
    _observer_event(
        observer,
        stage="canonicalize",
        step_name="canonical_markdown",
        status="completed",
        message=(
            "Used markdown companion"
            if canonical.used_markdown_companion
            else "Built canonical markdown from source content"
        ),
    )

    if normalized_kind == "markdown":
        return _build_markdown_index(
            canonical_markdown=canonical.markdown,
            file_name=source_path.name,
            display_name=display_name,
            file_kind=normalized_kind,
            models=models,
            observer=observer,
        )
    if normalized_kind in {"pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx"}:
        effective_pdf_path = preview_path or source_path
        if effective_pdf_path.suffix.lower() != ".pdf" and not preview_path:
            if not canonical.markdown.strip():
                raise ValueError(
                    f"Could not build canonical markdown for {display_name}. "
                    "Provide a markdown companion or install a document converter such as markitdown/soffice."
                )
            return _build_markdown_index(
                canonical_markdown=canonical.markdown,
                file_name=source_path.name,
                display_name=display_name,
                file_kind=normalized_kind,
                models=models,
                observer=observer,
            )
        return _build_page_index(
            source_path=source_path,
            pdf_path=effective_pdf_path,
            display_name=display_name,
            file_kind=normalized_kind,
            canonical_markdown=canonical.markdown,
            canonical_pages=canonical.pages,
            companion_markdown_path=markdown_path,
            preview_path=preview_path,
            models=models,
            observer=observer,
            page_count_hint=canonical.page_count,
        )
    raise ValueError(f"Unsupported knowledge document type: {file_kind}")


def _build_markdown_index(
    *,
    canonical_markdown: str,
    file_name: str,
    display_name: str,
    file_kind: str,
    models: _ModelBundle,
    observer: Any | None,
) -> IndexedDocument:
    _observer_stage(
        observer,
        stage="tree",
        message=f"Parsing markdown structure for {display_name}",
        progress_percent=20,
    )
    tree = _parse_markdown_tree(canonical_markdown)
    if not tree and canonical_markdown.strip():
        tree = _synthetic_markdown_root(
            canonical_markdown=canonical_markdown,
            display_name=display_name,
        )
    _observer_event(
        observer,
        stage="tree",
        step_name="parse_markdown_headings",
        status="completed",
        message=f"Parsed {len(_flatten_tree(tree))} nodes from canonical markdown",
    )
    _observer_stage(
        observer,
        stage="summaries",
        message=f"Generating node summaries for {display_name}",
        progress_percent=35,
    )
    _populate_tree_summaries(tree, models=models, observer=observer)
    _populate_markdown_evidence_refs(tree)
    nodes = _flatten_tree(tree)
    structure = _serialize_tree(tree, locator_type="heading")
    description = _generate_document_description(
        display_name=display_name,
        file_kind=file_kind,
        structure=structure,
        models=models,
        observer=observer,
    )
    return IndexedDocument(
        display_name=display_name,
        file_name=file_name,
        file_kind=file_kind,
        locator_type="heading",
        doc_description=description,
        structure=structure,
        nodes=[
            DocumentTreeNode(
                node_id=node.node_id,
                parent_node_id=node.parent_node_id,
                node_path=_node_path(node.node_id, node.parent_node_id, nodes),
                title=node.title,
                depth=node.depth,
                child_count=len(node.children),
                locator_type="heading",
                line_start=node.line_start,
                line_end=node.line_end,
                heading_slug=node.heading_slug or _slugify(node.title),
                summary=node.summary,
                visual_summary=node.visual_summary,
                summary_quality=node.summary_quality,
                evidence_refs=list(node.evidence_refs),
                prefix_summary=node.prefix_summary,
                node_text=node.text,
            )
            for node in nodes
        ],
        canonical_markdown=canonical_markdown,
        source_map=_source_map_from_nodes(nodes, locator_type="heading"),
        build_quality=_document_build_quality(nodes),
        quality_metadata=_document_quality_metadata(nodes),
    )


def _build_page_index(
    *,
    source_path: Path,
    pdf_path: Path,
    display_name: str,
    file_kind: str,
    canonical_markdown: str,
    canonical_pages: list[CanonicalPage],
    companion_markdown_path: Path | None,
    preview_path: Path | None,
    models: _ModelBundle,
    observer: Any | None,
    page_count_hint: int | None,
) -> IndexedDocument:
    pages = (
        _canonical_pages_to_pdf_pages(canonical_pages)
        if canonical_pages
        else (_load_pdf_pages(pdf_path) if pdf_path.is_file() else [])
    )
    effective_page_count = page_count_hint or (len(pages) if pages else None)
    _observer_stage(
        observer,
        stage="tree",
        message=f"Building tree structure for {display_name}",
        progress_percent=20,
    )
    outline_nodes = _build_outline_tree(pdf_path)
    mapped_markdown_nodes: list[_ParsedNode] = []
    if _should_use_markdown_page_tree(
        canonical_markdown=canonical_markdown,
        companion_markdown_path=companion_markdown_path,
    ):
        mapped_markdown_nodes = _build_markdown_page_tree(
            canonical_markdown=canonical_markdown,
            pages=pages,
            models=models,
            observer=observer,
        )
    else:
        _observer_event(
            observer,
            stage="tree",
            step_name="skip_markdown_page_tree",
            status="completed",
            message=(
                "Skipped markdown heading-to-page mapping because no real markdown companion was available"
            ),
        )

    if mapped_markdown_nodes:
        tree = mapped_markdown_nodes
    elif outline_nodes:
        tree = outline_nodes
    else:
        tree = _build_page_window_tree(pages)

    _apply_page_ranges(tree, len(pages))
    recovered_windows = 0
    if pages:
        recovered_windows = _insert_uncovered_page_windows(tree, pages)
        if recovered_windows > 0:
            _observer_event(
                observer,
                stage="tree",
                step_name="recover_uncovered_pages",
                status="completed",
                message=f"Recovered {recovered_windows} uncovered page window nodes",
                metadata={"recovered_windows": recovered_windows},
            )
    split_children = 0
    if pages:
        split_children = _split_large_page_leaf_nodes(tree, pages)
        if split_children > 0:
            _observer_event(
                observer,
                stage="tree",
                step_name="split_large_leaf_nodes",
                status="completed",
                message=f"Inserted {split_children} child windows for oversized leaf nodes",
                metadata={"inserted_child_windows": split_children},
            )
    if pages:
        _populate_page_node_text(tree, pages)
        _populate_page_evidence_refs(tree, pages)
    _observer_event(
        observer,
        stage="tree",
        step_name="build_document_tree",
        status="completed",
        message=f"Selected tree with {len(_flatten_tree(tree))} nodes",
    )
    _observer_stage(
        observer,
        stage="summaries",
        message=f"Generating node summaries for {display_name}",
        progress_percent=35,
    )
    _populate_tree_summaries(tree, models=models, observer=observer)
    nodes = _flatten_tree(tree)
    structure = _serialize_tree(tree, locator_type="page")
    description = _generate_document_description(
        display_name=display_name,
        file_kind=file_kind,
        structure=structure,
        models=models,
        observer=observer,
    )
    return IndexedDocument(
        display_name=display_name,
        file_name=source_path.name,
        file_kind=file_kind,
        locator_type="page",
        page_count=effective_page_count,
        doc_description=description,
        structure=structure,
        nodes=[
            DocumentTreeNode(
                node_id=node.node_id,
                parent_node_id=node.parent_node_id,
                node_path=_node_path(node.node_id, node.parent_node_id, nodes),
                title=node.title,
                depth=node.depth,
                child_count=len(node.children),
                locator_type="page",
                page_start=node.page_start,
                page_end=node.page_end,
                summary=node.summary,
                visual_summary=node.visual_summary,
                summary_quality=node.summary_quality,
                evidence_refs=list(node.evidence_refs),
                prefix_summary=node.prefix_summary,
                node_text=node.text,
            )
            for node in nodes
        ],
        canonical_markdown=canonical_markdown,
        source_map=_source_map_from_nodes(nodes, locator_type="page"),
        build_quality=_document_build_quality(nodes),
        quality_metadata=_document_quality_metadata(nodes),
    )


def _load_pdf_pages(pdf_path: Path) -> list[_PdfPage]:
    doc = pymupdf.open(pdf_path)
    pages: list[_PdfPage] = []
    try:
        for index, page in enumerate(doc, start=1):
            text = page.get_text("text")
            pages.append(
                _PdfPage(
                    page_number=index,
                    text=text,
                    normalized_text=_normalize_text(text),
                    markdown_text=text,
                )
            )
    finally:
        doc.close()
    return pages


def _canonical_pages_to_pdf_pages(canonical_pages: list[CanonicalPage]) -> list[_PdfPage]:
    return [
        _PdfPage(
            page_number=page.page_number,
            text=page.text,
            normalized_text=_normalize_text(page.text),
            markdown_text=page.markdown_text or page.text,
            image_paths=list(page.image_paths),
        )
        for page in canonical_pages
    ]


def _build_outline_tree(pdf_path: Path) -> list[_ParsedNode]:
    try:
        doc = pymupdf.open(pdf_path)
        toc = doc.get_toc(simple=True)
    except Exception:
        return []
    finally:
        try:
            doc.close()
        except Exception:
            pass

    entries = [
        (int(level), _clean_title(title), int(page))
        for level, title, page in toc
        if _clean_title(title) and int(page) >= 1
    ]
    if not entries:
        return []

    stack: list[_ParsedNode] = []
    roots: list[_ParsedNode] = []
    counter = 1
    for level, title, page in entries:
        node = _ParsedNode(
            title=title,
            depth=max(level - 1, 0),
            line_start=None,
            line_end=None,
            text="",
            node_id=f"{counter:04d}",
            page_start=page,
        )
        counter += 1
        while stack and stack[-1].depth >= node.depth:
            stack.pop()
        if stack:
            node.parent_node_id = stack[-1].node_id
            stack[-1].children.append(node)
        else:
            roots.append(node)
        stack.append(node)
    return roots


def _build_markdown_page_tree(
    *,
    canonical_markdown: str,
    pages: list[_PdfPage],
    models: _ModelBundle,
    observer: Any | None,
) -> list[_ParsedNode]:
    if not canonical_markdown.strip():
        return []
    tree = _parse_markdown_tree(canonical_markdown)
    if not tree:
        return []

    flat_nodes = _flatten_tree(tree)
    previous_page = 1
    matched_count = 0
    for node in flat_nodes:
        page_number = _find_heading_page(
            heading=node.title,
            pages=pages,
            start_page=previous_page,
            models=models,
            observer=observer,
        )
        if page_number is None:
            continue
        matched_count += 1
        previous_page = page_number
        node.page_start = page_number

    if matched_count == 0:
        return []
    if matched_count < max(2, len(flat_nodes) // 3):
        return []
    return tree


def _should_use_markdown_page_tree(
    *,
    canonical_markdown: str,
    companion_markdown_path: Path | None,
) -> bool:
    if not canonical_markdown.strip():
        return False
    if companion_markdown_path is None or not companion_markdown_path.is_file():
        return False
    return True


def _find_heading_page(
    *,
    heading: str,
    pages: list[_PdfPage],
    start_page: int,
    models: _ModelBundle,
    observer: Any | None,
) -> int | None:
    normalized_heading = _normalize_text(heading)
    if not normalized_heading:
        return None

    search_pages = [page for page in pages if page.page_number >= start_page]
    for page in search_pages:
        if normalized_heading in page.normalized_text:
            return page.page_number

    heading_tokens = [token for token in normalized_heading.split() if len(token) >= 3]
    if heading_tokens:
        for page in search_pages:
            matched_tokens = sum(token in page.normalized_text for token in heading_tokens[:5])
            if matched_tokens >= min(2, len(heading_tokens)):
                return page.page_number

    if models.heading_page_model is None or not search_pages:
        return None

    window = search_pages[:8]
    snippets = "\n\n".join(
        f"Page {page.page_number}:\n{page.text[:2000]}"
        for page in window
    )
    started_at = _loop_time_ms()
    try:
        result = _invoke_structured_with_retry(
            models.heading_page_model,
            _HEADING_PAGE_PROMPT.format_messages(
                heading=heading,
                pages=snippets,
            ),
        )
    except Exception as exc:
        _observer_event(
            observer,
            stage="tree",
            step_name="heading_locator_llm",
            status="error",
            message=f"Failed to map heading '{heading}' to a page",
            elapsed_ms=_elapsed_ms(started_at),
            metadata={"heading": heading, "error": str(exc)},
        )
        return None

    _observer_event(
        observer,
        stage="tree",
        step_name="heading_locator_llm",
        status="completed",
        message=(
            f"Mapped heading '{heading}' to page "
            f"{result.value.page_number if result.value.page_number is not None else 'unknown'}"
        ),
        elapsed_ms=_elapsed_ms(started_at),
        retry_count=max(result.attempts - 1, 0),
        metadata={"heading": heading, "matched": result.value.matched},
    )
    if result.value.matched and result.value.page_number is not None:
        return result.value.page_number
    return None


def _build_page_window_tree(pages: list[_PdfPage], window_size: int = 8) -> list[_ParsedNode]:
    roots: list[_ParsedNode] = []
    counter = 1
    for start in range(1, len(pages) + 1, window_size):
        end = min(start + window_size - 1, len(pages))
        sample_text = _page_text_for_range(pages, start, min(start, len(pages)))
        title = _first_heading_like_line(sample_text) or f"Pages {start}-{end}"
        roots.append(
            _ParsedNode(
                title=_clean_title(title),
                depth=0,
                line_start=None,
                line_end=None,
                text="",
                node_id=f"{counter:04d}",
                page_start=start,
                page_end=end,
            )
        )
        counter += 1
    return roots


def _first_heading_like_line(text: str) -> str | None:
    for line in text.splitlines():
        stripped = line.strip()
        if len(stripped) < 6:
            continue
        if stripped.isupper() and _is_reasonable_heading_candidate(stripped):
            return stripped[:120]
        if stripped[:1].isdigit() and _is_reasonable_heading_candidate(stripped):
            return stripped[:120]
        if stripped[:1].isalpha() and _is_reasonable_heading_candidate(stripped):
            return stripped[:120]
    return None


def _is_reasonable_heading_candidate(text: str) -> bool:
    compact = _clean_title(text)
    if len(compact) < 6 or len(compact) > 120:
        return False
    lowered = compact.casefold()
    if "http://" in lowered or "https://" in lowered or "www." in lowered:
        return False
    alpha_count = sum(char.isalpha() for char in compact)
    digit_count = sum(char.isdigit() for char in compact)
    if alpha_count < 4:
        return False
    if digit_count > alpha_count:
        return False
    if compact.count(" ") < 1:
        return False
    alpha_words = [word for word in compact.split() if any(char.isalpha() for char in word)]
    if not alpha_words:
        return False
    capitalized_words = sum(1 for word in alpha_words if word[:1].isupper())
    max_consecutive_lowercase_words = 0
    consecutive_lowercase_words = 0
    for word in alpha_words:
        if word[:1].islower():
            consecutive_lowercase_words += 1
            max_consecutive_lowercase_words = max(
                max_consecutive_lowercase_words,
                consecutive_lowercase_words,
            )
        else:
            consecutive_lowercase_words = 0
    if max_consecutive_lowercase_words >= 3:
        return False
    if compact.isupper():
        return True
    if compact[:1].islower():
        return False
    if compact[:1].isdigit():
        return capitalized_words >= 1 and (capitalized_words / len(alpha_words)) >= 0.5
    return (capitalized_words / len(alpha_words)) >= 0.6


def _apply_page_ranges(tree: list[_ParsedNode], max_page: int) -> None:
    flat_nodes = _flatten_tree(tree)
    flat_nodes.sort(key=lambda node: (node.page_start or max_page + 1, node.depth, node.node_id))
    for index, node in enumerate(flat_nodes):
        if node.page_start is None:
            continue
        next_start = None
        for candidate in flat_nodes[index + 1 :]:
            if candidate.page_start is None:
                continue
            next_start = candidate.page_start
            break
        if node.page_end is None:
            if next_start is None:
                node.page_end = max_page
            else:
                node.page_end = max(node.page_start, next_start - 1)


def _populate_page_node_text(tree: list[_ParsedNode], pages: list[_PdfPage]) -> None:
    for node in _flatten_tree(tree):
        node.text = _page_markdown_for_range(pages, node.page_start, node.page_end)
        node.image_paths = _page_image_paths_for_range(pages, node.page_start, node.page_end)


def _insert_uncovered_page_windows(tree: list[_ParsedNode], pages: list[_PdfPage]) -> int:
    if not tree or not pages:
        return 0

    covered_pages: set[int] = set()
    for node in _flatten_tree(tree):
        if node.page_start is None or node.page_end is None:
            continue
        covered_pages.update(range(node.page_start, node.page_end + 1))

    missing_ranges: list[tuple[int, int]] = []
    range_start: int | None = None
    max_page = len(pages)
    for page_number in range(1, max_page + 1):
        if page_number in covered_pages:
            if range_start is not None:
                missing_ranges.append((range_start, page_number - 1))
                range_start = None
            continue
        if range_start is None:
            range_start = page_number
    if range_start is not None:
        missing_ranges.append((range_start, max_page))

    if not missing_ranges:
        return 0

    flat_nodes = _flatten_tree(tree)
    next_id = max((int(node.node_id) for node in flat_nodes if str(node.node_id).isdigit()), default=0) + 1
    for start_page, end_page in missing_ranges:
        tree.append(
            _ParsedNode(
                title=_uncovered_page_window_title(
                    pages=pages,
                    start_page=start_page,
                    end_page=end_page,
                ),
                depth=0,
                line_start=None,
                line_end=None,
                text="",
                node_id=f"{next_id:04d}",
                page_start=start_page,
                page_end=end_page,
            )
        )
        next_id += 1

    tree.sort(key=lambda node: (node.page_start or max_page + 1, node.node_id))
    return len(missing_ranges)


def _uncovered_page_window_title(
    *,
    pages: list[_PdfPage],
    start_page: int,
    end_page: int,
) -> str:
    first_page_markdown = _page_markdown_for_range(pages, start_page, start_page)
    heading = _clean_title(_first_heading_like_line(first_page_markdown) or "")
    range_label = f"pp.{start_page}-{end_page}" if start_page != end_page else f"p.{start_page}"
    if heading:
        return f"{heading} ({range_label})"
    if start_page == 1:
        return f"Front Matter ({range_label})"
    if start_page == end_page:
        return f"Page {start_page}"
    return f"Pages {start_page}-{end_page}"


def _parse_markdown_tree(markdown_content: str) -> list[_ParsedNode]:
    lines = markdown_content.splitlines()
    headers: list[tuple[int, str, int]] = []
    in_code_block = False
    for line_number, line in enumerate(lines, start=1):
        stripped = line.strip()
        if _CODE_FENCE_RE.match(stripped):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        matched = _MARKDOWN_HEADER_RE.match(stripped)
        if matched:
            title = _clean_title(matched.group(2))
            if title:
                headers.append((len(matched.group(1)), title, line_number))

    parsed_nodes: list[_ParsedNode] = []
    for index, (depth, title, line_start) in enumerate(headers, start=1):
        line_end = headers[index][2] - 1 if index < len(headers) else len(lines)
        text = "\n".join(lines[line_start - 1 : line_end]).strip()
        parsed_nodes.append(
            _ParsedNode(
                title=title,
                depth=depth - 1,
                line_start=line_start,
                line_end=line_end,
                text=text,
                node_id=f"{index:04d}",
                heading_slug=_slugify(title),
            )
        )

    stack: list[_ParsedNode] = []
    roots: list[_ParsedNode] = []
    for node in parsed_nodes:
        while stack and stack[-1].depth >= node.depth:
            stack.pop()
        if stack:
            node.parent_node_id = stack[-1].node_id
            stack[-1].children.append(node)
        else:
            roots.append(node)
        stack.append(node)
    return roots


def _synthetic_markdown_root(
    *,
    canonical_markdown: str,
    display_name: str,
) -> list[_ParsedNode]:
    lines = canonical_markdown.splitlines()
    title = next(
        (
            _clean_title(line)
            for line in lines
            if _clean_title(line)
        ),
        display_name,
    )
    return [
        _ParsedNode(
            title=title,
            depth=0,
            line_start=1,
            line_end=len(lines) or 1,
            text=canonical_markdown.strip(),
            node_id="0001",
            heading_slug=_slugify(title),
        )
    ]


def _populate_tree_summaries(
    tree: list[_ParsedNode],
    *,
    models: _ModelBundle,
    observer: Any | None,
) -> None:
    if not tree:
        return
    if models.summary_model is None:
        for node in _flatten_tree(tree):
            if node.children:
                node.summary = _fallback_parent_summary(node)
                node.visual_summary = _fallback_visual_summary(node)
                node.summary_quality = "fallback"
            else:
                node.summary = _fallback_leaf_summary(node.text)
                node.visual_summary = _fallback_visual_summary(node)
                node.summary_quality = "fallback"
        return
    asyncio.run(
        _populate_tree_summaries_async(
            tree,
            summary_model=models.summary_model,
            summary_supports_vision=models.summary_supports_vision,
            observer=observer,
        )
    )


async def _populate_tree_summaries_async(
    tree: list[_ParsedNode],
    *,
    summary_model: Any,
    summary_supports_vision: bool,
    observer: Any | None,
) -> None:
    semaphore = asyncio.Semaphore(_SUMMARY_CONCURRENCY)
    all_nodes = _flatten_tree(tree)
    total_summary_nodes = len(all_nodes)
    completed_nodes = 0
    progress_lock = asyncio.Lock()

    async def summarize_subtree(node: _ParsedNode) -> None:
        nonlocal completed_nodes
        if node.children:
            await asyncio.gather(*(summarize_subtree(child) for child in node.children))
            context = _parent_summary_context(node)
            if not context:
                node.summary = _fallback_parent_summary(node)
                node.visual_summary = _fallback_visual_summary(node)
                node.summary_quality = "fallback"
                async with progress_lock:
                    completed_nodes += 1
                    _observer_progress_from_summary(
                        observer,
                        completed_nodes=completed_nodes,
                        total_nodes=total_summary_nodes,
                    )
                return
            started_at = _loop_time_ms()
            try:
                async with semaphore:
                    started_at = _loop_time_ms()
                    result = await _ainvoke_structured_with_retry(
                        summary_model,
                        _PARENT_SUMMARY_PROMPT.format_messages(
                            title=node.title,
                            locator=_locator_text(node),
                            context=context,
                        ),
                    )
                node.summary = _clean_summary_text(result.value.summary)
                node.visual_summary = _clean_summary_text(result.value.visual_summary)
                node.summary_quality = "llm"
                _observer_event(
                    observer,
                    stage="summaries",
                    step_name="branch_summary",
                    status="completed",
                    message=f"Generated branch summary for '{node.title}'",
                    elapsed_ms=_elapsed_ms(started_at),
                    retry_count=max(result.attempts - 1, 0),
                    metadata={"node_id": node.node_id, "title": node.title},
                )
            except Exception as exc:
                logger.debug("Failed to summarize parent node %s", node.node_id, exc_info=True)
                node.summary = _fallback_parent_summary(node)
                node.visual_summary = _fallback_visual_summary(node)
                node.summary_quality = "fallback"
                _observer_event(
                    observer,
                    stage="summaries",
                    step_name="branch_summary",
                    status="error",
                    message=f"Fell back to heuristic branch summary for '{node.title}'",
                    elapsed_ms=_elapsed_ms(started_at),
                    metadata={"node_id": node.node_id, "title": node.title, "error": str(exc)},
                )
            async with progress_lock:
                completed_nodes += 1
                _observer_progress_from_summary(
                    observer,
                    completed_nodes=completed_nodes,
                    total_nodes=total_summary_nodes,
                )
            return

        if _word_count(node.text) <= _SUMMARY_COPY_WORD_THRESHOLD and not _node_has_images(node):
            node.summary = _clean_summary_text(node.text)
            node.visual_summary = None
            node.summary_quality = "extractive"
            _observer_event(
                observer,
                stage="summaries",
                step_name="leaf_summary_shortcut",
                status="completed",
                message=f"Used raw text as summary for short node '{node.title}'",
                metadata={"node_id": node.node_id, "title": node.title},
            )
            async with progress_lock:
                completed_nodes += 1
                _observer_progress_from_summary(
                    observer,
                    completed_nodes=completed_nodes,
                    total_nodes=total_summary_nodes,
                )
            return

        started_at = _loop_time_ms()
        try:
            messages = _leaf_summary_messages(
                node,
                summary_supports_vision=summary_supports_vision,
            )
            async with semaphore:
                started_at = _loop_time_ms()
                result = await _ainvoke_structured_with_retry(
                    summary_model,
                    messages,
                )
            node.summary = _clean_summary_text(result.value.summary)
            node.visual_summary = _clean_summary_text(result.value.visual_summary)
            node.summary_quality = "llm"
            _observer_event(
                observer,
                stage="summaries",
                step_name="leaf_summary_vision" if _node_has_images(node) and summary_supports_vision else "leaf_summary",
                status="completed",
                message=f"Generated leaf summary for '{node.title}'",
                elapsed_ms=_elapsed_ms(started_at),
                retry_count=max(result.attempts - 1, 0),
                metadata={"node_id": node.node_id, "title": node.title},
            )
        except Exception as exc:
            logger.debug("Failed to summarize leaf node %s", node.node_id, exc_info=True)
            node.summary = _fallback_leaf_summary(node.text)
            node.visual_summary = _fallback_visual_summary(node)
            node.summary_quality = "fallback"
            _observer_event(
                observer,
                stage="summaries",
                step_name="leaf_summary",
                status="error",
                message=f"Fell back to heuristic leaf summary for '{node.title}'",
                elapsed_ms=_elapsed_ms(started_at),
                metadata={"node_id": node.node_id, "title": node.title, "error": str(exc)},
            )
        async with progress_lock:
            completed_nodes += 1
            _observer_progress_from_summary(
                observer,
                completed_nodes=completed_nodes,
                total_nodes=total_summary_nodes,
            )

    await asyncio.gather(*(summarize_subtree(root) for root in tree))


def _generate_document_description(
    *,
    display_name: str,
    file_kind: str,
    structure: list[dict],
    models: _ModelBundle,
    observer: Any | None,
) -> str | None:
    titles = _collect_titles(structure)
    if not titles:
        return None

    if models.description_model is None:
        joined = ", ".join(titles[:6])
        return _excerpt_text(f"{display_name}: {joined}", limit=220)

    top_level_context = _document_description_context(structure)
    if not top_level_context:
        return None
    started_at = _loop_time_ms()
    try:
        result = _invoke_structured_with_retry(
            models.description_model,
            _DOCUMENT_DESCRIPTION_PROMPT.format_messages(
                display_name=display_name,
                file_kind=file_kind,
                structure=top_level_context,
            ),
        )
    except Exception:
        logger.debug("Failed to generate document description for %s", display_name, exc_info=True)
        joined = ", ".join(titles[:6])
        return _excerpt_text(f"{display_name}: {joined}", limit=220)
    _observer_event(
        observer,
        stage="description",
        step_name="document_description",
        status="completed",
        message=f"Generated document description for '{display_name}'",
        elapsed_ms=_elapsed_ms(started_at),
        retry_count=max(result.attempts - 1, 0),
    )
    _observer_stage(
        observer,
        stage="description",
        message=f"Document description ready for {display_name}",
        progress_percent=95,
    )
    return _clean_summary_text(result.value.description, limit=280)


def _document_description_context(structure: list[dict]) -> str:
    lines: list[str] = []
    for item in structure[:10]:
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        summary = str(item.get("summary") or item.get("prefix_summary") or "").strip()
        visual_summary = str(item.get("visual_summary") or "").strip()
        if summary and visual_summary:
            lines.append(f"- {title}: {summary} Visual: {visual_summary}")
        elif summary:
            lines.append(f"- {title}: {summary}")
        elif visual_summary:
            lines.append(f"- {title}: Visual: {visual_summary}")
        else:
            lines.append(f"- {title}")
    return "\n".join(lines)


def _parent_summary_context(node: _ParsedNode) -> str:
    lines: list[str] = []
    own_text = _clean_summary_text(_trim_text_for_summary(node.text, limit=3000), limit=1000)
    if own_text:
        lines.append(f"Node text:\n{own_text}")

    child_lines: list[str] = []
    for child in node.children[:_PARENT_CHILDREN_CONTEXT_LIMIT]:
        child_summary = child.summary or child.prefix_summary or _excerpt_text(child.text, limit=220)
        if child.visual_summary:
            child_summary = (
                f"{child_summary} Visual: {child.visual_summary}"
                if child_summary
                else f"Visual: {child.visual_summary}"
            )
        locator = _locator_text(child)
        if child_summary:
            child_lines.append(f"- {child.title} ({locator}): {child_summary}")
        else:
            child_lines.append(f"- {child.title} ({locator})")
    if child_lines:
        lines.append("Children:\n" + "\n".join(child_lines))

    return "\n\n".join(part for part in lines if part.strip())


def _fallback_leaf_summary(text: str) -> str:
    return _clean_summary_text(_trim_text_for_summary(text, limit=1200), limit=320)


def _fallback_parent_summary(node: _ParsedNode) -> str:
    child_titles = [child.title for child in node.children[:5] if child.title]
    if not child_titles:
        return _fallback_leaf_summary(node.text)
    return _clean_summary_text(
        f"Covers {', '.join(child_titles)}.",
        limit=320,
    )


def _fallback_visual_summary(node: _ParsedNode) -> str | None:
    if not _node_has_images(node):
        return None

    caption_like_lines = _extract_visual_caption_lines(node.text)
    if caption_like_lines:
        return _clean_summary_text(" ".join(caption_like_lines), limit=320)

    if node.page_start is not None and node.page_end is not None:
        if node.page_start == node.page_end:
            return f"Contains visual material on page {node.page_start}."
        return f"Contains visual material across pages {node.page_start}-{node.page_end}."

    return "Contains visual material relevant to this section."


def _clean_summary_text(text: str | None, *, limit: int = _SUMMARY_OUTPUT_CHAR_LIMIT) -> str | None:
    if text is None:
        return None
    compact = " ".join(str(text).split())
    if not compact:
        return None
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def _trim_text_for_summary(text: str, *, limit: int = _SUMMARY_INPUT_CHAR_LIMIT) -> str:
    compact = text.strip()
    if len(compact) <= limit:
        return compact
    head = compact[: limit // 2]
    tail = compact[-(limit // 2) :]
    return f"{head}\n...\n{tail}"


def _word_count(text: str) -> int:
    return len(text.split())


def _locator_text(node: _ParsedNode) -> str:
    if node.page_start is not None and node.page_end is not None:
        if node.page_start == node.page_end:
            return f"page {node.page_start}"
        return f"pages {node.page_start}-{node.page_end}"
    if node.line_start is not None and node.line_end is not None:
        if node.line_start == node.line_end:
            return f"line {node.line_start}"
        return f"lines {node.line_start}-{node.line_end}"
    return "unknown locator"


def _flatten_tree(tree: Iterable[_ParsedNode]) -> list[_ParsedNode]:
    flattened: list[_ParsedNode] = []
    for node in tree:
        flattened.append(node)
        flattened.extend(_flatten_tree(node.children))
    return flattened


def _serialize_tree(tree: list[_ParsedNode], *, locator_type: str) -> list[dict]:
    result: list[dict] = []
    for node in tree:
        payload: dict[str, Any] = {
            "title": node.title,
            "node_id": node.node_id,
            "locator_type": locator_type,
            "summary_quality": node.summary_quality,
        }
        if node.page_start is not None:
            payload["page_start"] = node.page_start
        if node.page_end is not None:
            payload["page_end"] = node.page_end
        if node.line_start is not None:
            payload["line_start"] = node.line_start
        if node.line_end is not None:
            payload["line_end"] = node.line_end
        if node.heading_slug:
            payload["heading_slug"] = node.heading_slug
        if node.summary:
            payload["summary"] = node.summary
        if node.visual_summary:
            payload["visual_summary"] = node.visual_summary
        if node.evidence_refs:
            payload["has_visual_evidence"] = any(
                ref.kind in {"image", "page_image"} for ref in node.evidence_refs
            )
            payload["evidence_ref_count"] = len(node.evidence_refs)
        if node.children:
            payload["nodes"] = _serialize_tree(node.children, locator_type=locator_type)
        result.append(payload)
    return result


def _collect_titles(structure: list[dict]) -> list[str]:
    titles: list[str] = []
    for item in structure:
        title = str(item.get("title") or "").strip()
        if title:
            titles.append(title)
        children = item.get("nodes")
        if isinstance(children, list):
            titles.extend(_collect_titles(children))
    return titles


def _page_text_for_range(pages: list[_PdfPage], start_page: int | None, end_page: int | None) -> str:
    if start_page is None or end_page is None:
        return ""
    selected = [page.text for page in pages if start_page <= page.page_number <= end_page]
    return "\n".join(selected).strip()


def _page_markdown_for_range(
    pages: list[_PdfPage],
    start_page: int | None,
    end_page: int | None,
) -> str:
    if start_page is None or end_page is None:
        return ""
    selected = [
        page.markdown_text.strip()
        for page in pages
        if start_page <= page.page_number <= end_page and page.markdown_text.strip()
    ]
    return "\n\n".join(selected).strip()


def _page_image_paths_for_range(
    pages: list[_PdfPage],
    start_page: int | None,
    end_page: int | None,
) -> list[Path]:
    if start_page is None or end_page is None:
        return []
    image_paths: list[Path] = []
    for page in pages:
        if not (start_page <= page.page_number <= end_page):
            continue
        image_paths.extend(page.image_paths)
    return image_paths


def _split_large_page_leaf_nodes(tree: list[_ParsedNode], pages: list[_PdfPage]) -> int:
    flat_nodes = _flatten_tree(tree)
    if not flat_nodes:
        return 0

    next_id = max((int(node.node_id) for node in flat_nodes if str(node.node_id).isdigit()), default=0) + 1
    inserted_children = 0

    for node in flat_nodes:
        if node.children:
            continue
        if node.page_start is None or node.page_end is None:
            continue

        page_span = node.page_end - node.page_start + 1
        page_text = _page_markdown_for_range(pages, node.page_start, node.page_end)
        if page_span <= _MAX_LEAF_PAGE_SPAN and len(page_text) <= _MAX_LEAF_TEXT_CHARS:
            continue

        children: list[_ParsedNode] = []
        for start_page in range(node.page_start, node.page_end + 1, _LEAF_CHILD_WINDOW_SIZE):
            end_page = min(start_page + _LEAF_CHILD_WINDOW_SIZE - 1, node.page_end)
            children.append(
                _ParsedNode(
                    title=_page_window_child_title(
                        parent_title=node.title,
                        pages=pages,
                        start_page=start_page,
                        end_page=end_page,
                    ),
                    depth=node.depth + 1,
                    line_start=None,
                    line_end=None,
                    text="",
                    node_id=f"{next_id:04d}",
                    parent_node_id=node.node_id,
                    page_start=start_page,
                    page_end=end_page,
                )
            )
            next_id += 1

        if len(children) < 2:
            continue

        node.children = children
        inserted_children += len(children)

    return inserted_children


def _page_window_child_title(
    *,
    parent_title: str,
    pages: list[_PdfPage],
    start_page: int,
    end_page: int,
) -> str:
    first_page_markdown = _page_markdown_for_range(pages, start_page, start_page)
    heading = _clean_title(_first_heading_like_line(first_page_markdown) or "")
    range_label = f"pp.{start_page}-{end_page}" if start_page != end_page else f"p.{start_page}"
    parent_compact = _clean_title(parent_title)
    if heading and heading.casefold() != parent_compact.casefold():
        return f"{heading} ({range_label})"
    return f"{parent_compact or 'Section'} ({range_label})"


def _populate_markdown_evidence_refs(tree: list[_ParsedNode]) -> None:
    for node in _flatten_tree(tree):
        refs: list[KnowledgeEvidenceRef] = []
        for index, match in enumerate(_MARKDOWN_IMAGE_RE.finditer(node.text or ""), start=1):
            raw_target = match.group(2).strip()
            if not raw_target or raw_target.startswith(("http://", "https://", "data:", "kb://", "/mnt/user-data/")):
                continue
            refs.append(
                KnowledgeEvidenceRef(
                    evidence_id=f"{node.node_id}-img-{index:02d}",
                    kind="image",
                    locator_type="heading",
                    line_number=node.line_start,
                    heading_slug=node.heading_slug,
                    alt_text=(match.group(1) or "").strip() or None,
                    caption_text=_caption_near_image(node.text, match.start()),
                    asset_rel_path=raw_target,
                )
            )
        node.evidence_refs = refs


def _populate_page_evidence_refs(tree: list[_ParsedNode], pages: list[_PdfPage]) -> None:
    page_map = {page.page_number: page for page in pages}
    for node in _flatten_tree(tree):
        if node.page_start is None or node.page_end is None:
            node.evidence_refs = []
            continue
        refs: list[KnowledgeEvidenceRef] = []
        for page_number in range(node.page_start, node.page_end + 1):
            page = page_map.get(page_number)
            if page is None or not page.image_paths:
                continue
            refs.append(
                KnowledgeEvidenceRef(
                    evidence_id=f"{node.node_id}-page-{page_number:04d}",
                    kind="page_image",
                    locator_type="page",
                    page_number=page_number,
                    caption_text=_caption_from_page_text(page.markdown_text or page.text),
                )
            )
        node.evidence_refs = refs


def _excerpt_text(text: str, limit: int = 240) -> str | None:
    compact = " ".join(text.split())
    if not compact:
        return None
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def _node_has_images(node: _ParsedNode) -> bool:
    return bool(node.image_paths or _extract_markdown_image_paths(node.text))


def _leaf_summary_messages(
    node: _ParsedNode,
    *,
    summary_supports_vision: bool,
) -> list:
    if not summary_supports_vision or not _node_has_images(node):
        return _LEAF_SUMMARY_PROMPT.format_messages(
            title=node.title,
            locator=_locator_text(node),
            text=_trim_text_for_summary(node.text),
        )

    content_blocks: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"Section title: {node.title}\n"
                f"Locator: {_locator_text(node)}\n\n"
                "Section markdown:\n"
                f"{_trim_text_for_summary(node.text)}\n\n"
                "The section includes referenced images. Inspect them and include only factual, visually grounded details that improve retrieval."
            ),
        }
    ]
    for image_path in node.image_paths[:_SUMMARY_MAX_IMAGES]:
        data_url = _image_data_url(image_path)
        if not data_url:
            continue
        content_blocks.append({"type": "text", "text": f"Referenced image: {image_path.name}"})
        content_blocks.append({"type": "image_url", "image_url": {"url": data_url}})
    return [
        SystemMessage(
            content=(
                "You summarize one document section for tree-based retrieval. "
                "Return structured output. "
                "`summary` must be a dense factual retrieval summary that includes distinctive topics, methods, entities, formulas, figure findings, and unusual terms. "
                "`visual_summary` must capture only the visually grounded details that materially help retrieval. "
                "`distinctive_terms` should contain short keywords or phrases worth searching for. "
                "Keep `summary` under 800 characters and `visual_summary` under 320 characters. "
                "Do not mention page numbers. Do not add filler."
            )
        ),
        HumanMessage(content=content_blocks),
    ]


def _image_data_url(image_path: Path) -> str | None:
    try:
        if not image_path.is_file():
            return None
        mime_type, _ = mimetypes.guess_type(str(image_path))
        resolved_mime = mime_type or "image/png"
        encoded = base64.b64encode(image_path.read_bytes()).decode("utf-8")
        return f"data:{resolved_mime};base64,{encoded}"
    except Exception:
        logger.debug("Failed to encode image for multimodal summary: %s", image_path, exc_info=True)
        return None


def _extract_markdown_image_paths(text: str) -> list[str]:
    return [match.group(2).strip() for match in _MARKDOWN_IMAGE_RE.finditer(text or "")]


def _extract_visual_caption_lines(text: str, *, limit: int = 3) -> list[str]:
    lines: list[str] = []
    for raw_line in (text or "").splitlines():
        compact = " ".join(raw_line.split())
        if not compact:
            continue
        lowered = compact.casefold()
        if lowered.startswith(("figure ", "fig.", "table ", "chart ", "diagram ", "image ")):
            lines.append(compact)
        elif "figure " in lowered or "diagram" in lowered or "chart" in lowered:
            lines.append(compact)
        if len(lines) >= limit:
            break
    return lines


def _caption_near_image(text: str, image_offset: int) -> str | None:
    if not text:
        return None
    prefix = text[:image_offset].splitlines()
    suffix = text[image_offset:].splitlines()
    nearby = prefix[-3:] + suffix[:3]
    candidates = _extract_visual_caption_lines("\n".join(nearby), limit=2)
    if not candidates:
        return None
    return _clean_summary_text(" ".join(candidates), limit=240)


def _caption_from_page_text(text: str) -> str | None:
    candidates = _extract_visual_caption_lines(text, limit=2)
    if not candidates:
        return None
    return _clean_summary_text(" ".join(candidates), limit=240)


def _document_build_quality(nodes: list[_ParsedNode]) -> str:
    if any(node.summary_quality == "fallback" for node in nodes):
        return "degraded"
    return "ready"


def _document_quality_metadata(nodes: list[_ParsedNode]) -> dict[str, Any]:
    total_nodes = len(nodes)
    llm_nodes = sum(1 for node in nodes if node.summary_quality == "llm")
    extractive_nodes = sum(1 for node in nodes if node.summary_quality == "extractive")
    fallback_nodes = sum(1 for node in nodes if node.summary_quality == "fallback")
    visual_nodes = sum(1 for node in nodes if node.visual_summary)
    evidence_ref_count = sum(len(node.evidence_refs) for node in nodes)
    return {
        "total_nodes": total_nodes,
        "llm_nodes": llm_nodes,
        "extractive_nodes": extractive_nodes,
        "fallback_nodes": fallback_nodes,
        "visual_nodes": visual_nodes,
        "evidence_ref_count": evidence_ref_count,
    }


def _normalize_text(text: str) -> str:
    lowered = text.lower()
    normalized = _NORMALIZE_RE.sub(" ", lowered)
    return " ".join(normalized.split())


def _clean_title(text: str | None) -> str:
    return " ".join(str(text or "").replace("\x00", " ").split())


def _slugify(text: str) -> str:
    normalized = _normalize_text(text)
    return normalized.replace(" ", "-").strip("-") or "section"


def _node_path(node_id: str, parent_node_id: str | None, nodes: list[_ParsedNode]) -> str:
    by_id = {node.node_id: node for node in nodes}
    parts = [node_id]
    current_parent = parent_node_id
    while current_parent:
        parts.append(current_parent)
        current_parent = by_id.get(current_parent).parent_node_id if by_id.get(current_parent) else None
    return "/".join(reversed(parts))


def _source_map_from_nodes(
    nodes: list[_ParsedNode],
    *,
    locator_type: str,
) -> list[CanonicalSourceMapEntry]:
    entries: list[CanonicalSourceMapEntry] = []
    for node in nodes:
        entries.append(
            CanonicalSourceMapEntry(
                node_id=node.node_id,
                locator_type="heading" if locator_type == "heading" else "page",
                page_start=node.page_start,
                page_end=node.page_end,
                line_start=node.line_start,
                line_end=node.line_end,
                heading_slug=node.heading_slug,
                marker=_locator_text(node),
            )
        )
    return entries


def _observer_stage(
    observer: Any | None,
    *,
    stage: str,
    message: str,
    progress_percent: int | None = None,
    total_steps: int | None = None,
    completed_steps: int | None = None,
) -> None:
    if observer is None:
        return
    callback = getattr(observer, "update_stage", None)
    if callable(callback):
        callback(
            stage=stage,
            message=message,
            progress_percent=progress_percent,
            total_steps=total_steps,
            completed_steps=completed_steps,
        )


def _observer_event(
    observer: Any | None,
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
    if observer is None:
        return
    callback = getattr(observer, "log_event", None)
    if callable(callback):
        callback(
            stage=stage,
            step_name=step_name,
            status=status,
            message=message,
            elapsed_ms=elapsed_ms,
            retry_count=retry_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            metadata=metadata or {},
        )


def _observer_progress_from_summary(
    observer: Any | None,
    *,
    completed_nodes: int,
    total_nodes: int,
) -> None:
    if total_nodes <= 0:
        return
    progress_percent = 35 + int((completed_nodes / total_nodes) * 55)
    _observer_stage(
        observer,
        stage="summaries",
        message=f"Generated summaries for {completed_nodes}/{total_nodes} nodes",
        progress_percent=min(progress_percent, 90),
        total_steps=total_nodes,
        completed_steps=completed_nodes,
    )


def _loop_time_ms() -> int:
    return int(time.perf_counter() * 1000)


def _elapsed_ms(started_at_ms: int) -> int:
    return max(0, _loop_time_ms() - started_at_ms)
