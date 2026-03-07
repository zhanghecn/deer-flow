from __future__ import annotations

from typing import Literal
from urllib.parse import urlparse

import httpx
from langchain.tools import tool
from markdownify import markdownify as html_to_markdown

from src.config import get_app_config

MAX_RESPONSE_SIZE = 5 * 1024 * 1024  # 5MB
DEFAULT_TIMEOUT_SECONDS = 30
MAX_TIMEOUT_SECONDS = 120


def _resolve_timeout_seconds() -> int:
    config = get_app_config().get_tool_config("web_fetch")
    timeout = DEFAULT_TIMEOUT_SECONDS
    if config is not None and "timeout" in config.model_extra:
        timeout = int(config.model_extra.get("timeout"))
    timeout = max(1, timeout)
    timeout = min(timeout, MAX_TIMEOUT_SECONDS)
    return timeout


def _validate_and_normalize_url(url: str) -> str:
    url = url.strip()
    if not url:
        raise ValueError("URL is required")
    if url.startswith("http://"):
        # Align with opencode behavior: auto-upgrade insecure HTTP when possible.
        url = "https://" + url[len("http://") :]
    if not url.startswith("https://"):
        raise ValueError("URL must start with http:// or https://")
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("Invalid URL")
    return url


def _extract_text_from_html(html: str) -> str:
    # Keep dependency surface minimal: markdownify output is then stripped.
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

    timeout_seconds = _resolve_timeout_seconds() if timeout is None else max(1, min(int(timeout), MAX_TIMEOUT_SECONDS))

    try:
        response = _fetch_once(url, timeout_seconds, user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
        ))
        # Cloudflare challenge fallback aligned with opencode behavior.
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
