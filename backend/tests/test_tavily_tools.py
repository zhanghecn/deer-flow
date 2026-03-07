from __future__ import annotations

import json

from src.community.tavily import tools as tavily_tools


class _FakeToolConfig:
    def __init__(self, model_extra: dict | None = None):
        self.model_extra = model_extra or {}


class _FakeAppConfig:
    def __init__(self, tool_config: _FakeToolConfig | None):
        self._tool_config = tool_config

    def get_tool_config(self, name: str):
        if name != "web_search":
            return None
        return self._tool_config


def test_web_search_returns_recoverable_error_when_api_key_missing(monkeypatch):
    monkeypatch.setattr(tavily_tools, "get_app_config", lambda: _FakeAppConfig(None))
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    result = tavily_tools.web_search_tool.invoke({"query": "latest ai news"})

    assert "web_search is unavailable" in result
    assert "TAVILY_API_KEY" in result


def test_web_fetch_returns_recoverable_error_when_api_key_missing(monkeypatch):
    monkeypatch.setattr(tavily_tools, "get_app_config", lambda: _FakeAppConfig(None))
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    result = tavily_tools.web_fetch_tool.invoke({"url": "https://example.com"})

    assert "web_fetch is unavailable" in result
    assert "TAVILY_API_KEY" in result


def test_web_search_and_fetch_work_when_api_key_present(monkeypatch):
    class _FakeClient:
        def __init__(self, api_key: str):
            assert api_key == "test-key"

        def search(self, query: str, max_results: int):
            assert query == "python"
            assert max_results == 3
            return {
                "results": [
                    {
                        "title": "Python",
                        "url": "https://python.org",
                        "content": "Python language",
                    }
                ]
            }

        def extract(self, urls: list[str]):
            assert urls == ["https://python.org"]
            return {
                "results": [
                    {
                        "title": "Python",
                        "raw_content": "Python language homepage",
                    }
                ]
            }

    monkeypatch.setattr(
        tavily_tools,
        "get_app_config",
        lambda: _FakeAppConfig(_FakeToolConfig({"max_results": 3})),
    )
    monkeypatch.setenv("TAVILY_API_KEY", "test-key")
    monkeypatch.setattr(tavily_tools, "TavilyClient", _FakeClient)

    search_result = tavily_tools.web_search_tool.invoke({"query": "python"})
    parsed = json.loads(search_result)
    assert parsed == [
        {
            "title": "Python",
            "url": "https://python.org",
            "snippet": "Python language",
        }
    ]

    fetch_result = tavily_tools.web_fetch_tool.invoke({"url": "https://python.org"})
    assert "# Python" in fetch_result
    assert "Python language homepage" in fetch_result
