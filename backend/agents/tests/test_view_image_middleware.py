from __future__ import annotations

import json

from typing import Annotated, get_args, get_origin, get_type_hints

from langchain_core.messages import ToolMessage

from src.agents.middlewares.view_image_middleware import ViewImageMiddleware
from src.agents.middlewares.view_image_middleware import ViewImageMiddlewareState
from src.agents.thread_state import merge_viewed_images


def test_view_image_middleware_state_uses_merge_reducer():
    hints = get_type_hints(ViewImageMiddlewareState, include_extras=True)

    annotation = hints["viewed_images"]

    assert get_origin(annotation) is Annotated
    value_type, reducer = get_args(annotation)
    assert reducer is merge_viewed_images
    assert "dict" in str(value_type)


def test_view_image_middleware_adds_knowledge_grounding_reminder_for_knowledge_assets():
    middleware = ViewImageMiddleware()

    content = middleware._create_image_details_message(
        {
            "viewed_images": {
                "/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png": {
                    "base64": "ZmFrZQ==",
                    "mime_type": "image/png",
                }
            }
        }
    )

    joined = "\n".join(
        block["text"] if isinstance(block, dict) and block.get("type") == "text" else ""
        for block in content
    )
    assert "knowledge-base retrieval flow" in joined
    assert "copy its exact citation_markdown" in joined
    assert "do not expose raw /mnt/user-data image paths" in joined
    assert "/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png" not in joined


def test_view_image_middleware_includes_latest_knowledge_evidence_citations_and_visuals():
    middleware = ViewImageMiddleware()
    evidence_payload = {
        "items": [
            {
                "citation_markdown": "[citation:PRML.pdf p.22](kb://citation?x=1)",
                "evidence_blocks": [
                    {
                        "citation_markdown": "[citation:PRML.pdf p.22](kb://citation?x=1)",
                        "display_markdown": "![PRML.pdf p.22](kb://asset?x=1)\n\n[citation:PRML.pdf p.22](kb://citation?x=1)",
                    }
                ],
            }
        ]
    }

    content = middleware._create_image_details_message(
        {
            "messages": [
                ToolMessage(
                    content=json.dumps(evidence_payload, ensure_ascii=False),
                    tool_call_id="call-evidence",
                    name="get_document_evidence",
                )
            ],
            "viewed_images": {
                "/mnt/user-data/outputs/.knowledge/doc-1/pages/page-0022.png": {
                    "base64": "ZmFrZQ==",
                    "mime_type": "image/png",
                }
            },
        }
    )

    joined = "\n".join(
        block["text"] if isinstance(block, dict) and block.get("type") == "text" else ""
        for block in content
    )
    assert "Current-turn knowledge evidence to reuse exactly" in joined
    assert "must include at least one exact citation_markdown" in joined
    assert "[citation:PRML.pdf p.22](kb://citation?x=1)" in joined
    assert "![PRML.pdf p.22](kb://asset?x=1)" in joined
    assert "Reuse exact display_markdown when present" in joined
