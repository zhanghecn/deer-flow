import asyncio
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any, Literal

import yaml
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend, LocalShellBackend
from deepagents.backends.protocol import BackendProtocol
from langchain_core.runnables import RunnableConfig
from langgraph_sdk.runtime import ServerRuntime
from pydantic import BaseModel, ConfigDict, Field

from src.agents.lead_agent.prompt import apply_prompt_template
from src.agents.lead_agent.subagents import load_subagent_specs
from src.agents.middlewares.artifacts_middleware import ArtifactsMiddleware
from src.agents.middlewares.max_tokens_recovery_middleware import MaxTokensRecoveryMiddleware
from src.agents.middlewares.thread_data_middleware import ThreadDataMiddleware
from src.agents.middlewares.title_middleware import TitleMiddleware
from src.agents.middlewares.uploads_middleware import UploadsMiddleware
from src.agents.middlewares.view_image_middleware import ViewImageMiddleware
from src.config.agent_runtime_seed import runtime_seed_targets
from src.config.agents_config import AgentConfig, load_agent_config
from src.config.app_config import AppConfig, get_app_config
from src.config.builtin_agents import (
    ensure_builtin_agent_archive,
    normalize_effective_agent_name,
)
from src.config.model_config import ModelConfig
from src.config.paths import VIRTUAL_PATH_PREFIX, Paths, get_paths
from src.config.runtime_db import RuntimeDBStore, get_runtime_db_store
from src.models import create_chat_model
from src.observability import create_agent_trace_callback
from src.reflection.resolvers import resolve_class
from src.sandbox.sandbox_provider import SandboxProvider

logger = logging.getLogger(__name__)
LOCAL_SANDBOX_PROVIDER = "src.sandbox.local:LocalSandboxProvider"
DEFAULT_THREAD_ID = "_default"
ExecutionBackend = Literal["local", "sandbox"]
LEAD_AGENT_INTERRUPT_ON = {"ask_clarification": True}
_LEAD_AGENT_GRAPH_CACHE_MAX = 16
_lead_agent_graph_cache: dict[tuple[object, ...], "LeadAgentGraphCacheEntry"] = {}
_lead_agent_graph_cache_order: list[tuple[object, ...]] = []
_lead_agent_graph_cache_lock = Lock()


class LeadAgentRuntimeContext(BaseModel):
    """Typed runtime context shared between the UI, LangGraph, and tools.

    LangGraph serializes the runtime context into streamed state updates. When the
    graph has no declared context schema, those updates emit noisy serializer
    warnings for every injected field. Declaring the shape here makes the runtime
    contract explicit and keeps per-turn metadata documented in one place.

    We intentionally allow unknown keys because the frontend can attach short-lived
    UI hints that are not semantically important to the graph itself.
    """

    model_config = ConfigDict(
        extra="allow",
        arbitrary_types_allowed=True,
        populate_by_name=True,
    )

    agent_name: str | None = None
    target_agent_name: str | None = None
    agent_status: str | None = None
    model_name: str | None = None
    model: str | None = None
    runtime_model_config: dict[str, Any] | ModelConfig | None = Field(
        default=None,
        alias="model_config",
    )
    thinking_enabled: bool | None = None
    reasoning_effort: Any = None
    subagent_enabled: bool | None = None
    max_concurrent_subagents: int | None = None
    command_name: str | None = None
    command_kind: str | None = None
    command_args: str | None = None
    authoring_actions: list[str] = Field(default_factory=list)
    original_user_input: str | None = None
    mode: str | None = None
    is_plan_mode: bool | None = None
    thread_id: str | None = None
    runtime_thread_id: str | None = Field(default=None, alias="x-thread-id")
    user_id: str | None = None
    runtime_user_id: str | None = Field(default=None, alias="x-user-id")
    langgraph_auth_user_id: str | None = None


@dataclass(frozen=True)
class LeadAgentRequest:
    thinking_enabled: object
    reasoning_effort: object
    requested_model_name: str | None
    subagent_enabled: object
    max_concurrent_subagents: object
    command_name: str | None
    command_kind: str | None
    command_args: str | None
    authoring_actions: tuple[str, ...]
    agent_name: str
    agent_status: str
    thread_id: str | None
    user_id: str | None
    runtime_model_name: str | None

    def requires_direct_authoring_tool(self) -> bool:
        """Return whether this turn is a save/push confirmation command.

        Hard authoring commands such as `/save-agent-to-store` or
        `/push-skill-prod` are explicit user confirmations. Those turns should
        keep the model focused on a single persistence tool call instead of
        branching into authoring skills or delegated subagent work.
        """

        return self.command_kind == "hard" and len(self.authoring_actions) > 0


