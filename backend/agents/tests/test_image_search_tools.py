from __future__ import annotations

import json

from src.community.image_search import tools as image_tools


class _FakeToolConfig:
    def __init__(self, model_extra: dict | None = None):
        self.model_extra = model_extra or {}


def test_image_search_returns_frontend_result_shape(monkeypatch):
    monkeypatch.setattr(
        image_tools,
        "load_tool_config",
        lambda name: _FakeToolConfig({"max_results": 1}) if name == "image_search" else None,
    )
    monkeypatch.setattr(
        image_tools,
        "_search_images",
        lambda **_: [
            {
                "title": "Example result",
                "image": "https://cdn.example.com/full.jpg",
                "thumbnail": "https://cdn.example.com/thumb.jpg",
                "url": "https://example.com/source",
            }
        ],
    )

    raw = image_tools.image_search_tool.invoke({"query": "example"})
    payload = json.loads(raw)

    assert payload["query"] == "example"
    assert payload["total_results"] == 1
    assert payload["results"] == [
        {
            "title": "Example result",
            "image_url": "https://cdn.example.com/full.jpg",
            "thumbnail_url": "https://cdn.example.com/thumb.jpg",
            "source_url": "https://example.com/source",
        }
    ]
