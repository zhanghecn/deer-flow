from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from langgraph_api.cli import run_server
import yaml

from src.agents.lead_agent.agent import prime_lead_agent_read_graph_cache
from src.config.builtin_agents import ensure_builtin_agent_archive
from src.config.config_files import resolve_config_file
from src.config.paths import get_paths
from src.knowledge.worker import start_knowledge_worker_thread
from src.remote.server import start_remote_relay_sidecar

ALLOWED_RUNTIME_EDITIONS = {"inmem", "postgres", "community"}
DEFAULT_LANGGRAPH_JOBS_PER_WORKER = 4


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
        return _merge_runtime_env({str(key): str(value) for key, value in env_config.items() if value is not None})
    if not isinstance(env_config, str):
        return None

    env_path = _resolve_env_path(config_path, env_config)
    if env_path is None:
        return None

    loaded_env = {key: value for key, value in dotenv_values(env_path).items() if value is not None}
    if not loaded_env:
        return None
    return _merge_runtime_env(loaded_env)


def _parse_int_env(var_name: str, default: int) -> int:
    raw = os.getenv(var_name, str(default)).strip()
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid integer for {var_name}: {raw}") from exc


def _parse_non_negative_int(raw: str, *, source_name: str) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid integer for {source_name}: {raw}") from exc
    if value < 0:
        raise RuntimeError(f"{source_name} must be >= 0: {raw}")
    return value


def _required_env(var_name: str) -> str:
    value = os.getenv(var_name, "").strip()
    if value:
        return value
    raise RuntimeError(f"Missing required env: {var_name}")


def _resolve_config_path() -> Path:
    # `LANGGRAPH_CONFIG` is owned by langgraph_api itself and expects an inline
    # JSON object. OpenAgents keeps its launcher config-path contract on a
    # separate env var so runtime startup can relocate the working directory
    # without colliding with upstream env parsing.
    raw = os.getenv("OPENAGENTS_LANGGRAPH_CONFIG_PATH", "langgraph.json").strip() or "langgraph.json"
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return path


def _has_postgres_runtime_backend() -> bool:
    return importlib.util.find_spec("langgraph_runtime_postgres") is not None


def _load_project_runtime_config() -> dict[str, Any]:
    config_path = resolve_config_file(
        config_path=None,
        env_var_name="OPENAGENTS_CONFIG_PATH",
        default_filenames=("config.yaml",),
    )
    if config_path is None or not config_path.exists():
        return {}

    with config_path.open(encoding="utf-8") as file:
        config_data = yaml.safe_load(file) or {}
    if not isinstance(config_data, dict):
        return {}
    return config_data


def _resolve_runtime_edition() -> str:
    env_value = os.getenv("LANGGRAPH_RUNTIME_EDITION", "").strip()
    if env_value:
        return env_value

    config_data = _load_project_runtime_config()
    runtime_config = config_data.get("runtime")
    if isinstance(runtime_config, dict):
        configured = str(runtime_config.get("edition", "")).strip()
        if configured:
            return configured

    legacy_value = str(config_data.get("langgraph_runtime_edition", "")).strip()
    if legacy_value:
        return legacy_value

    return "inmem"


def _resolve_jobs_per_worker() -> int:
    for env_var in ("OPENAGENTS_LANGGRAPH_JOBS_PER_WORKER", "N_JOBS_PER_WORKER"):
        env_value = os.getenv(env_var, "").strip()
        if env_value:
            return _parse_non_negative_int(env_value, source_name=env_var)

    config_data = _load_project_runtime_config()
    runtime_config = config_data.get("runtime")
    if isinstance(runtime_config, dict):
        configured = runtime_config.get("jobs_per_worker")
        if configured is not None:
            return _parse_non_negative_int(
                str(configured).strip(),
                source_name="runtime.jobs_per_worker",
            )

    legacy_value = config_data.get("langgraph_jobs_per_worker")
    if legacy_value is not None:
        return _parse_non_negative_int(
            str(legacy_value).strip(),
            source_name="langgraph_jobs_per_worker",
        )

    return DEFAULT_LANGGRAPH_JOBS_PER_WORKER


def main() -> None:
    config_path = _resolve_config_path()
    config_data = _load_config(config_path)
    runtime_env = _load_env_from_config(config_path, config_data)

    runtime_edition = _resolve_runtime_edition()
    jobs_per_worker = _resolve_jobs_per_worker()
    if runtime_edition not in ALLOWED_RUNTIME_EDITIONS:
        allowed = "|".join(sorted(ALLOWED_RUNTIME_EDITIONS))
        raise RuntimeError(f"Invalid LANGGRAPH_RUNTIME_EDITION: {runtime_edition} (expected: {allowed})")
    if runtime_edition == "postgres" and not _has_postgres_runtime_backend():
        print("LANGGRAPH_RUNTIME_EDITION=postgres requested, but langgraph_runtime_postgres is not installed. Falling back to inmem runtime.")
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

    print(f"Starting LangGraph with runtime edition: {runtime_edition} (host={host} port={port} jobs_per_worker={jobs_per_worker})")

    # Ensure built-in archived agent files exist before serving requests.
    ensure_builtin_agent_archive("lead_agent", status="dev")
    ensure_builtin_agent_archive("lead_agent", status="prod")
    prime_lead_agent_read_graph_cache()
    start_remote_relay_sidecar()
    start_knowledge_worker_thread()

    run_server(
        host=host,
        port=port,
        reload=False,
        graphs=config_data.get("graphs", {}),
        n_jobs_per_worker=jobs_per_worker,
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
