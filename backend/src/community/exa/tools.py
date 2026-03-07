import json
import os
from typing import Any

import httpx
from langchain.tools import tool

from src.config import get_app_config

DEFAULT_BASE_URL = "https://mcp.exa.ai"
DEFAULT_ENDPOINT = "/mcp"
DEFAULT_NUM_RESULTS = 8
DEFAULT_TIMEOUT_SECONDS = 25.0


def _tool_extra(name: str, default: Any = None) -> Any:
    config = get_app_config().get_tool_config("web_search")
    if config is None:
        return default
    return config.model_extra.get(name, default)


def _resolve_exa_api_key() -> str | None:
    raw = _tool_extra("api_key")
    if raw is not None:
        key = str(raw).strip()
        if key:
            return key
    env_key = os.getenv("EXA_API_KEY")
    if not env_key:
        return None
    env_key = env_key.strip()
    return env_key or None


def _parse_exa_mcp_response(response_text: str) -> str | None:
    # Exa MCP usually streams SSE lines with `data: {...}` payloads.
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
        text = _extract_result_text(payload)
        if text:
            return text

    # Fallback for non-SSE JSON payloads.
    try:
        payload = json.loads(response_text)
    except json.JSONDecodeError:
        return None
    return _extract_result_text(payload)


def _extract_result_text(payload: dict[str, Any]) -> str | None:
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


@tool("web_search", parse_docstring=True)
def web_search_tool(
    query: str,
    num_results: int | None = None,
    livecrawl: str | None = None,
    search_type: str | None = None,
    context_max_characters: int | None = None,
) -> str:
    """Search the web using Exa MCP endpoint (opencode-compatible behavior).

    Args:
        query: The query to search for.
        num_results: Optional number of results (default: 8).
        livecrawl: Optional crawl mode, one of `fallback` or `preferred`.
        search_type: Optional search type, one of `auto`, `fast`, or `deep`.
        context_max_characters: Optional max context length returned by Exa.
    """
    query = query.strip()
    if not query:
        return "Error: query is required"

    timeout = float(_tool_extra("timeout", DEFAULT_TIMEOUT_SECONDS))
    base_url = str(_tool_extra("base_url", DEFAULT_BASE_URL)).rstrip("/")
    endpoint = str(_tool_extra("endpoint", DEFAULT_ENDPOINT))
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
                "numResults": int(num_results) if num_results is not None else int(_tool_extra("num_results", DEFAULT_NUM_RESULTS)),
                "livecrawl": livecrawl or str(_tool_extra("livecrawl", "fallback")),
                "type": search_type or str(_tool_extra("search_type", "auto")),
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

    parsed = _parse_exa_mcp_response(response.text)
    if not parsed:
        return "No search results found. Please try a different query."
    return parsed
