from __future__ import annotations

import json
import os
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from langchain.tools import tool
from markdownify import markdownify as html_to_markdown

from src.config import get_app_config

MAX_RESPONSE_SIZE = 5 * 1024 * 1024  # 5MB
DEFAULT_FETCH_TIMEOUT_SECONDS = 30
MAX_FETCH_TIMEOUT_SECONDS = 120

DEFAULT_EXA_BASE_URL = "https://mcp.exa.ai"
DEFAULT_EXA_ENDPOINT = "/mcp"
DEFAULT_EXA_NUM_RESULTS = 8
DEFAULT_EXA_TIMEOUT_SECONDS = 25.0


def _tool_extra(tool_name: str, field: str, default: Any = None) -> Any:
    config = get_app_config().get_tool_config(tool_name)
    if config is None:
        return default
    return config.model_extra.get(field, default)


def _resolve_fetch_timeout_seconds() -> int:
    timeout = int(_tool_extra("web_fetch", "timeout", DEFAULT_FETCH_TIMEOUT_SECONDS))
    return max(1, min(timeout, MAX_FETCH_TIMEOUT_SECONDS))


def _resolve_exa_api_key() -> str | None:
    configured = _tool_extra("web_search", "api_key")
    if configured is not None:
        value = str(configured).strip()
        if value:
            return value
    env_value = os.getenv("EXA_API_KEY")
    if not env_value:
        return None
    env_value = env_value.strip()
    return env_value or None


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
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text")
            if text is not None:
                value = str(text).strip()
                if value:
                    return value
    return None


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
    """Search the web using the opencode-style Exa MCP endpoint.

    Args:
        query: Search query text.
        num_results: Optional result count (default 8).
        livecrawl: Optional crawl mode (`fallback` or `preferred`).
        search_type: Optional search type (`auto`, `fast`, `deep`).
        context_max_characters: Optional max context size from Exa.
    """
    query = query.strip()
    if not query:
        return "Error: query is required"

    timeout = float(_tool_extra("web_search", "timeout", DEFAULT_EXA_TIMEOUT_SECONDS))
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
        return f"Error: web_search failed: {exc}"

    if response.status_code >= 400:
        body = response.text[:1000]
        return f"Error: web_search failed with HTTP {response.status_code}: {body}"

    parsed = _parse_exa_result_text(response.text)
    if not parsed:
        return "No search results found. Please try a different query."
    return parsed


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

    timeout_seconds = (
        _resolve_fetch_timeout_seconds() if timeout is None else max(1, min(int(timeout), MAX_FETCH_TIMEOUT_SECONDS))
    )

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
