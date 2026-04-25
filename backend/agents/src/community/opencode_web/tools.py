from __future__ import annotations

import base64
import json
import logging
import os
import re
from dataclasses import dataclass
from html import unescape as html_unescape
from typing import Any, Literal, cast
from urllib.parse import parse_qs, quote, urlparse

import httpx
from langchain.tools import tool
from markdownify import markdownify as html_to_markdown

from src.config.app_config import load_tool_config

logger = logging.getLogger(__name__)

MAX_RESPONSE_SIZE = 5 * 1024 * 1024  # 5MB
DEFAULT_FETCH_TIMEOUT_SECONDS = 30
MAX_FETCH_TIMEOUT_SECONDS = 120

DEFAULT_EXA_BASE_URL = "https://mcp.exa.ai"
DEFAULT_EXA_ENDPOINT = "/mcp"
DEFAULT_EXA_NUM_RESULTS = 8
DEFAULT_EXA_TIMEOUT_SECONDS = 25.0
DEFAULT_SEARCH_PROVIDERS = ("tavily", "brave", "bing", "duckduckgo")
SUPPORTED_SEARCH_PROVIDERS = frozenset(("tavily", "exa", "brave", "bing", "duckduckgo"))
TAVILY_SEARCH_URL = "https://api.tavily.com/search"
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/llm/context"
BING_SEARCH_URL = "https://www.bing.com/search"
DUCKDUCKGO_SEARCH_URL = "https://html.duckduckgo.com/html/"
TAVILY_API_KEY_ENV_VARS = ("TAVILY_API_KEY", "TVLY_API_KEY")
BRAVE_API_KEY_ENV_VARS = ("BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY")
MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")
HTML_TAG_RE = re.compile(r"<[^>]+>")
BING_RESULT_RE = re.compile(r'<li\s+class="b_algo"[^>]*>([\s\S]*?)</li>', re.IGNORECASE)
BING_LINK_RE = re.compile(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', re.IGNORECASE)
BING_LINECLAMP_RE = re.compile(r'<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)</p>', re.IGNORECASE)
BING_CAPTION_P_RE = re.compile(r'<div[^>]*class="b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)</p>', re.IGNORECASE)
BING_CAPTION_RE = re.compile(r'<div[^>]*class="b_caption[^"]*"[^>]*>([\s\S]*?)</div>', re.IGNORECASE)
DUCKDUCKGO_LINK_RE = re.compile(
    r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>',
    re.IGNORECASE,
)
DUCKDUCKGO_SNIPPET_RE = re.compile(
    r'<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)</(?:a|div)>',
    re.IGNORECASE,
)
BING_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 "
        "Safari/537.36 Edg/131.0.0.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    # Keep encodings to formats httpx decodes in this runtime so the fallback
    # parser receives HTML instead of compressed binary bytes.
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Ch-Ua": '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str
    snippet: str | None = None


@dataclass(frozen=True)
class SearchProviderResult:
    provider: str
    hits: list[SearchHit]
    raw_text: str | None = None


@dataclass(frozen=True)
class SearchProviderFailure:
    provider: str
    reason: str
    detail: str


class SearchProviderError(RuntimeError):
    def __init__(self, provider: str, reason: str, detail: str):
        super().__init__(detail)
        self.provider = provider
        self.reason = reason
        self.detail = detail


def _tool_extra(tool_name: str, field: str, default: Any = None) -> Any:
    config = load_tool_config(tool_name)
    if config is None:
        return default
    return config.model_extra.get(field, default)


def _resolve_fetch_timeout_seconds() -> int:
    timeout = int(_tool_extra("web_fetch", "timeout", DEFAULT_FETCH_TIMEOUT_SECONDS))
    return max(1, min(timeout, MAX_FETCH_TIMEOUT_SECONDS))


def _resolve_search_timeout_seconds(provider: str) -> float:
    default_timeout = float(_tool_extra("web_search", "timeout", DEFAULT_EXA_TIMEOUT_SECONDS))
    configured = _tool_extra("web_search", "provider_timeouts", {})
    if not isinstance(configured, dict):
        return default_timeout

    provider_timeout = configured.get(provider)
    if provider_timeout is None:
        return default_timeout
    return max(1.0, float(provider_timeout))


def _resolve_search_provider_order() -> list[str]:
    configured = _tool_extra("web_search", "providers", list(DEFAULT_SEARCH_PROVIDERS))
    if not isinstance(configured, list) or not configured:
        raise ValueError("web_search.providers must be a non-empty list")

    normalized: list[str] = []
    invalid: list[str] = []
    for provider in configured:
        normalized_provider = str(provider).strip().lower()
        if not normalized_provider:
            continue
        if normalized_provider not in SUPPORTED_SEARCH_PROVIDERS:
            invalid.append(normalized_provider)
            continue
        if normalized_provider not in normalized:
            normalized.append(normalized_provider)

    if invalid:
        raise ValueError(f"Unsupported web_search providers: {', '.join(invalid)}")
    if not normalized:
        raise ValueError("web_search.providers must include at least one supported provider")
    return normalized


def _resolve_search_secret(config_field: str, env_vars: tuple[str, ...]) -> str | None:
    configured = _tool_extra("web_search", config_field)
    if configured is not None:
        value = str(configured).strip()
        if value:
            return value

    for env_var in env_vars:
        env_value = os.getenv(env_var)
        if env_value and env_value.strip():
            return env_value.strip()
    return None


def _resolve_exa_api_key() -> str | None:
    return _resolve_search_secret("api_key", ("EXA_API_KEY",))


def _resolve_tavily_api_key() -> str | None:
    return _resolve_search_secret("tavily_api_key", TAVILY_API_KEY_ENV_VARS)


def _resolve_brave_api_key() -> str | None:
    return _resolve_search_secret("brave_api_key", BRAVE_API_KEY_ENV_VARS)


def _parse_exa_result_text(response_text: str) -> str | None:
    for raw_line in response_text.splitlines():
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        payload_text = line.removeprefix("data:").strip()
        if not payload_text or payload_text == "[DONE]":
            continue
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            continue
        text = _extract_exa_result_text(payload)
        if text:
            return text

    try:
        payload = json.loads(response_text)
    except json.JSONDecodeError:
        return None
    return _extract_exa_result_text(payload)


def _extract_exa_result_text(payload: dict[str, Any]) -> str | None:
    result = payload.get("result")
    if not isinstance(result, dict):
        return None
    content = result.get("content")
    if not isinstance(content, list):
        return None

    texts: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text")
            if text is not None:
                value = str(text).strip()
                if value:
                    texts.append(value)
    if not texts:
        return None
    return "\n\n".join(texts)


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _normalize_snippet(value: str) -> str | None:
    snippet = _normalize_whitespace(value.strip(" :-\n\t"))
    if not snippet:
        return None
    return snippet[:400]


def _extract_html_text(fragment: str) -> str:
    return _normalize_whitespace(HTML_TAG_RE.sub("", html_unescape(fragment)))


def _extract_search_hits_from_text(text: str) -> list[SearchHit]:
    hits: list[SearchHit] = []
    seen_urls: set[str] = set()
    matches = list(MARKDOWN_LINK_RE.finditer(text))

    for index, match in enumerate(matches):
        title = _normalize_whitespace(match.group(1))
        url = match.group(2).strip()
        if not title or not url or url in seen_urls:
            continue

        next_start = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        snippet = _normalize_snippet(text[match.end() : next_start])
        hits.append(SearchHit(title=title, url=url, snippet=snippet))
        seen_urls.add(url)

    return hits


def _looks_like_empty_result_text(text: str | None) -> bool:
    if text is None:
        return True
    normalized = _normalize_whitespace(text).lower()
    if not normalized:
        return True
    return normalized.startswith("no search results found")


def _http_failure_reason(status_code: int) -> str:
    if status_code == 429:
        return "rate_limit"
    if status_code in {401, 403}:
        return "auth"
    if status_code in {408, 504}:
        return "timeout"
    return "http_error"


def _request_failure_reason(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.NetworkError):
        return "network_error"
    return "network_error"


def _provider_display_name(provider: str) -> str:
    if provider == "duckduckgo":
        return "DuckDuckGo"
    return provider.capitalize()


def _raise_provider_request_error(provider: str, exc: Exception) -> None:
    raise SearchProviderError(
        provider,
        _request_failure_reason(exc),
        f"{_provider_display_name(provider)} request failed: {exc}",
    ) from exc


def _raise_provider_http_error(provider: str, response: httpx.Response) -> None:
    if response.status_code < 400:
        return

    body = response.text[:1000]
    raise SearchProviderError(
        provider,
        _http_failure_reason(response.status_code),
        f"{_provider_display_name(provider)} HTTP {response.status_code}: {body}",
    )


def _extract_tavily_hits(payload: dict[str, Any]) -> list[SearchHit]:
    raw_results = payload.get("results")
    if not isinstance(raw_results, list):
        return []

    hits: list[SearchHit] = []
    seen_urls: set[str] = set()
    for entry in raw_results:
        if not isinstance(entry, dict):
            continue

        title = _normalize_whitespace(str(entry.get("title", "")))
        url = str(entry.get("url", "")).strip()
        if not title or not url or url in seen_urls:
            continue

        snippet_source = entry.get("content") or entry.get("snippet") or entry.get("raw_content") or ""
        hits.append(SearchHit(title=title, url=url, snippet=_normalize_snippet(str(snippet_source))))
        seen_urls.add(url)

    return hits


def _search_with_tavily(query: str, *, num_results: int | None) -> SearchProviderResult:
    api_key = _resolve_tavily_api_key()
    if not api_key:
        raise SearchProviderError("tavily", "unconfigured", "Tavily API key is not configured")

    payload = {
        "query": query,
        "search_depth": str(_tool_extra("web_search", "tavily_search_depth", "basic")),
        "topic": str(_tool_extra("web_search", "tavily_topic", "general")),
        "max_results": int(num_results) if num_results is not None else int(_tool_extra("web_search", "num_results", DEFAULT_EXA_NUM_RESULTS)),
        "include_answer": bool(_tool_extra("web_search", "tavily_include_answer", False)),
        "include_raw_content": False,
    }

    try:
        response = httpx.post(
            TAVILY_SEARCH_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=_resolve_search_timeout_seconds("tavily"),
        )
    except Exception as exc:
        _raise_provider_request_error("tavily", exc)

    _raise_provider_http_error("tavily", response)

    try:
        parsed = response.json()
    except json.JSONDecodeError as exc:
        raise SearchProviderError("tavily", "invalid_response", f"Tavily returned invalid JSON: {exc}") from exc

    hits = _extract_tavily_hits(parsed)
    if not hits:
        raise SearchProviderError("tavily", "empty_results", "Tavily returned no search results")
    return SearchProviderResult(provider="tavily", hits=hits)


def _search_with_exa(
    query: str,
    *,
    num_results: int | None,
    livecrawl: str | None,
    search_type: str | None,
    context_max_characters: int | None,
) -> SearchProviderResult:
    timeout = _resolve_search_timeout_seconds("exa")
    base_url = str(_tool_extra("web_search", "base_url", DEFAULT_EXA_BASE_URL)).rstrip("/")
    endpoint = str(_tool_extra("web_search", "endpoint", DEFAULT_EXA_ENDPOINT))
    if not endpoint.startswith("/"):
        endpoint = f"/{endpoint}"

    headers: dict[str, str] = {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
    }
    api_key = _resolve_exa_api_key()
    if api_key:
        headers["x-api-key"] = api_key

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "web_search_exa",
            "arguments": {
                "query": query,
                "numResults": int(num_results) if num_results is not None else int(_tool_extra("web_search", "num_results", DEFAULT_EXA_NUM_RESULTS)),
                "livecrawl": livecrawl or str(_tool_extra("web_search", "livecrawl", "fallback")),
                "type": search_type or str(_tool_extra("web_search", "search_type", "auto")),
            },
        },
    }
    if context_max_characters is not None:
        payload["params"]["arguments"]["contextMaxCharacters"] = int(context_max_characters)

    try:
        response = httpx.post(
            f"{base_url}{endpoint}",
            json=payload,
            headers=headers,
            timeout=timeout,
        )
    except Exception as exc:
        _raise_provider_request_error("exa", exc)

    _raise_provider_http_error("exa", response)

    raw_text = _parse_exa_result_text(response.text)
    if _looks_like_empty_result_text(raw_text):
        raise SearchProviderError("exa", "empty_results", "Exa returned no search results")

    hits = _extract_search_hits_from_text(cast(str, raw_text))
    return SearchProviderResult(provider="exa", hits=hits, raw_text=raw_text)


