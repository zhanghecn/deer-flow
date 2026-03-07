from __future__ import annotations

from src.community.exa import tools as exa_tools


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


class _FakeResponse:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text


def test_web_search_parses_sse_payload(monkeypatch):
    monkeypatch.setattr(
        exa_tools,
        "get_app_config",
        lambda: _FakeAppConfig(_FakeToolConfig({"num_results": 3})),
    )

    captured: dict[str, object] = {}

    def _fake_post(url, json, headers, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        captured["timeout"] = timeout
        return _FakeResponse(
            200,
            'event: message\ndata: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"search ok"}]}}\n\n',
        )

    monkeypatch.setattr(exa_tools.httpx, "post", _fake_post)

    result = exa_tools.web_search_tool.invoke({"query": "langgraph"})

    assert result == "search ok"
    assert captured["url"] == "https://mcp.exa.ai/mcp"
    assert captured["json"]["params"]["arguments"]["numResults"] == 3


def test_web_search_uses_exa_api_key_header(monkeypatch):
    monkeypatch.setattr(exa_tools, "get_app_config", lambda: _FakeAppConfig(None))
    monkeypatch.setenv("EXA_API_KEY", "exa-test-key")

    captured_headers: dict[str, str] = {}

    def _fake_post(url, json, headers, timeout):
        captured_headers.update(headers)
        return _FakeResponse(200, '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"ok"}]}}')

    monkeypatch.setattr(exa_tools.httpx, "post", _fake_post)

    result = exa_tools.web_search_tool.invoke({"query": "python"})

    assert result == "ok"
    assert captured_headers["x-api-key"] == "exa-test-key"


def test_web_search_handles_http_error(monkeypatch):
    monkeypatch.setattr(exa_tools, "get_app_config", lambda: _FakeAppConfig(None))
    monkeypatch.delenv("EXA_API_KEY", raising=False)

    monkeypatch.setattr(exa_tools.httpx, "post", lambda *args, **kwargs: _FakeResponse(500, "upstream error"))

    result = exa_tools.web_search_tool.invoke({"query": "python"})

    assert "HTTP 500" in result
    assert "upstream error" in result