@dataclass(frozen=True)
class LeadAgentResolution:
    agent_config: AgentConfig
    model_name: str
    model_config: ModelConfig


@dataclass(frozen=True)
class LeadAgentGraphParts:
    """Precomputed pieces used to assemble the deep agent graph.

    Keeping these values in a small carrier object makes `_create_lead_agent`
    read top-down: resolve request, resolve runtime, build graph parts, compile.
    """

    tools: list[Any]
    middleware: list[Any]
    subagents: list[Any] | None
    skill_sources: list[str]
    system_prompt: str


@dataclass(frozen=True)
class LeadAgentGraphCacheEntry:
    graph: Any
    tool_names: tuple[str, ...]


def _clear_lead_agent_graph_cache() -> None:
    with _lead_agent_graph_cache_lock:
        _lead_agent_graph_cache.clear()
        _lead_agent_graph_cache_order.clear()


def _resolve_config_sandbox_provider() -> str | None:
    config_path = AppConfig.resolve_config_path()
    if config_path is None or not config_path.exists():
        return None

    with open(config_path, encoding="utf-8") as f:
        config_data = yaml.safe_load(f) or {}

    sandbox_config = config_data.get("sandbox")
    if not isinstance(sandbox_config, dict):
        return None

    raw_provider = sandbox_config.get("use")
    if not isinstance(raw_provider, str):
        return None

    provider = raw_provider.strip()
    if not provider:
        return None

    if provider.startswith("$"):
        resolved_env = str(os.getenv(provider[1:], "")).strip()
        return resolved_env or None

    return provider


def _resolve_sandbox_provider() -> str:
    env_provider = str(os.getenv("OPENAGENTS_SANDBOX_PROVIDER", "")).strip()
    if env_provider:
        return env_provider

    try:
        return _resolve_config_sandbox_provider() or LOCAL_SANDBOX_PROVIDER
    except Exception as exc:
        logger.warning("Failed to resolve sandbox provider from config. Falling back to local execution backend. Error: %s", exc)
        return LOCAL_SANDBOX_PROVIDER


def _resolve_execution_backend() -> ExecutionBackend:
    return "local" if _resolve_sandbox_provider() == LOCAL_SANDBOX_PROVIDER else "sandbox"


@lru_cache(maxsize=4)
def _get_sandbox_provider(provider_path: str) -> SandboxProvider:
    provider_cls = resolve_class(provider_path, base_class=SandboxProvider)
    return provider_cls()


def _effective_thread_id(thread_id: str | None) -> str:
    return thread_id or DEFAULT_THREAD_ID


def _runtime_agent_root(agent_name: str, status: str) -> str:
    return f"{VIRTUAL_PATH_PREFIX}/agents/{status}/{agent_name.lower()}"


def _runtime_skills_path(agent_name: str, status: str) -> str:
    return f"{_runtime_agent_root(agent_name, status)}/skills/"


def _build_runtime_seed_targets(
    *,
    agent_name: str,
    status: str,
    target_root: str,
    agent_config: AgentConfig | None,
    paths: Paths,
) -> list[tuple[str, bytes]]:
    return runtime_seed_targets(
        agent_name,
        status=status,
        target_root=target_root,
        paths=paths,
        manifest=agent_config,
    )


def _collect_missing_runtime_uploads(
    backend: BackendProtocol,
    runtime_targets: list[tuple[str, bytes]],
) -> list[tuple[str, bytes]]:
    existing_files = backend.download_files([path for path, _ in runtime_targets])
    uploads: list[tuple[str, bytes]] = []

    for (path, content), existing_file in zip(runtime_targets, existing_files, strict=True):
        if existing_file.error == "file_not_found":
            uploads.append((path, content))
            continue
        if existing_file.error is not None:
            raise RuntimeError(f"Failed to inspect runtime file seed target '{path}': {existing_file.error}")

    return uploads


def _upload_runtime_files(
    backend: BackendProtocol,
    runtime_targets: list[tuple[str, bytes]],
) -> None:
    if not runtime_targets:
        return

    upload_results = backend.upload_files(runtime_targets)
    errors = [f"{result.path}: {result.error}" for result in upload_results if result.error is not None]
    if errors:
        raise RuntimeError(f"Failed to seed runtime definition files: {', '.join(errors)}")