def _extract_brave_hits(payload: dict[str, Any]) -> list[SearchHit]:
    grounding = payload.get("grounding")
    if not isinstance(grounding, dict):
        return []

    raw_entries: list[dict[str, Any]] = []
    generic_entries = grounding.get("generic")
    if isinstance(generic_entries, list):
        for entry in generic_entries:
            if isinstance(entry, dict):
                raw_entries.append(entry)

    poi_entry = grounding.get("poi")
    if isinstance(poi_entry, dict):
        raw_entries.append(poi_entry)

    map_entries = grounding.get("map")
    if isinstance(map_entries, list):
        for entry in map_entries:
            if isinstance(entry, dict):
                raw_entries.append(entry)

    hits: list[SearchHit] = []
    seen_urls: set[str] = set()
    for entry in raw_entries:
        title = _normalize_whitespace(str(entry.get("title", "")))
        url = str(entry.get("url", "")).strip()
        if not title or not url or url in seen_urls:
            continue

        snippets = entry.get("snippets")
        snippet = None
        if isinstance(snippets, list):
            joined_snippets = " ".join(str(item).strip() for item in snippets if str(item).strip())
            snippet = _normalize_snippet(joined_snippets or "")
        hits.append(SearchHit(title=title, url=url, snippet=snippet))
        seen_urls.add(url)

    return hits


