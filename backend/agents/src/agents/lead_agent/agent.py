import logging
import os
from functools import lru_cache
from typing import Literal

import yaml
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, LocalShellBackend
from deepagents.backends.protocol import BackendProtocol
from langchain_core.runnables import RunnableConfig
from langgraph_sdk.runtime import ServerRuntime

from src.agents.lead_agent.prompt import apply_prompt_template
from src.agents.lead_agent.subagents import load_subagent_specs
from src.agents.middlewares.artifacts_middleware import ArtifactsMiddleware
from src.agents.middlewares.thread_data_middleware import ThreadDataMiddleware
from src.agents.middlewares.title_middleware import TitleMiddleware
from src.agents.middlewares.uploads_middleware import UploadsMiddleware
from src.agents.middlewares.view_image_middleware import ViewImageMiddleware
from src.config.agent_runtime_seed import runtime_seed_targets
from src.config.agents_config import load_agent_config
from src.config.app_config import AppConfig
from src.config.builtin_agents import (
    ensure_builtin_agent_archive,
    normalize_effective_agent_name,
)
from src.config.model_config import ModelConfig
from src.config.paths import VIRTUAL_PATH_PREFIX, Paths, get_paths
from src.config.runtime_db import DBAgentConfig, RuntimeDBStore, get_runtime_db_store
from src.models import create_chat_model
from src.observability import create_agent_trace_callback
from src.reflection.resolvers import resolve_class
from src.sandbox.sandbox_provider import SandboxProvider

logger = logging.getLogger(__name__)
LOCAL_SANDBOX_PROVIDER = "src.sandbox.local:LocalSandboxProvider"
DEFAULT_THREAD_ID = "_default"
ExecutionBackend = Literal["local", "sandbox"]


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
    agent_config: DBAgentConfig | None,
    paths: Paths,
) -> list[tuple[str, bytes]]:
    return runtime_seed_targets(
        agent_name,
        status=status,
        target_root=target_root,
        paths=paths,
        manifest=agent_config,
        revision=agent_config.revision if agent_config is not None else None,
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
    agent_config: DBAgentConfig | None,
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


def _build_local_workspace_backend(user_data_dir: str) -> LocalShellBackend:
    return LocalShellBackend(
        root_dir=user_data_dir,
        virtual_mode=True,
        inherit_env=True,
        timeout=600,
    )


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
) -> BackendProtocol:
    if _resolve_execution_backend() == "sandbox":
        return _build_sandbox_workspace_backend(thread_id)
    return _build_local_workspace_backend(user_data_dir)


def build_backend(
    thread_id: str | None,
    agent_name: str | None,
    status: str = "dev",
    agent_config: DBAgentConfig | None = None,
):
    """Build a CompositeBackend for the agent.

    The backend provides:
    - Per-thread runtime workspace under `/mnt/user-data`
    - Thread-local copies of archived agent definition files (`AGENTS.md`, `config.yaml`, copied `skills/`)

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
    )
    _seed_runtime_materials(
        workspace_backend,
        agent_name=effective_agent_name,
        status=status,
        agent_config=agent_config,
    )

    return CompositeBackend(default=workspace_backend, routes={})


def _build_openagents_middlewares(model_config: ModelConfig):
    """Build openagents specific extra middlewares (not handled by deepagents).

    deepagents already provides:
    - PatchToolCallsMiddleware (replaces DanglingToolCallMiddleware)
    - SummarizationMiddleware (replaces our custom one)
    - TodoListMiddleware (replaces our custom one)
    - MemoryMiddleware (replaces our custom one)
    - SubAgentMiddleware (replaces SubagentExecutor + SubagentLimitMiddleware)
    - SkillsMiddleware (replaces SkillsLoader)
    - FilesystemMiddleware (replaces sandbox tools: bash, ls, read_file, write_file, str_replace, edit_file, glob, grep)

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
    ]

    if model_config.supports_vision:
        middlewares.append(ViewImageMiddleware())

    return middlewares


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
    return _coerce_optional_str(
        cfg.get("user_id")
        or cfg.get("x-user-id")
        or cfg.get("langgraph_auth_user_id")
        or runtime_user_id
    )


