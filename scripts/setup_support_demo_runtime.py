#!/usr/bin/env python3
"""Recreate the customer-support demo fixtures against a running OpenAgents stack.

This script turns the checked-in support-demo summary into reproducible API
calls instead of depending on ignored local state. It:

- stages the external customer cases into `.openagents/runtime/customer-cases`
- logs into or registers the demo user
- upserts the stdio + HTTP MCP profiles
- upserts and publishes the support agents
- creates or reuses scoped public API keys
- writes `frontend/demo/.env.local`
- writes a fresh runtime summary for browser/e2e verification
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "http://127.0.0.1:8083"
DEFAULT_SUMMARY = REPO_ROOT / "docs/testing/results/2026-04-17-support-sdk-demo-runtime/setup-summary.json"
DEFAULT_RUNTIME_SUMMARY = REPO_ROOT / "docs/testing/results/2026-04-17-support-sdk-demo-runtime/setup-summary.runtime.json"
DEFAULT_CASES_SOURCE = Path(
    os.getenv(
        "OPENAGENTS_SUPPORT_CASES_SOURCE",
        "/root/project/ai/ai-numerology/backend/agents/examples/案例大全",
    )
)
DEFAULT_CASES_TARGET = REPO_ROOT / ".openagents/runtime/customer-cases"
DEFAULT_DEMO_ENV = REPO_ROOT / "frontend/demo/.env.local"


class APIError(RuntimeError):
    """Raised when a gateway call fails."""


@dataclass
class AuthContext:
    token: str
    user: dict[str, Any]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def request_json(
    base_url: str,
    method: str,
    path: str,
    *,
    body: dict[str, Any] | list[Any] | None = None,
    bearer_token: str | None = None,
) -> Any:
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    req = Request(f"{base_url.rstrip('/')}{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(req) as response:
            payload = response.read().decode("utf-8")
            if not payload:
                return None
            return json.loads(payload)
    except HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="ignore")
        try:
            parsed = json.loads(payload) if payload else {}
        except json.JSONDecodeError:
            parsed = {}
        detail = parsed.get("details") or parsed.get("error") or payload or exc.reason
        raise APIError(f"{method} {path} failed: {detail}") from exc


def stage_cases(source: Path, target: Path) -> None:
    if not source.is_dir():
        raise FileNotFoundError(f"customer cases source was not found: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, dirs_exist_ok=True)


def login_or_register(base_url: str, summary: dict[str, Any]) -> AuthContext:
    user = summary["user"]
    login_body = {"account": user["name"], "password": user["password"]}
    try:
        payload = request_json(base_url, "POST", "/api/auth/login", body=login_body)
    except APIError:
        register_body = {
            "email": user["email"],
            "name": user["name"],
            "password": user["password"],
        }
        payload = request_json(base_url, "POST", "/api/auth/register", body=register_body)
    return AuthContext(token=payload["token"], user=payload["user"])


def upsert_profile(base_url: str, auth: AuthContext, profile: dict[str, Any]) -> dict[str, Any]:
    profiles_payload = request_json(base_url, "GET", "/api/mcp/profiles", bearer_token=auth.token)
    existing = {
        item["name"]: item
        for item in profiles_payload.get("profiles", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }
    body = {"config_json": profile["config_json"]}
    if profile["name"] in existing:
        return request_json(
            base_url,
            "PUT",
            f"/api/mcp/profiles/{profile['name']}",
            body=body,
            bearer_token=auth.token,
        )
    body["name"] = profile["name"]
    return request_json(base_url, "POST", "/api/mcp/profiles", body=body, bearer_token=auth.token)


def build_agent_payload(agent: dict[str, Any], *, include_name: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "description": agent.get("description", ""),
        "model": agent.get("model"),
        "tool_groups": agent.get("tool_groups"),
        "tool_names": agent.get("tool_names"),
        "mcp_servers": agent.get("mcp_servers"),
        "memory": agent.get("memory"),
        "subagent_defaults": agent.get("subagent_defaults"),
        "subagents": agent.get("subagents"),
        "agents_md": agent.get("agents_md", ""),
    }
    if include_name:
        payload["name"] = agent["name"]
    return payload


def upsert_agent(base_url: str, auth: AuthContext, agent: dict[str, Any]) -> dict[str, Any]:
    try:
        request_json(
            base_url,
            "GET",
            f"/api/agents/{agent['name']}?status=dev",
            bearer_token=auth.token,
        )
        return request_json(
            base_url,
            "PUT",
            f"/api/agents/{agent['name']}?status=dev",
            body=build_agent_payload(agent, include_name=False),
            bearer_token=auth.token,
        )
    except APIError as exc:
        if "not found" not in str(exc).lower():
            raise
        return request_json(
            base_url,
            "POST",
            "/api/agents",
            body=build_agent_payload(agent, include_name=True),
            bearer_token=auth.token,
        )


def publish_agent(base_url: str, auth: AuthContext, name: str) -> dict[str, Any]:
    return request_json(
        base_url,
        "POST",
        f"/api/agents/{name}/publish",
        bearer_token=auth.token,
    )


def list_tokens(base_url: str, auth: AuthContext) -> list[dict[str, Any]]:
    payload = request_json(base_url, "GET", "/api/auth/tokens", bearer_token=auth.token)
    return payload if isinstance(payload, list) else []


def ensure_token(base_url: str, auth: AuthContext, desired: dict[str, Any]) -> dict[str, Any]:
    for token in list_tokens(base_url, auth):
        if token.get("name") == desired["name"] and token.get("allowed_agents") == desired["allowed_agents"]:
            return token
    return request_json(
        base_url,
        "POST",
        "/api/auth/tokens",
        body={
            "name": desired["name"],
            "scopes": desired["scopes"],
            "allowed_agents": desired["allowed_agents"],
            "metadata": desired.get("metadata") or {},
        },
        bearer_token=auth.token,
    )


def write_demo_env(
    path: Path,
    *,
    base_url: str,
    stdio_agent: str,
    http_agent: str,
    stdio_token: str,
    http_token: str,
) -> None:
    ensure_parent(path)
    content = "\n".join(
        [
            f"VITE_DEMO_PUBLIC_API_BASE_URL={base_url.rstrip('/')}/v1",
            f"VITE_DEMO_PUBLIC_API_KEY={http_token}",
            f"VITE_DEMO_DEFAULT_AGENT_NAME={http_agent}",
            f"VITE_DEMO_STDIO_AGENT_NAME={stdio_agent}",
            f"VITE_DEMO_STDIO_API_KEY={stdio_token}",
            f"VITE_DEMO_HTTP_AGENT_NAME={http_agent}",
            f"VITE_DEMO_HTTP_API_KEY={http_token}",
            "",
        ]
    )
    path.write_text(content, encoding="utf-8")


def main() -> int:
    summary_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_SUMMARY
    base_url = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_BASE_URL
    runtime_summary_path = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else DEFAULT_RUNTIME_SUMMARY

    desired = read_json(summary_path)
    auth = login_or_register(base_url, desired)

    stage_cases(DEFAULT_CASES_SOURCE, DEFAULT_CASES_TARGET)

    profiles = [upsert_profile(base_url, auth, profile) for profile in desired.get("profiles", [])]
    agents = []
    for desired_agent in desired.get("agents", []):
        upsert_agent(base_url, auth, desired_agent)
        agents.append(publish_agent(base_url, auth, desired_agent["name"]))

    tokens = [ensure_token(base_url, auth, token) for token in desired.get("tokens", [])]
    token_by_agent = {
        agent_name: token
        for token in tokens
        for agent_name in token.get("allowed_agents", [])
    }

    stdio_agent = next(agent["name"] for agent in agents if agent["name"].endswith("stdio-demo"))
    http_agent = next(agent["name"] for agent in agents if agent["name"].endswith("http-demo"))
    write_demo_env(
        DEFAULT_DEMO_ENV,
        base_url=base_url,
        stdio_agent=stdio_agent,
        http_agent=http_agent,
        stdio_token=token_by_agent[stdio_agent]["token"],
        http_token=token_by_agent[http_agent]["token"],
    )

    runtime_summary = {
        "base_url": base_url,
        "user": auth.user,
        "profiles": profiles,
        "agents": agents,
        "tokens": tokens,
        "cases_source": str(DEFAULT_CASES_SOURCE),
        "cases_target": str(DEFAULT_CASES_TARGET),
        "demo_env": str(DEFAULT_DEMO_ENV),
    }
    ensure_parent(runtime_summary_path)
    runtime_summary_path.write_text(
        json.dumps(runtime_summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(runtime_summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