def _seed_runtime_materials(
    backend: BackendProtocol,
    *,
    agent_name: str,
    status: str,
    agent_config: AgentConfig | None,
) -> None:
    paths = get_paths()
    ensure_builtin_agent_archive(agent_name, status=status, paths=paths)
    runtime_targets = _build_runtime_seed_targets(
        agent_name=agent_name,
        status=status,
        target_root=_runtime_agent_root(agent_name, status),
        agent_config=agent_config,
        paths=paths,
    )
    missing_uploads = _collect_missing_runtime_uploads(backend, runtime_targets)
    _upload_runtime_files(backend, missing_uploads)


def _normalize_route_prefix(path: str) -> str:
    normalized = str(path).strip()
    if not normalized.startswith("/"):
        raise ValueError(f"Backend route must be absolute, got {path!r}")
    return normalized.rstrip("/") + "/"


def _resolve_shared_skills_mount(paths: Paths) -> tuple[str, str] | None:
    try:
        shared_skills_dir = paths.skills_dir
    except RuntimeError:
        return None

    if not shared_skills_dir.exists():
        return None

    container_path = str(get_app_config().skills.container_path or "").strip()
    if not container_path:
        return None

    try:
        return str(shared_skills_dir), _normalize_route_prefix(container_path)
    except ValueError as exc:
        logger.warning("Ignoring invalid shared skills container path %r: %s", container_path, exc)
        return None


def _build_local_workspace_backend(
    user_data_dir: str,
    *,
    shared_skills_mount: tuple[str, str] | None = None,
) -> BackendProtocol:
    execute_path_mappings: dict[str, str] | None = None
    routes: dict[str, BackendProtocol] = {}

    if shared_skills_mount is not None:
        shared_skills_dir, route_prefix = shared_skills_mount
        execute_path_mappings = {route_prefix.rstrip("/"): shared_skills_dir}
        routes[route_prefix] = FilesystemBackend(
            root_dir=shared_skills_dir,
            virtual_mode=True,
        )

    workspace_backend = LocalShellBackend(
        root_dir=user_data_dir,
        virtual_mode=True,
        inherit_env=True,
        timeout=600,
        execute_path_mappings=execute_path_mappings,
    )

    if routes:
        return CompositeBackend(default=workspace_backend, routes=routes)
    return workspace_backend


def _build_sandbox_workspace_backend(thread_id: str | None) -> BackendProtocol:
    provider_path = _resolve_sandbox_provider()
    provider = _get_sandbox_provider(provider_path)
    sandbox_id = provider.acquire(_effective_thread_id(thread_id))
    sandbox = provider.get(sandbox_id)
    if sandbox is None:
        raise RuntimeError(f"Sandbox provider '{provider_path}' returned sandbox id '{sandbox_id}' but no sandbox instance.")
    return sandbox


def _build_workspace_backend(
    *,
    user_data_dir: str,
    thread_id: str | None,
    paths: Paths | None = None,
) -> BackendProtocol:
    if _resolve_execution_backend() == "sandbox":
        return _build_sandbox_workspace_backend(thread_id)
    resolved_paths = paths or get_paths()
    return _build_local_workspace_backend(
        user_data_dir,
        shared_skills_mount=_resolve_shared_skills_mount(resolved_paths),
    )


def _build_read_context_backend(thread_id: str | None) -> BackendProtocol:
    paths = get_paths()
    effective_thread_id = _effective_thread_id(thread_id)
    user_data_dir = str(paths.sandbox_user_data_dir(effective_thread_id))
    return _build_local_workspace_backend(
        user_data_dir,
        shared_skills_mount=_resolve_shared_skills_mount(paths),
    )


def build_backend(
    thread_id: str | None,
    agent_name: str | None,
    status: str = "dev",
    agent_config: AgentConfig | None = None,
):
    """Build the runtime backend for the agent.

    The backend provides:
    - Per-thread runtime workspace under `/mnt/user-data`
    - Thread-local copies of archived agent definition files (`AGENTS.md`, `config.yaml`, copied `skills/`)
    - Local-debug compatibility routing for shared skills under `/mnt/skills` when execution is not sandboxed

    Runtime execution mode is resolved from Python sandbox configuration.
    """
    paths = get_paths()
    effective_agent_name = normalize_effective_agent_name(agent_name)
    ensure_builtin_agent_archive(effective_agent_name, status=status, paths=paths)

    # === Runtime layer (per-thread isolated) ===
    effective_thread_id = _effective_thread_id(thread_id)
    user_data_dir = str(paths.sandbox_user_data_dir(effective_thread_id))

    workspace_backend = _build_workspace_backend(
        user_data_dir=user_data_dir,
        thread_id=effective_thread_id,
        paths=paths,
    )
    _seed_runtime_materials(
        workspace_backend,
        agent_name=effective_agent_name,
        status=status,
        agent_config=agent_config,
    )

    return workspace_backend


