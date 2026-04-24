from __future__ import annotations

from src.community.opencode_web import tools as web_tools


class _FakeToolConfig:
    def __init__(self, model_extra: dict | None = None):
        self.model_extra = model_extra or {}


def _fake_load_tool_config(
    name: str,
    *,
    web_search: _FakeToolConfig | None = None,
    web_fetch: _FakeToolConfig | None = None,
):
    configs = {
        "web_search": web_search,
        "web_fetch": web_fetch,
    }
    return configs.get(name)


class _FakeResponse:
    def __init__(self, status_code: int, text: str, *, headers: dict[str, str] | None = None, json_payload: dict | None = None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}
        self._json_payload = json_payload
        self.content = text.encode("utf-8")

    def json(self):
        if self._json_payload is None:
            raise ValueError("json payload not configured")
        return self._json_payload


def test_web_search_formats_exa_results_and_uses_default_num_results(monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "load_tool_config",
        lambda name: _fake_load_tool_config(
            name,
            web_search=_FakeToolConfig({"providers": ["exa"], "num_results": 3}),
        ),
    )

    captured: dict[str, object] = {}

    def _fake_post(url, json, headers, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        captured["timeout"] = timeout
        return _FakeResponse(
            200,
            (
                'event: message\ndata: {"jsonrpc":"2.0","result":{"content":['
                '{"type":"text","text":"[LangGraph Docs](https://langchain-ai.github.io/langgraph/) '
                'Workflow engine\\n[OpenAgents](https://example.com/openagents): Agent runtime"}]}}\n\n'
            ),
        )

    monkeypatch.setattr(web_tools.httpx, "post", _fake_post)

    result = web_tools.web_search_tool.invoke({"query": "langgraph"})

    assert "Search provider: exa" in result
    assert "LangGraph Docs" in result
    assert "https://langchain-ai.github.io/langgraph/" in result
    assert captured["url"] == "https://mcp.exa.ai/mcp"
    assert captured["json"]["params"]["arguments"]["numResults"] == 3


def test_web_search_uses_exa_api_key_header(monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "load_tool_config",
        lambda name: _fake_load_tool_config(name, web_search=_FakeToolConfig({"providers": ["exa"]})),
    )
    monkeypatch.setenv("EXA_API_KEY", "exa-test-key")

    captured_headers: dict[str, str] = {}

    def _fake_post(url, json, headers, timeout):
        captured_headers.update(headers)
        return _FakeResponse(
            200,
            '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"[Docs](https://example.com/docs): ok"}]}}',
        )

    monkeypatch.setattr(web_tools.httpx, "post", _fake_post)

    result = web_tools.web_search_tool.invoke({"query": "python"})

    assert "Search provider: exa" in result
    assert captured_headers["x-api-key"] == "exa-test-key"


def test_web_search_falls_back_to_brave_on_rate_limit(monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "load_tool_config",
        lambda name: _fake_load_tool_config(name, web_search=_FakeToolConfig({"providers": ["exa", "brave"]})),
    )
    monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "brave-test-key")

    def _fake_post(url, json, headers, timeout):
        return _FakeResponse(429, "rate limited")

    def _fake_get(url, headers=None, params=None, timeout=None, follow_redirects=None):
        assert url == web_tools.BRAVE_SEARCH_URL
        return _FakeResponse(
            200,
            "",
            json_payload={
                "grounding": {
                    "generic": [
                        {
                            "title": "Brave Result",
                            "url": "https://brave.example/result",
                            "snippets": ["Brave snippet"],
                        }
                    ]
                }
            },
        )

    monkeypatch.setattr(web_tools.httpx, "post", _fake_post)
    monkeypatch.setattr(web_tools.httpx, "get", _fake_get)

    result = web_tools.web_search_tool.invoke({"query": "python"})

    assert "Search provider: brave" in result
    assert "Fallback trail: exa(rate_limit)" in result
    assert "https://brave.example/result" in result