def _assert_thread_access(
    *,
    db_store: RuntimeDBStore,
    thread_id: str | None,
    user_id: str | None,
) -> None:
    if thread_id and not user_id:
        raise ValueError(
            "Thread-scoped requests require user identity. Provide `context.user_id`/`configurable.user_id`, "
            "forward `x-user-id` through LangGraph configurable headers, or configure LangGraph custom auth."
        )

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


def _load_agent_tools(
    *,
    agent_config: DBAgentConfig,
    model_name: str,
    model_supports_vision: bool,
):
    from src.tools import get_available_tools

    return get_available_tools(
        model_name=model_name,
        model_supports_vision=model_supports_vision,
        groups=agent_config.tool_groups,
        mcp_servers=agent_config.mcp_servers,
    )


def _resolve_run_model(
    *,
    requested_model_name: str | None,
    runtime_model_name: str | None,
    agent_config: DBAgentConfig | None,
    thread_id: str | None,
    user_id: str | None,
    db_store: RuntimeDBStore,
) -> tuple[str, ModelConfig]:
    """Resolve run model with explicit precedence and no implicit fallback."""
    agent_model_name = agent_config.model if agent_config and agent_config.model else None
    if requested_model_name and agent_model_name and requested_model_name != agent_model_name:
        raise ValueError(
            f"Model conflict: requested model '{requested_model_name}' does not match agent model '{agent_model_name}'."
        )
    if runtime_model_name and agent_model_name and runtime_model_name != agent_model_name:
        raise ValueError(
            f"Model conflict: requested model '{runtime_model_name}' does not match agent model '{agent_model_name}'."
        )
    if requested_model_name and runtime_model_name and requested_model_name != runtime_model_name:
        raise ValueError(
            "Model conflict: `configurable.model_name` and `configurable.model_config.name` must match."
        )

    persisted_thread_model_name: str | None = None
    if thread_id and user_id:
        persisted_thread_model_name = db_store.get_thread_runtime_model(thread_id=thread_id, user_id=user_id)

    model_name = requested_model_name or runtime_model_name or agent_model_name or persisted_thread_model_name
    if not model_name:
        raise ValueError(
            "No model resolved for this run. Provide `configurable.model_name`/`model` or "
            "`configurable.model_config.name`, set `agent.model`, or ensure this thread has "
            "a persisted runtime model."
        )

    model_config = db_store.get_model(model_name)
    if model_config is None:
        raise ValueError(
            f"Resolved model '{model_name}' is not available in database or is disabled."
        )
    return model_name, model_config


def _load_agent_runtime_config(
    *,
    agent_name: str,
    agent_status: str,
    db_store: RuntimeDBStore,
) -> DBAgentConfig | None:
    config = db_store.get_agent(agent_name, agent_status)
    if config is not None:
        return config

    ensure_builtin_agent_archive(agent_name, status=agent_status)

    try:
        file_config = load_agent_config(agent_name, status=agent_status)
    except FileNotFoundError:
        file_config = None

    if file_config is not None:
        return DBAgentConfig(
            name=file_config.name,
            status=file_config.status,
            model=file_config.model,
            tool_groups=file_config.tool_groups,
            mcp_servers=file_config.mcp_servers,
            agents_md_path=file_config.agents_md_path,
            skill_refs=file_config.skill_refs,
            revision=None,
        )

    raise ValueError(f"Agent '{agent_name}' with status '{agent_status}' not found in database or archive.")


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
) -> dict[str, object]:
    return {
        "agent_name": agent_name,
        "model_name": model_name,
        "thinking_enabled": thinking_enabled,
        "reasoning_effort": reasoning_effort,
        "subagent_enabled": subagent_enabled,
        "thread_id": thread_id,
        "user_id": user_id,
    }