def _build_openagents_middlewares(model_config: ModelConfig):
    """Build openagents specific extra middlewares (not handled by deepagents).

    deepagents already provides:
    - PatchToolCallsMiddleware (replaces DanglingToolCallMiddleware)
    - SummarizationMiddleware (replaces our custom one)
    - TodoListMiddleware (replaces our custom one)
    - MemoryMiddleware (replaces our custom one)
    - SubAgentMiddleware (replaces SubagentExecutor + SubagentLimitMiddleware)
    - SkillsMiddleware (replaces SkillsLoader)
    - FilesystemMiddleware (replaces sandbox tools: execute, ls, read_file, write_file, str_replace, edit_file, glob, grep)

    We only keep openagents specific middlewares:
    - ThreadDataMiddleware: Creates per-thread workspace directories
    - UploadsMiddleware: Tracks and injects newly uploaded files
    - TitleMiddleware: Auto-generates thread title
    - ViewImageMiddleware: Injects base64 image data (conditional on vision support)
    """
    middlewares = [
        ArtifactsMiddleware(),
        ThreadDataMiddleware(),
        UploadsMiddleware(),
        TitleMiddleware(),
        MaxTokensRecoveryMiddleware(),
    ]

    if model_config.supports_vision:
        middlewares.append(ViewImageMiddleware())

    return middlewares


def _path_mtime_ns(path: Path) -> int:
    try:
        return path.stat().st_mtime_ns
    except FileNotFoundError:
        return 0


def _lead_agent_graph_cache_key(
    *,
    request: LeadAgentRequest,
    resolution: LeadAgentResolution,
    prepare_runtime_resources: bool,
) -> tuple[object, ...]:
    paths = get_paths()
    return (
        request,
        resolution.model_name,
        prepare_runtime_resources,
        _path_mtime_ns(paths.agent_config_file(request.agent_name, request.agent_status)),
        _path_mtime_ns(paths.agent_agents_md_file(request.agent_name, request.agent_status)),
    )


def _get_cached_lead_agent_graph(
    cache_key: tuple[object, ...],
) -> LeadAgentGraphCacheEntry | None:
    with _lead_agent_graph_cache_lock:
        entry = _lead_agent_graph_cache.get(cache_key)
        if entry is None:
            return None
        if cache_key in _lead_agent_graph_cache_order:
            _lead_agent_graph_cache_order.remove(cache_key)
        _lead_agent_graph_cache_order.append(cache_key)
        return entry


def _store_cached_lead_agent_graph(
    cache_key: tuple[object, ...],
    *,
    graph: Any,
    tool_names: list[str],
) -> LeadAgentGraphCacheEntry:
    entry = LeadAgentGraphCacheEntry(graph=graph, tool_names=tuple(tool_names))
    with _lead_agent_graph_cache_lock:
        _lead_agent_graph_cache[cache_key] = entry
        if cache_key in _lead_agent_graph_cache_order:
            _lead_agent_graph_cache_order.remove(cache_key)
        _lead_agent_graph_cache_order.append(cache_key)
        while len(_lead_agent_graph_cache_order) > _LEAD_AGENT_GRAPH_CACHE_MAX:
            evicted_key = _lead_agent_graph_cache_order.pop(0)
            _lead_agent_graph_cache.pop(evicted_key, None)
    return entry


def _parse_runtime_model_config(payload: object) -> str | None:
    if payload is None:
        return None
    if isinstance(payload, ModelConfig):
        return payload.name
    if isinstance(payload, dict):
        raw_name = payload.get("name")
        if raw_name is None:
            raise ValueError("`configurable.model_config.name` is required.")
        name = str(raw_name).strip()
        if not name:
            raise ValueError("`configurable.model_config.name` must be a non-empty string.")
        return name
    raise ValueError("`configurable.model_config` must be an object with `name`.")


def _extract_runtime_context(runtime: ServerRuntime | None) -> dict:
    if runtime is None:
        return {}
    execution_runtime = runtime.execution_runtime
    if execution_runtime is None:
        return {}
    context = execution_runtime.context
    if isinstance(context, dict):
        return dict(context)
    return {}


