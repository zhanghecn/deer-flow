from __future__ import annotations

from src.community.opencode_web import tools as web_tools


class _FakeToolConfig:
    def __init__(self, model_extra: dict | None = None):
        self.model_extra = model_extra or {}


class _FakeAppConfig:
    def __init__(self, web_search: _FakeToolConfig | None = None, web_fetch: _FakeToolConfig | None = None):
        self._configs = {
            "web_search": web_search,
            "web_fetch": web_fetch,
        }

    def get_tool_config(self, name: str):
        return self._configs.get(name)


class _FakeResponse:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text


def test_web_search_parses_sse_payload(monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "get_app_config",
        lambda: _FakeAppConfig(web_search=_FakeToolConfig({"num_results": 3})),
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

    monkeypatch.setattr(web_tools.httpx, "post", _fake_post)

    result = web_tools.web_search_tool.invoke({"query": "langgraph"})

    assert result == "search ok"
    assert captured["url"] == "https://mcp.exa.ai/mcp"
    assert captured["json"]["params"]["arguments"]["numResults"] == 3


def test_web_search_uses_exa_api_key_header(monkeypatch):
    monkeypatch.setattr(web_tools, "get_app_config", lambda: _FakeAppConfig())
    monkeypatch.setenv("EXA_API_KEY", "exa-test-key")

    captured_headers: dict[str, str] = {}

    def _fake_post(url, json, headers, timeout):
        captured_headers.update(headers)
        return _FakeResponse(200, '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"ok"}]}}')

    monkeypatch.setattr(web_tools.httpx, "post", _fake_post)

    result = web_tools.web_search_tool.invoke({"query": "python"})

    assert result == "ok"
    assert captured_headers["x-api-key"] == "exa-test-key"


def test_web_search_handles_http_error(monkeypatch):
    monkeypatch.setattr(web_tools, "get_app_config", lambda: _FakeAppConfig())
    monkeypatch.delenv("EXA_API_KEY", raising=False)

    monkeypatch.setattr(web_tools.httpx, "post", lambda *args, **kwargs: _FakeResponse(500, "upstream error"))

    result = web_tools.web_search_tool.invoke({"query": "python"})

    assert "HTTP 500" in result
    assert "upstream error" in result
