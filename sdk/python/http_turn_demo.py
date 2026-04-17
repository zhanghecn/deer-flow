#!/usr/bin/env python3
"""Minimal OpenAgents HTTP demo for the native /v1/turns contract.

Environment variables:
  OPENAGENTS_BASE_URL   e.g. http://127.0.0.1:8083 or http://127.0.0.1:8083/v1
  OPENAGENTS_API_KEY    bearer key for the published agent
  OPENAGENTS_AGENT      published agent name
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


def main() -> int:
    raw_base_url = os.environ.get("OPENAGENTS_BASE_URL", "http://127.0.0.1:8083")
    api_key = os.environ.get("OPENAGENTS_API_KEY", "").strip()
    agent = os.environ.get("OPENAGENTS_AGENT", "").strip()
    prompt = os.environ.get(
        "OPENAGENTS_PROMPT",
        "请总结当前客服问题，并告诉我下一步怎么处理。",
    ).strip()
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
        "input": {"text": prompt},
        "thinking": {"enabled": True, "effort": "medium"},
    }

    try:
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