def _search_with_brave(query: str) -> SearchProviderResult:
    api_key = _resolve_brave_api_key()
    if not api_key:
        raise SearchProviderError("brave", "unconfigured", "Brave API key is not configured")

    try:
        response = httpx.get(
            BRAVE_SEARCH_URL,
            headers={
                "Accept": "application/json",
                "X-Subscription-Token": api_key,
            },
            params={"q": query},
            timeout=_resolve_search_timeout_seconds("brave"),
        )
    except Exception as exc:
        _raise_provider_request_error("brave", exc)

    _raise_provider_http_error("brave", response)

    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise SearchProviderError("brave", "invalid_response", f"Brave returned invalid JSON: {exc}") from exc

    hits = _extract_brave_hits(payload)
    if not hits:
        raise SearchProviderError("brave", "empty_results", "Brave returned no search results")
    return SearchProviderResult(provider="brave", hits=hits)


def _decode_bing_url(raw_url: str) -> str | None:
    decoded_url = html_unescape(raw_url)
    if decoded_url.startswith("/") or decoded_url.startswith("#"):
        return None

    match = re.search(r"[?&]u=([a-zA-Z0-9+/_=-]+)", decoded_url)
    if match:
        encoded = match.group(1)
        if len(encoded) >= 3:
            b64 = encoded[2:].replace("-", "+").replace("_", "/")
            try:
                resolved = base64.b64decode(b64 + "=" * (-len(b64) % 4)).decode("utf-8")
            except Exception:
                resolved = ""
            if resolved.startswith("http"):
                return resolved

    if "bing.com" not in decoded_url:
        return decoded_url
    return None