def make_lead_agent(config: RunnableConfig, runtime: ServerRuntime | None = None):
    cfg = _load_configurable_payload(config, runtime)

    thinking_enabled = cfg.get("thinking_enabled", True)
    reasoning_effort = cfg.get("reasoning_effort")
    requested_model_name = _coerce_optional_str(cfg.get("model_name") or cfg.get("model"))
    subagent_enabled = cfg.get("subagent_enabled", False)
    max_concurrent_subagents = cfg.get("max_concurrent_subagents", 3)
    agent_name = normalize_effective_agent_name(_coerce_optional_str(cfg.get("agent_name")))
    agent_status = _resolve_agent_status(cfg.get("agent_status", "dev"))

    thread_id = _coerce_optional_str(cfg.get("thread_id") or cfg.get("x-thread-id"))
    user_id = _resolve_request_user_id(cfg, runtime)
    runtime_model_payload = cfg.get("model_config")

    db_store = get_runtime_db_store()
    _assert_thread_access(db_store=db_store, thread_id=thread_id, user_id=user_id)

    runtime_model_name = _parse_runtime_model_config(runtime_model_payload)
    agent_config = _load_agent_runtime_config(agent_name=agent_name, agent_status=agent_status, db_store=db_store)
    model_name, model_config = _resolve_run_model(
        requested_model_name=requested_model_name,
        runtime_model_name=runtime_model_name,
        agent_config=agent_config,
        thread_id=thread_id,
        user_id=user_id,
        db_store=db_store,
    )
    _persist_thread_runtime(
        db_store=db_store,
        thread_id=thread_id,
        user_id=user_id,
        model_name=model_name,
        agent_name=agent_name,
    )

    if thinking_enabled and not model_config.supports_thinking:
        raise ValueError(f"Thinking mode is enabled but model '{model_name}' does not support thinking.")

    logger.info(
        "Create Agent(%s) -> thinking_enabled: %s, reasoning_effort: %s, model_name: %s, subagent_enabled: %s, agent_status: %s",
        agent_name,
        thinking_enabled,
        reasoning_effort,
        model_name,
        subagent_enabled,
        agent_status,
    )

    _update_runtime_context(
        runtime,
        thread_id=thread_id,
        user_id=user_id,
        **{
            "x-thread-id": thread_id,
            "x-user-id": user_id,
            "agent_name": agent_name,
            "agent_status": agent_status,
        },
    )

    # Inject run metadata for observability
    if "metadata" not in config:
        config["metadata"] = {}
    run_metadata = _build_run_metadata(
        agent_name=agent_name,
        model_name=model_name,
        thinking_enabled=thinking_enabled,
        reasoning_effort=reasoning_effort,
        subagent_enabled=subagent_enabled,
        thread_id=thread_id,
        user_id=user_id,
    )
    config["metadata"].update(run_metadata)

    trace_callback = create_agent_trace_callback(
        user_id=user_id,
        thread_id=thread_id,
        agent_name=agent_name,
        model_name=model_name,
        metadata=run_metadata,
    )
    if trace_callback is not None:
        config["callbacks"] = _merge_callbacks(config.get("callbacks"), trace_callback)
        config["metadata"]["trace_id"] = trace_callback.trace_id

    # Build CompositeBackend (replaces LocalSandbox + replace_virtual_path)
    backend = build_backend(
        thread_id,
        agent_name,
        agent_status,
        agent_config,
    )

    # Skills sources for deepagents SkillsMiddleware come from the archived copy
    # materialized under the agent's own runtime directory.
    skills_sources = [_runtime_skills_path(agent_name, agent_status)]

    # Community tools + MCP tools. Filesystem tools are provided by deepagents.
    tools = _load_agent_tools(
        agent_config=agent_config,
        model_name=model_name,
        model_supports_vision=model_config.supports_vision,
    )

    # SubAgents (only if enabled)
    subagents = (
        load_subagent_specs(
            tools,
            agent_name=agent_name,
            agent_status=agent_status,
        )
        if subagent_enabled
        else None
    )

    # openagents specific extra middlewares
    extra_middleware = _build_openagents_middlewares(model_config)

    # System prompt
    system_prompt = apply_prompt_template(
        subagent_enabled=subagent_enabled,
        max_concurrent_subagents=max_concurrent_subagents,
        agent_name=agent_name,
        agent_status=agent_status,
    )

    # Interrupt configuration (replaces ClarificationMiddleware)
    interrupt_on = {"ask_clarification": True}

    return create_deep_agent(
        model=create_chat_model(
            name=model_name,
            thinking_enabled=thinking_enabled,
            reasoning_effort=reasoning_effort,
            runtime_model_config=model_config,
        ),
        tools=tools,
        system_prompt=system_prompt,
        middleware=extra_middleware,
        subagents=subagents,
        skills=skills_sources,
        backend=backend,
        interrupt_on=interrupt_on,
        name=agent_name,
    )
