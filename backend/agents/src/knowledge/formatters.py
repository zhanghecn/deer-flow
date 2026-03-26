from __future__ import annotations

import json

from src.knowledge.models import (
    DocumentImageResult,
    DocumentTreeListing,
    KnowledgeDocumentRecord,
    NodeDetailResult,
)


def format_tree_listing_payload(listing: DocumentTreeListing) -> str:
    payload = {
        "document": {
            "id": listing.document.id,
            "knowledge_base": listing.document.knowledge_base_name,
            "name": listing.document.display_name,
            "description": listing.document.doc_description,
            "file_kind": listing.document.file_kind,
            "locator_type": listing.document.locator_type,
            "node_id": listing.node_id,
            "max_depth": listing.max_depth,
        },
        "tree": listing.tree,
        "next_steps": {
            "summary": f"Returned a tree window for {listing.document.display_name}.",
            "options": [
                "If a branch has has_more_children=true, call get_document_tree(document_name_or_id=..., node_id=...) to inspect that subtree.",
                "Once you identify the relevant nodes, call get_document_tree_node_detail(document_name_or_id=..., node_ids=...) to read grounded source text.",
            ],
        },
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def format_documents_payload(documents: list[KnowledgeDocumentRecord]) -> str:
    available = []
    processing = []
    for document in documents:
        entry = {
            "document_id": document.id,
            "knowledge_base": document.knowledge_base_name,
            "document_name": document.display_name,
            "description": document.doc_description,
            "file_kind": document.file_kind,
            "locator_type": document.locator_type,
            "status": document.status,
            "node_count": document.node_count,
        }
        if document.latest_build_job is not None:
            entry["build_job"] = document.latest_build_job.model_dump(mode="json")
        if document.status == "ready":
            available.append(entry)
        else:
            entry["error"] = document.error
            processing.append(entry)
    payload = {
        "available_documents": available,
        "unavailable_documents": processing,
        "tool_protocol": [
            "1. Use get_document_tree(document_name_or_id=...) to inspect the nested tree.",
            "2. Use get_document_tree(document_name_or_id=..., node_id=...) to inspect a subtree when needed.",
            "3. Use get_document_tree_node_detail(document_name_or_id=..., node_ids=...) to read source text for one or more nodes and copy the returned citation_markdown exactly.",
            "4. If a PDF page contains a relevant figure, use get_document_image(document_name_or_id=..., page_number=...) and then view_image(image_path=...) when vision is available.",
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def format_node_detail_payload(result: NodeDetailResult) -> str:
    payload = {
        "document": {
            "document_id": result.document.id,
            "knowledge_base": result.document.knowledge_base_name,
            "document_name": result.document.display_name,
            "locator_type": result.document.locator_type,
            "total_pages": result.total_pages,
        },
        "requested_node_ids": result.requested_node_ids,
        "requested_pages": result.requested_pages,
        "returned_pages": result.returned_pages,
        "returned_lines": result.returned_lines,
        "items": [
            {
                "node_id": item.node_id,
                "parent_node_id": item.parent_node_id,
                "title": item.title,
                "child_count": item.child_count,
                "page_start": item.page_start,
                "page_end": item.page_end,
                "line_start": item.line_start,
                "line_end": item.line_end,
                "heading_slug": item.heading_slug,
                "summary": item.summary,
                "prefix_summary": item.prefix_summary,
                "citation_markdown": item.citation_markdown,
                "text": item.text,
                "image_paths": item.image_paths,
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
    return json.dumps(payload, ensure_ascii=False, indent=2)


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
    return json.dumps(payload, ensure_ascii=False, indent=2)
