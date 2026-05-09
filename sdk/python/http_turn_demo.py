#!/usr/bin/env python3
"""Minimal OpenAgents HTTP demo for the native /v1/turns contract.

Environment variables:
  OPENAGENTS_BASE_URL   e.g. http://127.0.0.1:8083 or http://127.0.0.1:8083/v1
  OPENAGENTS_API_KEY    bearer key for the published agent
  OPENAGENTS_AGENT      published agent name
  OPENAGENTS_SESSION_ID optional stable SDK session id
  OPENAGENTS_HISTORY_SCOPE optional flat JSON object, e.g. {"tenant_id":"acme"}
  OPENAGENTS_PROMPT     optional prompt text
  OPENAGENTS_STREAM     set to 1 to use SSE streaming
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


def resolve_base_url(raw: str) -> str:
    trimmed = raw.rstrip("/")
    return trimmed if trimmed.endswith("/v1") else f"{trimmed}/v1"


def build_headers(api_key: str, *, accept: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if accept:
        headers["Accept"] = accept
    return headers


def create_turn(base_url: str, api_key: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{base_url}/turns",
        data=json.dumps({**payload, "stream": False}).encode("utf-8"),
        headers=build_headers(api_key),
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def stream_turn(base_url: str, api_key: str, payload: dict) -> str | None:
    request = urllib.request.Request(
        f"{base_url}/turns",
        data=json.dumps({**payload, "stream": True}).encode("utf-8"),
        headers=build_headers(api_key, accept="text/event-stream"),
        method="POST",
    )
    turn_id: str | None = None
    event_name = "message"
    data_lines: list[str] = []

    with urllib.request.urlopen(request) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8").rstrip("\n")
            if not line:
                if data_lines and event_name != "done":
                    event = json.loads("\n".join(data_lines))
                    turn_id = event.get("turn_id") or turn_id
                    print(f"[{event_name}] {json.dumps(event, ensure_ascii=False)}")
                event_name = "message"
                data_lines = []
                continue
            if line.startswith("event:"):
                event_name = line.split(":", 1)[1].strip()
                continue
            if line.startswith("data:"):
                data_lines.append(line.split(":", 1)[1].strip())

    return turn_id


def get_turn(base_url: str, api_key: str, turn_id: str) -> dict:
    encoded = urllib.parse.quote(turn_id, safe="")
    request = urllib.request.Request(
        f"{base_url}/turns/{encoded}",
        headers={"Authorization": f"Bearer {api_key}"},
        method="GET",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_history_scope(raw: str) -> dict[str, str]:
    trimmed = raw.strip()
    if not trimmed:
        return {}
    parsed = json.loads(trimmed)
    if not isinstance(parsed, dict):
        raise ValueError("OPENAGENTS_HISTORY_SCOPE must be a JSON object")

    scope: dict[str, str] = {}
    for key, value in parsed.items():
        normalized_key = str(key).strip()
        if not normalized_key:
            raise ValueError("OPENAGENTS_HISTORY_SCOPE cannot contain empty keys")
        if not isinstance(value, str):
            raise ValueError("OPENAGENTS_HISTORY_SCOPE values must be strings")
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("OPENAGENTS_HISTORY_SCOPE cannot contain empty values")
        # Mirror the server contract so the demo fails before sending ambiguous
        # duplicate keys produced by client-side trimming.
        if normalized_key in scope:
            raise ValueError("OPENAGENTS_HISTORY_SCOPE keys must be unique after trimming")
        scope[normalized_key] = normalized_value
    return scope


def main() -> int:
    raw_base_url = os.environ.get("OPENAGENTS_BASE_URL", "http://127.0.0.1:8083")
    api_key = os.environ.get("OPENAGENTS_API_KEY", "").strip()
    agent = os.environ.get("OPENAGENTS_AGENT", "").strip()
    session_id = os.environ.get("OPENAGENTS_SESSION_ID", "").strip() or str(
        uuid.uuid4()
    )
    prompt = os.environ.get(
        "OPENAGENTS_PROMPT",
        "请总结当前客服问题，并告诉我下一步怎么处理。",
    ).strip()
    try:
        history_scope = parse_history_scope(os.environ.get("OPENAGENTS_HISTORY_SCOPE", ""))
    except (json.JSONDecodeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    stream = os.environ.get("OPENAGENTS_STREAM", "").strip() == "1"

    if not api_key or not agent:
        print(
            "OPENAGENTS_API_KEY and OPENAGENTS_AGENT are required.",
            file=sys.stderr,
        )
        return 2

    base_url = resolve_base_url(raw_base_url)
    payload = {
        "agent": agent,
        "session_id": session_id,
        "input": {"text": prompt},
        "thinking": {"enabled": True, "effort": "medium"},
    }
    if history_scope:
        payload["history_scope"] = history_scope

    try:
        print(f"[session_id] {session_id}")
        if history_scope:
            print(f"[history_scope] {json.dumps(history_scope, ensure_ascii=False)}")
        if stream:
            turn_id = stream_turn(base_url, api_key, payload)
            if turn_id:
                final_turn = get_turn(base_url, api_key, turn_id)
                print("\n[final-turn]")
                print(json.dumps(final_turn, indent=2, ensure_ascii=False))
            return 0

        turn = create_turn(base_url, api_key, payload)
        print(json.dumps(turn, indent=2, ensure_ascii=False))
        return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        print(body or str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