def _extract_bing_hits(html: str) -> list[SearchHit]:
    hits: list[SearchHit] = []

    for block_match in BING_RESULT_RE.finditer(html):
        block = block_match.group(1)
        link_match = BING_LINK_RE.search(block)
        if not link_match:
            continue

        url = _decode_bing_url(link_match.group(1))
        if not url:
            continue

        title = _extract_html_text(link_match.group(2))
        if not title:
            continue

        snippet_match = BING_LINECLAMP_RE.search(block) or BING_CAPTION_P_RE.search(block) or BING_CAPTION_RE.search(block)
        snippet = None
        if snippet_match:
            snippet = _normalize_snippet(_extract_html_text(snippet_match.group(1)))

        hits.append(SearchHit(title=title, url=url, snippet=snippet))

    return hits


def _search_with_bing(query: str) -> SearchProviderResult:
    try:
        response = httpx.get(
            f"{BING_SEARCH_URL}?q={quote(query)}&setmkt=en-US",
            headers=BING_BROWSER_HEADERS,
            timeout=_resolve_search_timeout_seconds("bing"),
            follow_redirects=True,
        )
    except Exception as exc:
        _raise_provider_request_error("bing", exc)

    _raise_provider_http_error("bing", response)

    hits = _extract_bing_hits(response.text)
    if not hits:
        raise SearchProviderError("bing", "empty_results", "Bing returned no search results")
    return SearchProviderResult(provider="bing", hits=hits)


