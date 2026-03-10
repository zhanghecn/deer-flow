from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from langgraph_api.cli import run_server

from src.config.builtin_agents import ensure_builtin_agent_archive

ALLOWED_RUNTIME_EDITIONS = {"inmem", "postgres", "community"}


def _load_config(config_path: Path) -> dict[str, Any]:
    with config_path.open(encoding="utf-8") as file:
        return json.load(file)


def _load_env_from_config(config_path: Path, config_data: dict[str, Any]) -> None:
    env_config = config_data.get("env")
    if not isinstance(env_config, str):
        return

    env_path = Path(env_config)
    if not env_path.is_absolute():
        env_path = (config_path.parent / env_path).resolve()
    if not env_path.exists():
        return

    for key, value in dotenv_values(env_path).items():
        if value is None or key in os.environ:
            continue
        os.environ[key] = value


def _parse_int_env(var_name: str, default: int) -> int:
    raw = os.getenv(var_name, str(default)).strip()
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid integer for {var_name}: {raw}") from exc


def _required_env(var_name: str) -> str:
    value = os.getenv(var_name, "").strip()
    if value:
        return value
    raise RuntimeError(f"Missing required env: {var_name}")


def _resolve_config_path() -> Path:
    raw = os.getenv("LANGGRAPH_CONFIG", "langgraph.json").strip() or "langgraph.json"
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return path


def _has_postgres_runtime_backend() -> bool:
    return importlib.util.find_spec("langgraph_runtime_postgres") is not None


def main() -> None:
    config_path = _resolve_config_path()
    config_data = _load_config(config_path)
    _load_env_from_config(config_path, config_data)

    runtime_edition = (
        os.getenv("LANGGRAPH_RUNTIME_EDITION", "inmem").strip() or "inmem"
    )
    if runtime_edition not in ALLOWED_RUNTIME_EDITIONS:
        allowed = "|".join(sorted(ALLOWED_RUNTIME_EDITIONS))
        raise RuntimeError(
            f"Invalid LANGGRAPH_RUNTIME_EDITION: {runtime_edition} (expected: {allowed})"
        )
    if runtime_edition == "postgres" and not _has_postgres_runtime_backend():
        print(
            "LANGGRAPH_RUNTIME_EDITION=postgres requested, but "
            "langgraph_runtime_postgres is not installed. "
            "Falling back to inmem runtime."
        )
        runtime_edition = "inmem"

    host = os.getenv("LANGGRAPH_HOST", "0.0.0.0").strip() or "0.0.0.0"
    port = _parse_int_env("LANGGRAPH_PORT", 2024)

    runtime_kwargs: dict[str, str] = {}
    database_uri = os.getenv("DATABASE_URI", "").strip()
    if database_uri:
        # Prevent langgraph_api.cli from clobbering DATABASE_URI to :memory:.
        runtime_kwargs["__database_uri__"] = database_uri

    if runtime_edition == "postgres":
        if not database_uri:
            runtime_kwargs["__database_uri__"] = _required_env("DATABASE_URI")
        runtime_kwargs["__redis_uri__"] = _required_env("REDIS_URI")
        migrations_path = os.getenv("MIGRATIONS_PATH", "").strip()
        if migrations_path:
            runtime_kwargs["__migrations_path__"] = migrations_path

    print(
        f"Starting LangGraph with runtime edition: {runtime_edition} "
        f"(host={host} port={port})"
    )

    # Ensure built-in archived agent files exist before serving requests.
    ensure_builtin_agent_archive("lead_agent", status="dev")
    ensure_builtin_agent_archive("lead_agent", status="prod")

    run_server(
        host=host,
        port=port,
        reload=False,
        graphs=config_data.get("graphs", {}),
        env=config_data.get("env"),
        auth=config_data.get("auth"),
        store=config_data.get("store"),
        http=config_data.get("http"),
        ui=config_data.get("ui"),
        webhooks=config_data.get("webhooks"),
        ui_config=config_data.get("ui_config"),
        checkpointer=config_data.get("checkpointer"),
        disable_persistence=config_data.get("disable_persistence", False),
        runtime_edition=runtime_edition,
        **runtime_kwargs,
    )


if __name__ == "__main__":
    main()
