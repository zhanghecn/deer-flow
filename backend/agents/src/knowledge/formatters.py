from __future__ import annotations

import json
import re

from src.knowledge.models import (
    DocumentEvidenceResult,
    DocumentImageResult,
    DocumentTreeListing,
    KnowledgeDocumentRecord,
    NodeDetailResult,
)

_WHITESPACE_RE = re.compile(r"\s+")
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]+\)")
_TREE_SUMMARY_FLOOR = 28
_TREE_SUMMARY_CAP = 120
_TREE_SUMMARY_BUDGET = 5000
_INLINE_VISUAL_EVIDENCE_BUDGET = 6
_VISUAL_EVIDENCE_KINDS = frozenset({"image", "page_image"})


def _normalized_summary(*values: str | None) -> str | None:
    for value in values:
        text = _WHITESPACE_RE.sub(" ", str(value or "")).strip()
        if text:
            return text
    return None


def _drop_empty_fields(value):
    """Remove None/empty fields so KB tool payloads do not waste budget on filler."""

    if isinstance(value, dict):
        compact: dict = {}
        for key, item in value.items():
            if item is None:
                continue
            normalized = _drop_empty_fields(item)
            if normalized == [] or normalized == {}:
                continue
            compact[key] = normalized
        return compact
    if isinstance(value, list):
        return [_drop_empty_fields(item) for item in value]
    return value


def _tree_node_count(nodes: list[dict]) -> int:
    count = 0
    for item in nodes:
        count += 1
        children = item.get("nodes")
        if isinstance(children, list) and children:
            count += _tree_node_count(children)
    return count