def test_web_search_falls_back_to_bing_when_brave_is_unconfigured(monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "load_tool_config",
        lambda name: _fake_load_tool_config(name, web_search=_FakeToolConfig({"providers": ["exa", "brave", "bing"]})),
    )
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)

    def _fake_post(url, json, headers, timeout):
        return _FakeResponse(429, "rate limited")

    def _fake_get(url, headers=None, params=None, timeout=None, follow_redirects=None):
        assert "bing.com/search" in url
        return _FakeResponse(
            200,
            """
            <ol id="b_results">
              <li class="b_algo">
                <h2><a href="https://bing.example/result">Bing Result</a></h2>
                <div class="b_caption"><p>Bing snippet</p></div>
              </li>
            </ol>
            """,
        )

    monkeypatch.setattr(web_tools.httpx, "post", _fake_post)
    monkeypatch.setattr(web_tools.httpx, "get", _fake_get)

    result = web_tools.web_search_tool.invoke({"query": "python"})

    assert "Search provider: bing" in result
    assert "Fallback trail: exa(rate_limit) -> brave(unconfigured)" in result
    assert "https://bing.example/result" in result


def test_web_search_respects_provider_order_and_provider_specific_timeout(monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "load_tool_config",
        lambda name: _fake_load_tool_config(
            name,
            web_search=_FakeToolConfig(
                {
                    "providers": ["bing"],
                    "timeout": 25,
                    "provider_timeouts": {"bing": 12},
                }
            ),
        ),
    )

    captured: dict[str, object] = {}

    def _fake_get(url, headers=None, params=None, timeout=None, follow_redirects=None):
        captured["url"] = url
        captured["timeout"] = timeout
        captured["follow_redirects"] = follow_redirects
        return _FakeResponse(
            200,
            """
            <ol id="b_results">
              <li class="b_algo">
                <h2><a href="https://bing.example/ordered">Ordered Result</a></h2>
                <div class="b_caption"><p>Ordered snippet</p></div>
              </li>
            </ol>
            """,
        )

    monkeypatch.setattr(web_tools.httpx, "get", _fake_get)

    result = web_tools.web_search_tool.invoke({"query": "ordered test"})

    assert "Search provider: bing" in result
    assert captured["timeout"] == 12
    assert captured["follow_redirects"] is True
    assert "setmkt=en-US" in captured["url"]


def test_web_search_prefers_configured_brave_key_over_environment(monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "load_tool_config",
        lambda name: _fake_load_tool_config(
            name,
            web_search=_FakeToolConfig({"providers": ["brave"], "brave_api_key": "config-brave-key"}),
        ),
    )
    monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "env-brave-key")

    captured_headers: dict[str, str] = {}

    def _fake_get(url, headers=None, params=None, timeout=None, follow_redirects=None):
        captured_headers.update(headers or {})
        return _FakeResponse(
            200,
            "",
            json_payload={
                "grounding": {
                    "generic": [
                        {
                            "title": "Configured Brave Result",
                            "url": "https://brave.example/config",
                        }
                    ]
                }
            },
        )

    monkeypatch.setattr(web_tools.httpx, "get", _fake_get)

    result = web_tools.web_search_tool.invoke({"query": "configured brave"})

    assert "Search provider: brave" in result
    assert captured_headers["X-Subscription-Token"] == "config-brave-key"


def test_web_search_reports_stable_error_when_all_providers_fail(monkeypatch):
    monkeypatch.setattr(
        web_tools,
        "load_tool_config",
        lambda name: _fake_load_tool_config(name, web_search=_FakeToolConfig({"providers": ["exa", "bing"]})),
    )

    def _fake_post(url, json, headers, timeout):
        return _FakeResponse(500, "exa upstream error")

    def _fake_get(url, headers=None, params=None, timeout=None, follow_redirects=None):
        return _FakeResponse(500, "bing upstream error")

    monkeypatch.setattr(web_tools.httpx, "post", _fake_post)
    monkeypatch.setattr(web_tools.httpx, "get", _fake_get)

    result = web_tools.web_search_tool.invoke({"query": "python"})

    assert "web_search failed after trying exa(http_error), bing(http_error)" in result
    assert "bing upstream error" in result