def _update_runtime_context(runtime: ServerRuntime | None, **values: object) -> None:
    if runtime is None:
        return
    execution_runtime = runtime.execution_runtime
    if execution_runtime is None:
        return
    context = execution_runtime.context
    if not isinstance(context, dict):
        return
    for key, value in values.items():
        if value is not None:
            context[key] = value


def _coerce_optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_optional_str_list(value: object) -> tuple[str, ...]:
    if value is None or not isinstance(value, list):
        return ()
    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = _coerce_optional_str(item)
        if text is None or text in seen:
            continue
        normalized.append(text)
        seen.add(text)
    return tuple(normalized)


def _load_configurable_payload(config: RunnableConfig, runtime: ServerRuntime | None) -> dict:
    configurable_payload = config.get("configurable", {})
    if configurable_payload is None:
        configurable_payload = {}
    if not isinstance(configurable_payload, dict):
        raise ValueError("`configurable` must be an object.")

    merged_payload = _extract_runtime_context(runtime)
    merged_payload.update(configurable_payload)
    return merged_payload


def _resolve_agent_status(raw_status: object) -> str:
    return _coerce_optional_str(raw_status) or "dev"


def _extract_runtime_user_id(runtime: ServerRuntime | None) -> str | None:
    if runtime is None:
        return None
    user = getattr(runtime, "user", None)
    if user is None:
        return None
    identity = getattr(user, "identity", None)
    return _coerce_optional_str(identity)


def _resolve_request_user_id(cfg: dict, runtime: ServerRuntime | None) -> str | None:
    runtime_user_id = _extract_runtime_user_id(runtime)
    return _coerce_optional_str(cfg.get("user_id") or cfg.get("x-user-id") or cfg.get("langgraph_auth_user_id") or runtime_user_id)


def _assert_thread_access(
    *,
    db_store: RuntimeDBStore,
    thread_id: str | None,
    user_id: str | None,
) -> None:
    if thread_id and not user_id:
        raise ValueError("Thread-scoped requests require user identity. Provide `context.user_id`/`configurable.user_id`, forward `x-user-id` through LangGraph configurable headers, or configure LangGraph custom auth.")

    if thread_id:
        assert user_id is not None
        db_store.assert_thread_access(thread_id=thread_id, user_id=user_id)


def _persist_thread_runtime(
    *,
    db_store: RuntimeDBStore,
    thread_id: str | None,
    user_id: str | None,
    model_name: str,
    agent_name: str,
) -> None:
    if not thread_id:
        return

    assert user_id is not None
    db_store.save_thread_runtime(
        thread_id=thread_id,
        user_id=user_id,
        model_name=model_name,
        agent_name=agent_name,
    )


def _assert_agent_memory_access(
    *,
    agent_config: AgentConfig,
    user_id: str | None,
) -> None:
    if agent_config.memory.enabled and not user_id:
        raise ValueError(f"Agent '{agent_config.name}' has memory enabled and requires user identity.")


def _load_agent_tools(
    *,
    agent_config: AgentConfig,
    model_name: str,
    model_supports_vision: bool,
    agent_status: str,
    authoring_actions: tuple[str, ...],
):
    from src.tools import get_available_tools

    return get_available_tools(
        model_name=model_name,
        model_supports_vision=model_supports_vision,
        groups=agent_config.tool_groups,
        mcp_servers=agent_config.mcp_servers,
        agent_status=agent_status,
        authoring_actions=list(authoring_actions),
    )


