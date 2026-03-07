from __future__ import annotations

from src.community.opencode_web import tools as webfetch_tools


class _FakeToolConfig:
    def __init__(self, model_extra: dict | None = None):
        self.model_extra = model_extra or {}


class _FakeAppConfig:
    def __init__(self, tool_config: _FakeToolConfig | None):
        self._tool_config = tool_config

    def get_tool_config(self, name: str):
        if name != "web_fetch":
            return None
        return self._tool_config


class _FakeResponse:
    def __init__(self, status_code: int, text: str, content: bytes, headers: dict[str, str] | None = None):
        self.status_code = status_code
        self.text = text
        self.content = content
        self.headers = headers or {}


def test_web_fetch_rejects_invalid_url(monkeypatch):
    monkeypatch.setattr(webfetch_tools, "get_app_config", lambda: _FakeAppConfig(None))
    result = webfetch_tools.web_fetch_tool.invoke({"url": "example.com"})
    assert "URL must start with http:// or https://" in result


def test_web_fetch_upgrades_http_url(monkeypatch):
    monkeypatch.setattr(webfetch_tools, "get_app_config", lambda: _FakeAppConfig(None))
    captured_url: dict[str, str] = {}

    def _fake_get(url, headers, timeout, follow_redirects):
        captured_url["value"] = url
        return _FakeResponse(200, "<html><body>Hello</body></html>", b"<html><body>Hello</body></html>", {"content-type": "text/html"})

    monkeypatch.setattr(webfetch_tools.httpx, "get", _fake_get)
    result = webfetch_tools.web_fetch_tool.invoke({"url": "http://example.com"})
    assert captured_url["value"] == "https://example.com"
    assert "Hello" in result


def test_web_fetch_markdown_and_text_conversion(monkeypatch):
    monkeypatch.setattr(webfetch_tools, "get_app_config", lambda: _FakeAppConfig(_FakeToolConfig({"timeout": 15})))

    def _fake_get(url, headers, timeout, follow_redirects):
        assert timeout == 15
        html = "<html><body><h1>Title</h1><p>Hello world</p></body></html>"
        return _FakeResponse(200, html, html.encode("utf-8"), {"content-type": "text/html; charset=utf-8"})

    monkeypatch.setattr(webfetch_tools.httpx, "get", _fake_get)

    md = webfetch_tools.web_fetch_tool.invoke({"url": "https://example.com", "format": "markdown"})
    assert "# Title" in md

    txt = webfetch_tools.web_fetch_tool.invoke({"url": "https://example.com", "format": "text"})
    assert "Title" in txt
    assert "Hello world" in txt


def test_web_fetch_handles_image_and_http_error(monkeypatch):
    monkeypatch.setattr(webfetch_tools, "get_app_config", lambda: _FakeAppConfig(None))
    calls = {"count": 0}

    def _fake_get(url, headers, timeout, follow_redirects):
        calls["count"] += 1
        if calls["count"] == 1:
            return _FakeResponse(500, "oops", b"oops", {"content-type": "text/plain"})
        return _FakeResponse(200, "", b"\x89PNG", {"content-type": "image/png"})

    monkeypatch.setattr(webfetch_tools.httpx, "get", _fake_get)

    err = webfetch_tools.web_fetch_tool.invoke({"url": "https://a.com"})
    assert "status code: 500" in err

    img = webfetch_tools.web_fetch_tool.invoke({"url": "https://b.com"})
    assert "Image fetched successfully (image/png)" == img