def _tree_summary_limit(node_count: int) -> int:
    if node_count <= 0:
        return _TREE_SUMMARY_CAP
    return max(_TREE_SUMMARY_FLOOR, min(_TREE_SUMMARY_CAP, _TREE_SUMMARY_BUDGET // node_count))


def _compact_tree_summary(*, title: str, summary: str | None, limit: int) -> str | None:
    raw_summary = str(summary or "")
    stripped_summary = _HTML_COMMENT_RE.sub(" ", raw_summary)
    stripped_summary = _MARKDOWN_IMAGE_RE.sub(" ", stripped_summary)
    text = _normalized_summary(stripped_summary)
    if not text:
        return None
    had_markdown_heading = bool(re.match(r"^\s*#+\s*", raw_summary))
    text = re.sub(r"^\s*#+\s*", "", text, count=1)
    title_text = _WHITESPACE_RE.sub(" ", title).strip()
    if had_markdown_heading and title_text and text.startswith(title_text):
        text = text[len(title_text) :].lstrip(" :.-")
    if not text:
        return None
    if len(text) <= limit:
        return text
    clipped = text[: max(limit - 1, 0)].rstrip()
    return f"{clipped}…" if clipped else None


def _format_tree_nodes(
    nodes: list[dict],
    *,
    document_locator_type: str,
    summary_limit: int,
    depth: int = 0,
) -> list[dict]:
    formatted: list[dict] = []
    for item in nodes:
        payload = {
            "title": item.get("title"),
            "node_id": item.get("node_id"),
        }
        child_count = int(item.get("child_count") or 0)
        if child_count > 0:
            payload["child_count"] = child_count
        if bool(item.get("has_more_children")):
            payload["has_more_children"] = True
            remaining_child_count = int(item.get("remaining_child_count") or 0)
            if remaining_child_count > 0:
                payload["remaining_child_count"] = remaining_child_count
        if document_locator_type == "page":
            if item.get("page_start") is not None:
                payload["page_start"] = item.get("page_start")
            if item.get("page_end") is not None:
                payload["page_end"] = item.get("page_end")
        if item.get("has_visual_evidence") is not None:
            payload["has_visual_evidence"] = bool(item.get("has_visual_evidence"))
        if item.get("evidence_ref_count") is not None:
            payload["evidence_ref_count"] = int(item.get("evidence_ref_count") or 0)
        summary = _compact_tree_summary(
            title=str(item.get("title") or ""),
            summary=_normalized_summary(item.get("summary"), item.get("visual_summary"), item.get("prefix_summary")),
            limit=summary_limit,
        )
        if summary and (depth == 0 or summary_limit >= 60):
            payload["summary"] = summary
        children = item.get("nodes")
        if isinstance(children, list) and children:
            payload["nodes"] = _format_tree_nodes(
                children,
                document_locator_type=document_locator_type,
                summary_limit=summary_limit,
                depth=depth + 1,
            )
        formatted.append(payload)
    return formatted


def format_tree_listing_payload(listing: DocumentTreeListing) -> str:
    node_count = _tree_node_count(listing.tree)
    collapsed_root_overview = listing.window_mode == "root_overview"
    returned_root_start = None
    returned_root_end = None
    has_more_root_nodes = False
    if collapsed_root_overview and listing.total_root_nodes is not None:
        returned_root_start = listing.root_cursor + 1 if node_count > 0 else 0
        returned_root_end = listing.root_cursor + node_count
        has_more_root_nodes = (
            listing.next_root_cursor is not None
            or listing.previous_root_cursor is not None
        )
    recommended_evidence_node_ids = [
        str(item.get("node_id") or "").strip()
        for item in listing.tree
        if str(item.get("node_id") or "").strip()
    ][:8]
    payload = {
        "document": {
            "id": listing.document.id,
            "knowledge_base": listing.document.knowledge_base_name,
            "name": listing.document.display_name,
            "description": listing.document.doc_description,
            "file_kind": listing.document.file_kind,
            "locator_type": listing.document.locator_type,
            "build_quality": listing.document.build_quality,
            "node_id": listing.node_id,
            "max_depth": listing.effective_max_depth,
            "requested_max_depth": listing.requested_max_depth,
            "window_mode": listing.window_mode,
            "collapsed_root_overview": collapsed_root_overview,
            "returned_node_count": node_count,
            **(
                {
                    "root_cursor": listing.root_cursor,
                    "total_root_nodes": listing.total_root_nodes,
                    "returned_root_start": returned_root_start,
                    "returned_root_end": returned_root_end,
                    "previous_root_cursor": listing.previous_root_cursor,
                    "next_root_cursor": listing.next_root_cursor,
                    "has_more_root_nodes": has_more_root_nodes,
                }
                if collapsed_root_overview
                else {}
            ),
        },
        "answer_requires_evidence": True,
        "recommended_evidence_node_ids": recommended_evidence_node_ids,
        "tree": _format_tree_nodes(
            listing.tree,
            document_locator_type=listing.document.locator_type,
            summary_limit=_tree_summary_limit(node_count),
        ),
        "next_steps": {
            "summary": (
                f"Returned a tree window for {listing.document.display_name}. "
                "This tree result is for navigation only. Do not answer yet; retrieve grounded evidence first."
            ),
            "options": (
                [
                    "DO NOT answer from this tree result alone. Your next step should be another knowledge tool call, not visible prose.",
                    "This root call was collapsed to a top-level overview because expanding descendants would be too large. Pick the most relevant root node_id and call get_document_tree(document_name_or_id=..., node_id=...) to expand that branch.",
                    (
                        f"This overview is paginated across root nodes {returned_root_start}-{returned_root_end}. "
                        f"If the relevant branch is not in this slice, call get_document_tree(document_name_or_id=..., root_cursor={listing.next_root_cursor}) to inspect the next root window."
                        if listing.next_root_cursor is not None
                        else "This overview currently covers the available root-node slice."
                    ),
                    "For a cited overview answer, call get_document_evidence(document_name_or_id=..., node_ids=...) on the most relevant top-level node_ids from recommended_evidence_node_ids first.",
                    "If a branch has child_count>0 or has_more_children=true, call get_document_tree(document_name_or_id=..., node_id=...) to inspect that subtree.",
                    "Once you identify the relevant nodes, call get_document_evidence(document_name_or_id=..., node_ids=...) to read grounded evidence blocks.",
                ]
                if collapsed_root_overview
                else [
                    "DO NOT answer from this tree result alone. Your next step should be another knowledge tool call, not visible prose.",
                    "Tree windows are capped at max_depth=2. To go deeper, call get_document_tree(document_name_or_id=..., node_id=...) on the most relevant branch.",
                    "Before any visible answer, call get_document_evidence(document_name_or_id=..., node_ids=...) on the node_ids you plan to describe.",
                    "If a branch has has_more_children=true, call get_document_tree(document_name_or_id=..., node_id=...) to inspect that subtree.",
                    "Once you identify the relevant nodes, call get_document_evidence(document_name_or_id=..., node_ids=...) to read grounded evidence blocks.",
                ]
            ),
        },
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def format_node_detail_payload(result: NodeDetailResult) -> str:
    payload = {
        "document": {
            "document_id": result.document.id,
            "knowledge_base": result.document.knowledge_base_name,
            "document_name": result.document.display_name,
            "locator_type": result.document.locator_type,
            "total_pages": result.total_pages,
            "build_quality": result.document.build_quality,
        },
        "requested_node_ids": result.requested_node_ids,
        "requested_pages": result.requested_pages,
        "returned_pages": result.returned_pages,
        "returned_lines": result.returned_lines,
        "items": [
            {
                "node_id": item.node_id,
                "title": item.title,
                "citation_markdown": item.citation_markdown,
                "text": item.text,
                "image_paths": item.image_paths,
                "visual_summary": item.visual_summary,
                "summary_quality": item.summary_quality,
                "evidence_blocks": [
                    {
                        "evidence_id": block.evidence_id,
                        "kind": block.kind,
                        "locator_type": block.locator_type,
                        "locator_label": block.locator_label,
                        "page_number": block.page_number,
                        "line_number": block.line_number,
                        "heading_slug": block.heading_slug,
                        "text": block.text,
                        "caption_text": block.caption_text,
                        "image_path": block.image_path,
                        "image_markdown": block.image_markdown,
                        "display_markdown": block.display_markdown,
                        "citation_markdown": block.citation_markdown,
                        "preview_target": (
                            block.preview_target.model_dump(mode="json")
                            if block.preview_target is not None
                            else None
                        ),
                    }
                    for block in item.evidence_blocks
                ],
                "page_chunks": [
                    {
                        "page_number": chunk.page_number,
                        "text": chunk.text,
                        "citation_markdown": chunk.citation_markdown,
                        "embedded_image_count": chunk.embedded_image_count,
                        "image_paths": chunk.image_paths,
                    }
                    for chunk in item.page_chunks
                ],
            }
            for item in result.items
        ],
        "next_steps": {
            "summary": result.next_steps.summary,
            "options": result.next_steps.options,
        },
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def format_document_evidence_payload(result: DocumentEvidenceResult) -> str:
    include_item_text = result.document.locator_type == "heading"
    remaining_visual_blocks = _INLINE_VISUAL_EVIDENCE_BUDGET
    formatted_items: list[dict] = []
    omitted_visual_block_count = 0
    included_visual_block_count = 0

    for item in result.items:
        formatted_blocks: list[dict] = []
        for block in item.evidence_blocks:
            is_visual_block = block.kind in _VISUAL_EVIDENCE_KINDS
            if is_visual_block and remaining_visual_blocks <= 0:
                omitted_visual_block_count += 1
                continue

            # Keep answer-facing markdown and citations, but do not expose
            # internal preview handles or duplicate asset paths. Those fields
            # add a large amount of spill-prone payload without helping the
            # model answer or cite the document.
            block_payload = _drop_empty_fields(
                {
                    "evidence_id": block.evidence_id,
                    "kind": block.kind,
                    "locator_type": block.locator_type,
                    "locator_label": block.locator_label,
                    "page_number": block.page_number,
                    "line_number": block.line_number,
                    "heading_slug": block.heading_slug,
                    "text": block.text,
                    "caption_text": block.caption_text,
                    "display_markdown": block.display_markdown,
                    # When display_markdown is present it already bundles the
                    # inline image with the matching citation, so repeating
                    # image_markdown only bloats the tool result.
                    "image_markdown": None if block.display_markdown else block.image_markdown,
                    "citation_markdown": block.citation_markdown,
                }
            )
            formatted_blocks.append(block_payload)
            if is_visual_block:
                remaining_visual_blocks -= 1
                included_visual_block_count += 1

        formatted_items.append(
            _drop_empty_fields(
                {
                    "node_id": item.node_id,
                    "title": item.title,
                    "summary": item.summary,
                    "visual_summary": item.visual_summary,
                    "summary_quality": item.summary_quality,
                    "citation_markdown": item.citation_markdown,
                    **({"text": item.text} if include_item_text and item.text else {}),
                    "evidence_blocks": formatted_blocks,
                }
            )
        )

    next_step_options = list(result.next_steps.options)
    if omitted_visual_block_count > 0:
        next_step_options.append(
            "Inline visual evidence was capped to stay within tool-result budget. If you need an omitted page image, narrow with get_document_tree(document_name_or_id=..., node_id=...) or call get_document_image(document_name_or_id=..., page_number=...)."
        )
    payload = {
        "document": {
            "document_id": result.document.id,
            "knowledge_base": result.document.knowledge_base_name,
            "document_name": result.document.display_name,
            "locator_type": result.document.locator_type,
            "total_pages": result.total_pages,
            "build_quality": result.document.build_quality,
        },
        "requested_node_ids": result.requested_node_ids,
        "returned_pages": result.returned_pages,
        "returned_lines": result.returned_lines,
        "items": formatted_items,
        **(
            {
                "inline_visual_block_count": included_visual_block_count,
                "omitted_visual_block_count": omitted_visual_block_count,
            }
            if included_visual_block_count > 0 or omitted_visual_block_count > 0
            else {}
        ),
        "next_steps": {
            "summary": result.next_steps.summary,
            "options": next_step_options,
        },
    }
    return json.dumps(_drop_empty_fields(payload), ensure_ascii=False, separators=(",", ":"))


def format_document_image_payload(result: DocumentImageResult) -> str:
    payload = {
        "document": {
            "document_id": result.document.id,
            "knowledge_base": result.document.knowledge_base_name,
            "document_name": result.document.display_name,
            "locator_type": result.document.locator_type,
            "total_pages": result.document.page_count,
        },
        "page_number": result.page_number,
        "image_path": result.image_path,
        "embedded_image_count": result.embedded_image_count,
        "next_steps": {
            "summary": result.next_steps.summary,
            "options": result.next_steps.options,
        },
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