def _resolve_run_model(
    *,
    requested_model_name: str | None,
    runtime_model_name: str | None,
    agent_config: AgentConfig | None,
    thread_id: str | None,
    user_id: str | None,
    db_store: RuntimeDBStore,
) -> tuple[str, ModelConfig]:
    """Resolve the run model with strict precedence and limited legacy-thread fallback."""
    agent_model_name = agent_config.model if agent_config and agent_config.model else None
    if requested_model_name and agent_model_name and requested_model_name != agent_model_name:
        raise ValueError(f"Model conflict: requested model '{requested_model_name}' does not match agent model '{agent_model_name}'.")
    if runtime_model_name and agent_model_name and runtime_model_name != agent_model_name:
        raise ValueError(f"Model conflict: requested model '{runtime_model_name}' does not match agent model '{agent_model_name}'.")
    if requested_model_name and runtime_model_name and requested_model_name != runtime_model_name:
        raise ValueError("Model conflict: `configurable.model_name` and `configurable.model_config.name` must match.")

    persisted_thread_model_name: str | None = None
    if thread_id and user_id:
        persisted_thread_model_name = db_store.get_thread_runtime_model(thread_id=thread_id, user_id=user_id)

    model_name = requested_model_name or runtime_model_name or agent_model_name or persisted_thread_model_name
    if not model_name:
        raise ValueError("No model resolved for this run. Provide `configurable.model_name`/`model` or `configurable.model_config.name`, set `agent.model`, or ensure this thread has a persisted runtime model.")

    model_config = db_store.get_model(model_name)
    if model_config is None:
        if not requested_model_name and not runtime_model_name and not agent_model_name and persisted_thread_model_name:
            fallback_model = db_store.get_any_enabled_model()
            if fallback_model is not None:
                logger.warning(
                    "Persisted thread model '%s' is unavailable; falling back to enabled model '%s' for thread '%s'.",
                    persisted_thread_model_name,
                    fallback_model.name,
                    thread_id,
                )
                return fallback_model.name, fallback_model
        raise ValueError(f"Resolved model '{model_name}' is not available in database or is disabled.")
    return model_name, model_config


def _load_agent_runtime_config(
    *,
    agent_name: str,
    agent_status: str,
) -> AgentConfig | None:
    paths = get_paths()
    ensure_builtin_agent_archive(agent_name, status=agent_status, paths=paths)

    try:
        file_config = load_agent_config(agent_name, status=agent_status, paths=paths)
    except FileNotFoundError:
        file_config = None

    if file_config is not None:
        return file_config

    raise ValueError(f"Agent '{agent_name}' with status '{agent_status}' not found in archive.")


def _merge_callbacks(
    existing_callbacks: object,
    callback: object,
) -> list:
    if existing_callbacks is None:
        return [callback]
    if isinstance(existing_callbacks, list):
        return [*existing_callbacks, callback]
    if isinstance(existing_callbacks, tuple):
        return [*existing_callbacks, callback]
    return [existing_callbacks, callback]


def _build_run_metadata(
    *,
    agent_name: str,
    model_name: str,
    thinking_enabled: object,
    reasoning_effort: object,
    subagent_enabled: object,
    thread_id: str | None,
    user_id: str | None,
    tool_names: list[str],
) -> dict[str, object]:
    return {
        "agent_name": agent_name,
        "model_name": model_name,
        "thinking_enabled": thinking_enabled,
        "reasoning_effort": reasoning_effort,
        "subagent_enabled": subagent_enabled,
        "thread_id": thread_id,
        "user_id": user_id,
        "tool_names": tool_names,
        "tool_count": len(tool_names),
    }


def _resolve_lead_agent_request(
    config: RunnableConfig,
    runtime: ServerRuntime | None,
) -> LeadAgentRequest:
    cfg = _load_configurable_payload(config, runtime)
    return LeadAgentRequest(
        thinking_enabled=cfg.get("thinking_enabled", True),
        reasoning_effort=cfg.get("reasoning_effort"),
        requested_model_name=_coerce_optional_str(cfg.get("model_name") or cfg.get("model")),
        subagent_enabled=cfg.get("subagent_enabled", False),
        max_concurrent_subagents=cfg.get("max_concurrent_subagents", 3),
        command_name=_coerce_optional_str(cfg.get("command_name")),
        command_kind=_coerce_optional_str(cfg.get("command_kind")),
        command_args=_coerce_optional_str(cfg.get("command_args")),
        authoring_actions=_coerce_optional_str_list(cfg.get("authoring_actions")),
        agent_name=normalize_effective_agent_name(_coerce_optional_str(cfg.get("agent_name"))),
        agent_status=_resolve_agent_status(cfg.get("agent_status", "dev")),
        thread_id=_coerce_optional_str(cfg.get("thread_id") or cfg.get("x-thread-id")),
        user_id=_resolve_request_user_id(cfg, runtime),
        runtime_model_name=_parse_runtime_model_config(cfg.get("model_config")),
    )


