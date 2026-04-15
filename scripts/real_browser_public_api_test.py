#!/usr/bin/env python3
"""Real public API smoke test for a published Deer Flow agent.

Usage:
  OPENAGENTS_PUBLIC_API_KEY=df_xxx \
  python scripts/real_browser_public_api_test.py

Optional overrides:
  OPENAGENTS_PUBLIC_API_BASE_URL=http://127.0.0.1:8083/v1
  OPENAGENTS_PUBLIC_API_MODEL=real-browser-e2e-agent
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Any

import requests


DEFAULT_BASE_URL = "http://127.0.0.1:8083/v1"
DEFAULT_MODEL = "real-browser-e2e-agent"


@dataclass
class SSEEvent:
    event: str
    data: Any


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def auth_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def parse_sse(response: requests.Response) -> list[SSEEvent]:
    events: list[SSEEvent] = []
    current_event = "message"
    current_data: list[str] = []

    for raw_line in response.iter_lines(decode_unicode=True):
        line = (raw_line or "").rstrip("\r")
        if not line:
            if current_data:
                payload = "\n".join(current_data)
                try:
                    data: Any = json.loads(payload)
                except json.JSONDecodeError:
                    data = payload
                events.append(SSEEvent(event=current_event, data=data))
            current_event = "message"
            current_data = []
            continue

        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            current_event = line.split(":", 1)[1].strip() or "message"
            continue
        if line.startswith("data:"):
            current_data.append(line.split(":", 1)[1].strip())

    return events


def assert_ok(response: requests.Response, label: str) -> None:
    if response.ok:
        return
    raise AssertionError(
        f"{label} failed: {response.status_code} {response.text[:500]}"
    )


def main() -> int:
    api_key = require_env("OPENAGENTS_PUBLIC_API_KEY")
    base_url = os.getenv("OPENAGENTS_PUBLIC_API_BASE_URL", DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL
    model = os.getenv("OPENAGENTS_PUBLIC_API_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    session = requests.Session()

    models_response = session.get(
        f"{base_url}/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=20,
    )
    assert_ok(models_response, "GET /models")
    models_payload = models_response.json()
    model_ids = [item.get("id") for item in models_payload.get("data", [])]
    assert model in model_ids, f"Expected model {model!r} in /models, got {model_ids!r}"

    blocking_body = {
        "model": model,
        "input": "Reply with TEST_OK only.",
    }
    blocking_response = session.post(
        f"{base_url}/responses",
        headers=auth_headers(api_key),
        json=blocking_body,
        timeout=60,
    )
    assert_ok(blocking_response, "POST /responses blocking")
    blocking_payload = blocking_response.json()
    assert blocking_payload.get("status") == "completed", blocking_payload
    assert blocking_payload.get("output_text"), blocking_payload
    run_events = (
        blocking_payload.get("openagents", {}) or {}
    ).get("run_events", [])
    run_event_types = [event.get("type") for event in run_events]
    assert "run_started" in run_event_types, run_events
    assert "run_completed" in run_event_types, run_events

    # Keep one tool-using public run in the smoke path so the collector-backed
    # canonical event budget proves it still surfaces tool lifecycle events end
    # to end after gateway/runtime event-spine refactors.
    tool_body = {
        "model": model,
        "input": "Use the bash tool to run: echo PUBLIC_TOOL_OK . Then reply with exactly PUBLIC_TOOL_OK.",
    }
    tool_response = session.post(
        f"{base_url}/responses",
        headers=auth_headers(api_key),
        json=tool_body,
        timeout=90,
    )
    assert_ok(tool_response, "POST /responses tool blocking")
    tool_payload = tool_response.json()
    assert tool_payload.get("status") == "completed", tool_payload
    assert "PUBLIC_TOOL_OK" in (tool_payload.get("output_text") or ""), tool_payload
    tool_run_events = ((tool_payload.get("openagents", {}) or {}).get("run_events", []))
    tool_run_event_types = [event.get("type") for event in tool_run_events]
    assert "tool_started" in tool_run_event_types, tool_run_events
    assert "tool_finished" in tool_run_event_types, tool_run_events

    stream_body = {
        "model": model,
        "input": "Reply with STREAM_OK only.",
        "stream": True,
    }
    stream_response = session.post(
        f"{base_url}/responses",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        json=stream_body,
        timeout=60,
        stream=True,
    )
    assert_ok(stream_response, "POST /responses stream")
    sse_events = parse_sse(stream_response)
    stream_run_events = [e for e in sse_events if e.event == "response.run_event"]
    assert stream_run_events, sse_events
    stream_run_event_types = [
        (e.data or {}).get("event", {}).get("type")
        for e in stream_run_events
        if isinstance(e.data, dict)
    ]
    assert "run_started" in stream_run_event_types, stream_run_events
    assert "assistant_delta" in stream_run_event_types or "assistant_message" in stream_run_event_types, stream_run_events
    assert "run_completed" in stream_run_event_types, stream_run_events

    stream_tool_body = {
        "model": model,
        "input": "Use the bash tool to run: echo STREAM_TOOL_OK . Then reply with exactly STREAM_TOOL_OK.",
        "stream": True,
    }
    stream_tool_response = session.post(
        f"{base_url}/responses",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        json=stream_tool_body,
        timeout=90,
        stream=True,
    )
    assert_ok(stream_tool_response, "POST /responses stream tool")
    stream_tool_sse_events = parse_sse(stream_tool_response)
    stream_tool_run_events = [
        event for event in stream_tool_sse_events if event.event == "response.run_event"
    ]
    assert stream_tool_run_events, stream_tool_sse_events
    stream_tool_run_event_types = [
        (event.data or {}).get("event", {}).get("type")
        for event in stream_tool_run_events
        if isinstance(event.data, dict)
    ]
    assert "tool_started" in stream_tool_run_event_types, stream_tool_run_events
    assert "tool_finished" in stream_tool_run_event_types, stream_tool_run_events
    assert "run_completed" in stream_tool_run_event_types, stream_tool_run_events

    question_body = {
        "model": model,
        "input": (
            "You must use the question tool now. Ask exactly one structured "
            "clarifying question asking whether the user wants code or docs, "
            "then wait for the answer. Do not answer directly."
        ),
    }
    question_response = session.post(
        f"{base_url}/responses",
        headers=auth_headers(api_key),
        json=question_body,
        timeout=90,
    )
    assert_ok(question_response, "POST /responses question blocking")
    question_payload = question_response.json()
    assert question_payload.get("status") == "incomplete", question_payload
    question_run_events = ((question_payload.get("openagents", {}) or {}).get("run_events", []))
    question_run_event_types = [event.get("type") for event in question_run_events]
    assert "question_requested" in question_run_event_types, question_run_events
    assert "run_failed" not in question_run_event_types, question_run_events

    stream_question_body = {
        "model": model,
        "input": question_body["input"],
        "stream": True,
    }
    stream_question_response = session.post(
        f"{base_url}/responses",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        json=stream_question_body,
        timeout=90,
        stream=True,
    )
    assert_ok(stream_question_response, "POST /responses question stream")
    stream_question_sse_events = parse_sse(stream_question_response)
    stream_question_run_events = [
        event for event in stream_question_sse_events if event.event == "response.run_event"
    ]
    assert stream_question_run_events, stream_question_sse_events
    stream_question_run_event_types = [
        (event.data or {}).get("event", {}).get("type")
        for event in stream_question_run_events
        if isinstance(event.data, dict)
    ]
    assert "question_requested" in stream_question_run_event_types, stream_question_run_events
    assert "run_failed" not in stream_question_run_event_types, stream_question_run_events

    print("PUBLIC API TEST PASSED")
    print(
        json.dumps(
            {
                "base_url": base_url,
                "model": model,
                "blocking_response_id": blocking_payload.get("id"),
                "blocking_run_event_types": run_event_types,
                "tool_response_id": tool_payload.get("id"),
                "tool_run_event_types": tool_run_event_types,
                "stream_event_count": len(stream_run_events),
                "stream_run_event_types": stream_run_event_types,
                "stream_tool_event_count": len(stream_tool_run_events),
                "stream_tool_run_event_types": stream_tool_run_event_types,
                "question_response_id": question_payload.get("id"),
                "question_run_event_types": question_run_event_types,
                "stream_question_event_count": len(stream_question_run_events),
                "stream_question_run_event_types": stream_question_run_event_types,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"PUBLIC API TEST FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