def _decode_duckduckgo_url(raw_url: str) -> str | None:
    decoded_url = html_unescape(raw_url)
    if decoded_url.startswith("//"):
        decoded_url = f"https:{decoded_url}"
    elif decoded_url.startswith("/"):
        decoded_url = f"https://duckduckgo.com{decoded_url}"

    parsed = urlparse(decoded_url)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [None])[0]
        if target and target.startswith("http"):
            return target
        return None

    if parsed.scheme in {"http", "https"} and "duckduckgo.com" not in parsed.netloc:
        return decoded_url
    return None


def _extract_duckduckgo_hits(html: str) -> list[SearchHit]:
    hits: list[SearchHit] = []
    seen_urls: set[str] = set()
    matches = list(DUCKDUCKGO_LINK_RE.finditer(html))

    for index, match in enumerate(matches):
        url = _decode_duckduckgo_url(match.group(1))
        title = _extract_html_text(match.group(2))
        if not title or not url or url in seen_urls:
            continue

        next_start = matches[index + 1].start() if index + 1 < len(matches) else len(html)
        result_block = html[match.end() : next_start]
        snippet_match = DUCKDUCKGO_SNIPPET_RE.search(result_block)
        snippet = _normalize_snippet(_extract_html_text(snippet_match.group(1))) if snippet_match else None
        hits.append(SearchHit(title=title, url=url, snippet=snippet))
        seen_urls.add(url)

    return hits


def _search_with_duckduckgo(query: str) -> SearchProviderResult:
    try:
        response = httpx.get(
            DUCKDUCKGO_SEARCH_URL,
            params={"q": query},
            headers=BING_BROWSER_HEADERS,
            timeout=_resolve_search_timeout_seconds("duckduckgo"),
            follow_redirects=True,
        )
    except Exception as exc:
        _raise_provider_request_error("duckduckgo", exc)

    _raise_provider_http_error("duckduckgo", response)

    hits = _extract_duckduckgo_hits(response.text)
    if not hits:
        raise SearchProviderError("duckduckgo", "empty_results", "DuckDuckGo returned no search results")
    return SearchProviderResult(provider="duckduckgo", hits=hits)


def _run_web_search(
    query: str,
    *,
    num_results: int | None,
    livecrawl: str | None,
    search_type: str | None,
    context_max_characters: int | None,
) -> tuple[SearchProviderResult | None, list[SearchProviderFailure], str | None]:
    failures: list[SearchProviderFailure] = []

    try:
        providers = _resolve_search_provider_order()
    except ValueError as exc:
        return None, failures, f"Error: {exc}"

    # Keep fallback decisions explicit and logged so traces can explain why a
    # later backend won instead of silently hiding upstream provider issues.
    for provider in providers:
        try:
            if provider == "tavily":
                result = _search_with_tavily(query, num_results=num_results)
            elif provider == "exa":
                result = _search_with_exa(
                    query,
                    num_results=num_results,
                    livecrawl=livecrawl,
                    search_type=search_type,
                    context_max_characters=context_max_characters,
                )
            elif provider == "brave":
                result = _search_with_brave(query)
            elif provider == "bing":
                result = _search_with_bing(query)
            else:
                result = _search_with_duckduckgo(query)
        except SearchProviderError as exc:
            failures.append(SearchProviderFailure(provider=exc.provider, reason=exc.reason, detail=exc.detail))
            log_method = logger.info if exc.reason in {"empty_results", "unconfigured"} else logger.warning
            log_method(
                "web_search provider failed provider=%s reason=%s query=%r detail=%s",
                exc.provider,
                exc.reason,
                query,
                exc.detail,
            )
            continue

        logger.info(
            "web_search provider succeeded provider=%s query=%r hit_count=%d raw_text=%s fallback_used=%s trail=%s",
            result.provider,
            query,
            len(result.hits),
            bool(result.raw_text),
            bool(failures),
            ",".join(f"{failure.provider}:{failure.reason}" for failure in failures) or "none",
        )
        return result, failures, None

    if failures:
        last_failure = failures[-1]
        provider_chain = ", ".join(f"{failure.provider}({failure.reason})" for failure in failures)
        return None, failures, f"Error: web_search failed after trying {provider_chain}. Last failure: {last_failure.detail}"

    return None, failures, "Error: web_search failed before any provider executed"