def _resolve_lead_agent_runtime(
    *,
    request: LeadAgentRequest,
    db_store: RuntimeDBStore,
) -> LeadAgentResolution:
    _assert_thread_access(
        db_store=db_store,
        thread_id=request.thread_id,
        user_id=request.user_id,
    )
    agent_config = _load_agent_runtime_config(
        agent_name=request.agent_name,
        agent_status=request.agent_status,
    )
    _assert_agent_memory_access(agent_config=agent_config, user_id=request.user_id)
    model_name, model_config = _resolve_run_model(
        requested_model_name=request.requested_model_name,
        runtime_model_name=request.runtime_model_name,
        agent_config=agent_config,
        thread_id=request.thread_id,
        user_id=request.user_id,
        db_store=db_store,
    )
    _persist_thread_runtime(
        db_store=db_store,
        thread_id=request.thread_id,
        user_id=request.user_id,
        model_name=model_name,
        agent_name=request.agent_name,
    )
    return LeadAgentResolution(
        agent_config=agent_config,
        model_name=model_name,
        model_config=model_config,
    )


def _update_request_runtime_context(
    runtime: ServerRuntime | None,
    request: LeadAgentRequest,
) -> None:
    _update_runtime_context(
        runtime,
        thread_id=request.thread_id,
        user_id=request.user_id,
        **{
            "x-thread-id": request.thread_id,
            "x-user-id": request.user_id,
            "agent_name": request.agent_name,
            "agent_status": request.agent_status,
        },
    )


def _attach_trace_metadata(
    config: RunnableConfig,
    *,
    request: LeadAgentRequest,
    model_name: str,
    tool_names: list[str],
) -> None:
    if "metadata" not in config:
        config["metadata"] = {}

    run_metadata = _build_run_metadata(
        agent_name=request.agent_name,
        model_name=model_name,
        thinking_enabled=request.thinking_enabled,
        reasoning_effort=request.reasoning_effort,
        subagent_enabled=request.subagent_enabled,
        thread_id=request.thread_id,
        user_id=request.user_id,
        tool_names=tool_names,
    )
    config["metadata"].update(run_metadata)

    trace_callback = create_agent_trace_callback(
        user_id=request.user_id,
        thread_id=request.thread_id,
        agent_name=request.agent_name,
        model_name=model_name,
        metadata=run_metadata,
    )
    if trace_callback is None:
        return

    config["callbacks"] = _merge_callbacks(config.get("callbacks"), trace_callback)
    config["metadata"]["trace_id"] = trace_callback.trace_id


def _extract_tool_names(tools: object) -> list[str]:
    if not isinstance(tools, list):
        return []
    names = [getattr(tool, "name", None) for tool in tools]
    return [name for name in names if isinstance(name, str) and name.strip()]


def _resolve_agent_backend(
    *,
    request: LeadAgentRequest,
    agent_config: AgentConfig,
    prepare_runtime_resources: bool,
) -> BackendProtocol:
    if not prepare_runtime_resources:
        return _build_read_context_backend(request.thread_id)
    return build_backend(
        request.thread_id,
        request.agent_name,
        request.agent_status,
        agent_config,
    )


def _build_agent_subagents(
    *,
    request: LeadAgentRequest,
    tools: object,
):
    if request.requires_direct_authoring_tool():
        return None
    if not request.subagent_enabled:
        return None
    return load_subagent_specs(
        tools,
        agent_name=request.agent_name,
        agent_status=request.agent_status,
    )


def _should_prepare_runtime_resources(runtime: ServerRuntime | None) -> bool:
    if runtime is None:
        return True
    return getattr(runtime, "execution_runtime", None) is not None


def _assert_requested_model_capabilities(
    *,
    request: LeadAgentRequest,
    resolution: LeadAgentResolution,
) -> None:
    """Validate model features after the final model has been resolved.

    Request parsing only tells us what the caller asked for. Capability checks
    belong here, after agent defaults, thread-persisted runtime settings, and
    explicit request overrides have been merged into one resolved model choice.
    """

    if request.thinking_enabled and not resolution.model_config.supports_thinking:
        raise ValueError(f"Thinking mode is enabled but model '{resolution.model_name}' does not support thinking.")


def _build_skill_sources(request: LeadAgentRequest) -> list[str]:
    """Return Deep Agents skill directories for this turn.

    Skills are progressively disclosed from the archived runtime copy under the
    agent workspace. Direct save/push confirmations intentionally skip skill
    loading so the model stays focused on the explicit persistence tool call
    that the user just approved.
    """

    if request.requires_direct_authoring_tool():
        return []
    return [_runtime_skills_path(request.agent_name, request.agent_status)]


