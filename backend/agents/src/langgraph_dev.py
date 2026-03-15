from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from langgraph_api.cli import run_server

from src.config.builtin_agents import ensure_builtin_agent_archive
from src.remote.server import start_remote_relay_sidecar

ALLOWED_RUNTIME_EDITIONS = {"inmem", "postgres", "community"}


def _load_config(config_path: Path) -> dict[str, Any]:
    with config_path.open(encoding="utf-8") as file:
        return json.load(file)


def _resolve_env_path(config_path: Path, env_config: str) -> Path | None:
    env_path = Path(env_config)
    if not env_path.is_absolute():
        env_path = (config_path.parent / env_path).resolve()
    if not env_path.exists():
        return None
    return env_path


def _merge_runtime_env(env_values: dict[str, str]) -> dict[str, str]:
    runtime_env: dict[str, str] = {}
    for key, value in env_values.items():
        effective_value = os.environ.get(key, value)
        if key not in os.environ:
            os.environ[key] = value
        runtime_env[key] = effective_value
    return runtime_env


def _load_env_from_config(config_path: Path, config_data: dict[str, Any]) -> dict[str, str] | None:
    env_config = config_data.get("env")
    if isinstance(env_config, dict):
        return _merge_runtime_env(
            {str(key): str(value) for key, value in env_config.items() if value is not None}
        )
    if not isinstance(env_config, str):
        return None

    env_path = _resolve_env_path(config_path, env_config)
    if env_path is None:
        return None

    loaded_env = {
        key: value
        for key, value in dotenv_values(env_path).items()
        if value is not None
    }
    if not loaded_env:
        return None
    return _merge_runtime_env(loaded_env)


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
    runtime_env = _load_env_from_config(config_path, config_data)

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
    start_remote_relay_sidecar()

    run_server(
        host=host,
        port=port,
        reload=False,
        graphs=config_data.get("graphs", {}),
        # Resolve env here so existing process/Docker env keeps priority over
        # host-view values from a shared `.env` file.
        env=runtime_env,
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