def _format_search_results(result: SearchProviderResult, failures: list[SearchProviderFailure]) -> str:
    lines = [f"Search provider: {result.provider}"]
    if failures:
        lines.append("Fallback trail: " + " -> ".join(f"{failure.provider}({failure.reason})" for failure in failures))
    lines.append("")

    if result.hits:
        for index, hit in enumerate(result.hits, start=1):
            lines.append(f"{index}. {hit.title}")
            lines.append(f"   URL: {hit.url}")
            if hit.snippet:
                lines.append(f"   Snippet: {hit.snippet}")
            lines.append("")
        return "\n".join(lines).strip()

    if result.raw_text:
        lines.append(result.raw_text)
        return "\n".join(lines).strip()

    return "\n".join(lines + ["No search results found."]).strip()


def _validate_and_normalize_url(url: str) -> str:
    url = url.strip()
    if not url:
        raise ValueError("URL is required")
    if url.startswith("http://"):
        url = "https://" + url[len("http://") :]
    if not url.startswith("https://"):
        raise ValueError("URL must start with http:// or https://")
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("Invalid URL")
    return url


def _extract_text_from_html(html: str) -> str:
    md = html_to_markdown(html, heading_style="ATX")
    lines = [line.strip() for line in md.splitlines()]
    return "\n".join(line for line in lines if line)


def _fetch_once(url: str, timeout_seconds: int, *, user_agent: str) -> httpx.Response:
    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    return httpx.get(
        url,
        headers=headers,
        timeout=timeout_seconds,
        follow_redirects=True,
    )


@tool("web_search", parse_docstring=True)
def web_search_tool(
    query: str,
    num_results: int | None = None,
    livecrawl: str | None = None,
    search_type: str | None = None,
    context_max_characters: int | None = None,
) -> str:
    """Search the web using the configured provider fallback chain.

    Args:
        query: Search query text.
        num_results: Optional result count (default 8).
        livecrawl: Optional crawl mode (`fallback` or `preferred`) for Exa.
        search_type: Optional search type (`auto`, `fast`, `deep`) for Exa.
        context_max_characters: Optional max context size from Exa.
    """
    query = query.strip()
    if not query:
        return "Error: query is required"

    result, failures, error = _run_web_search(
        query,
        num_results=num_results,
        livecrawl=livecrawl,
        search_type=search_type,
        context_max_characters=context_max_characters,
    )
    if error is not None:
        return error
    return _format_search_results(cast(SearchProviderResult, result), failures)


@tool("web_fetch", parse_docstring=True)
def web_fetch_tool(
    url: str,
    format: Literal["text", "markdown", "html"] = "markdown",
    timeout: int | None = None,
) -> str:
    """Fetch content from a URL in html/markdown/text format.

    Args:
        url: Full URL to fetch.
        format: Output format, one of `markdown`, `text`, or `html`.
        timeout: Optional timeout in seconds (max 120).
    """
    try:
        url = _validate_and_normalize_url(url)
    except ValueError as exc:
        return f"Error: {exc}"

    timeout_seconds = _resolve_fetch_timeout_seconds() if timeout is None else max(1, min(int(timeout), MAX_FETCH_TIMEOUT_SECONDS))

    try:
        response = _fetch_once(
            url,
            timeout_seconds,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
            ),
        )
        if response.status_code == 403 and response.headers.get("cf-mitigated") == "challenge":
            response = _fetch_once(url, timeout_seconds, user_agent="opencode")
    except Exception as exc:
        return f"Error: web_fetch failed: {exc}"

    if response.status_code >= 400:
        return f"Error: Request failed with status code: {response.status_code}"

    content_length = response.headers.get("content-length")
    if content_length and int(content_length) > MAX_RESPONSE_SIZE:
        return "Error: Response too large (exceeds 5MB limit)"

    raw_bytes = response.content
    if len(raw_bytes) > MAX_RESPONSE_SIZE:
        return "Error: Response too large (exceeds 5MB limit)"

    content_type = (response.headers.get("content-type") or "").lower()
    mime = content_type.split(";")[0].strip()
    if mime.startswith("image/"):
        return f"Image fetched successfully ({mime})"

    body = response.text
    if format == "html":
        return body
    if "text/html" in content_type:
        if format == "markdown":
            return html_to_markdown(body, heading_style="ATX")
        return _extract_text_from_html(body)
    return body