def _build_system_prompt(
    *,
    request: LeadAgentRequest,
    resolution: LeadAgentResolution,
) -> str:
    """Build the lead-agent prompt from resolved runtime state.

    Keeping prompt assembly in one function avoids scattering prompt inputs
    across `_create_lead_agent`, which makes later prompt changes easier to
    audit against the runtime contract.
    """

    return apply_prompt_template(
        subagent_enabled=bool(request.subagent_enabled),
        max_concurrent_subagents=int(request.max_concurrent_subagents),
        user_id=request.user_id,
        agent_name=request.agent_name,
        agent_status=request.agent_status,
        memory_config=resolution.agent_config.memory,
        command_name=request.command_name,
        command_kind=request.command_kind,
        command_args=request.command_args,
        authoring_actions=request.authoring_actions,
    )


def _build_graph_parts(
    *,
    request: LeadAgentRequest,
    resolution: LeadAgentResolution,
) -> LeadAgentGraphParts:
    """Assemble request-specific Deep Agents graph inputs.

    This groups together the pieces that materially change the compiled graph:
    tool set, middleware, prompt, subagents, and skills. The resulting object is
    easy to inspect in tests and keeps `_create_lead_agent` as a short
    orchestration narrative instead of a long construction routine.
    """

    tools = _load_agent_tools(
        agent_config=resolution.agent_config,
        model_name=resolution.model_name,
        model_supports_vision=resolution.model_config.supports_vision,
        agent_status=request.agent_status,
        authoring_actions=request.authoring_actions,
    )
    return LeadAgentGraphParts(
        tools=tools,
        middleware=_build_openagents_middlewares(resolution.model_config),
        subagents=_build_agent_subagents(request=request, tools=tools),
        skill_sources=_build_skill_sources(request),
        system_prompt=_build_system_prompt(request=request, resolution=resolution),
    )


def _create_lead_agent(
    config: RunnableConfig,
    runtime: ServerRuntime | None = None,
    *,
    prepare_runtime_resources: bool,
):
    request = _resolve_lead_agent_request(config, runtime)
    db_store = get_runtime_db_store()
    resolution = _resolve_lead_agent_runtime(
        request=request,
        db_store=db_store,
    )
    _assert_requested_model_capabilities(
        request=request,
        resolution=resolution,
    )

    logger.info(
        "Create Agent(%s) -> thinking_enabled: %s, reasoning_effort: %s, model_name: %s, subagent_enabled: %s, agent_status: %s",
        request.agent_name,
        request.thinking_enabled,
        request.reasoning_effort,
        resolution.model_name,
        request.subagent_enabled,
        request.agent_status,
    )

    _update_request_runtime_context(runtime, request)
    cache_key = _lead_agent_graph_cache_key(
        request=request,
        resolution=resolution,
        prepare_runtime_resources=prepare_runtime_resources,
    )
    cached_entry = _get_cached_lead_agent_graph(cache_key)
    if cached_entry is not None:
        _attach_trace_metadata(
            config,
            request=request,
            model_name=resolution.model_name,
            tool_names=list(cached_entry.tool_names),
        )
        return cached_entry.graph

    backend = _resolve_agent_backend(
        request=request,
        agent_config=resolution.agent_config,
        prepare_runtime_resources=prepare_runtime_resources,
    )
    graph_parts = _build_graph_parts(
        request=request,
        resolution=resolution,
    )
    tool_names = _extract_tool_names(graph_parts.tools)
    _attach_trace_metadata(
        config,
        request=request,
        model_name=resolution.model_name,
        tool_names=tool_names,
    )

    graph = create_deep_agent(
        model=create_chat_model(
            name=resolution.model_name,
            thinking_enabled=bool(request.thinking_enabled),
            reasoning_effort=request.reasoning_effort,
            runtime_model_config=resolution.model_config,
        ),
        tools=graph_parts.tools,
        system_prompt=graph_parts.system_prompt,
        middleware=graph_parts.middleware,
        subagents=graph_parts.subagents,
        skills=graph_parts.skill_sources,
        backend=backend,
        context_schema=LeadAgentRuntimeContext,
        interrupt_on=LEAD_AGENT_INTERRUPT_ON,
        name=request.agent_name,
    )
    return _store_cached_lead_agent_graph(
        cache_key,
        graph=graph,
        tool_names=tool_names,
    ).graph


async def make_lead_agent(config: RunnableConfig, runtime: ServerRuntime | None = None):
    prepare_runtime_resources = _should_prepare_runtime_resources(runtime)
    return await asyncio.to_thread(
        _create_lead_agent,
        config,
        runtime,
        prepare_runtime_resources=prepare_runtime_resources,
    )
