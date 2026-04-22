import asyncio
import hashlib
import inspect
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from threading import Event, Lock
from typing import Any, Literal

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import BackendProtocol
from langchain_core.runnables import RunnableConfig
from langgraph_sdk.runtime import ServerRuntime
from pydantic import BaseModel, ConfigDict, Field

from src.agents.lead_agent.prompt import apply_prompt_template
from src.agents.lead_agent.subagents import LoadedSubagentSpecs, load_subagent_specs
from src.agents.middlewares.artifacts_middleware import ArtifactsMiddleware
from src.agents.middlewares.context_window_middleware import ContextWindowMiddleware
from src.agents.middlewares.knowledge_context_middleware import KnowledgeContextMiddleware
from src.agents.middlewares.max_tokens_recovery_middleware import MaxTokensRecoveryMiddleware
from src.agents.middlewares.question_discipline_middleware import (
    QuestionDisciplineMiddleware,
)
from src.agents.middlewares.retry_utils import (
    build_model_retry_middleware,
    build_tool_retry_middleware,
)
from src.agents.middlewares.runtime_command_middleware import RuntimeCommandMiddleware
from src.agents.middlewares.title_middleware import TitleMiddleware
from src.agents.middlewares.tool_batch_sequencing_middleware import (
    ToolBatchSequencingMiddleware,
)
from src.agents.middlewares.uploads_middleware import UploadsMiddleware
from src.agents.middlewares.view_image_middleware import ViewImageMiddleware
from src.agents.middlewares.visible_response_recovery_middleware import (
    VisibleResponseRecoveryMiddleware,
)
from src.config.agent_runtime_seed import runtime_seed_targets
from src.config.agents_config import (
    AGENTS_MD_FILENAME,
    SUBAGENTS_FILENAME,
    AgentConfig,
    load_agent_config,
    resolve_authored_agent_dir,
)
from src.config.builtin_agents import (
    LEAD_AGENT_NAME,
    ensure_builtin_agent_archive,
    is_reserved_agent_name,
    normalize_effective_agent_name,
)
from src.config.commands_config import resolve_runtime_command
from src.config.model_config import ModelConfig
from src.config.paths import VIRTUAL_PATH_PREFIX, Paths, get_paths
from src.config.runtime_db import RuntimeDBStore, ThreadBinding, get_runtime_db_store
from src.config.runtime_defaults import DEFAULT_SUBAGENT_ENABLED
from src.config.runtime_limits import DEFAULT_AGENT_RECURSION_LIMIT
from src.models import create_chat_model
from src.models.factory import EffortLevel
from src.observability import create_agent_trace_callback
from src.runtime_backends import (
    build_local_workspace_backend as build_local_runtime_backend,
)
from src.runtime_backends import (
    build_runtime_workspace_backend,
    resolve_default_execution_backend,
    resolve_skills_mount,
)
from src.runtime_backends import (
    build_sandbox_workspace_backend as build_sandbox_runtime_backend,
)
from src.runtime_backends import (
    get_sandbox_provider as get_runtime_sandbox_provider,
)
from src.runtime_backends import (
    resolve_sandbox_provider as resolve_runtime_sandbox_provider,
)

logger = logging.getLogger(__name__)
DEFAULT_THREAD_ID = "_default"
ExecutionBackend = Literal["local", "sandbox", "remote"]
_LEAD_AGENT_GRAPH_CACHE_MAX = 16
_lead_agent_graph_cache: dict[tuple[object, ...], "LeadAgentGraphCacheEntry"] = {}
_lead_agent_graph_cache_order: list[tuple[object, ...]] = []
_lead_agent_graph_builds: dict[tuple[object, ...], "LeadAgentGraphBuildState"] = {}
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
    effort: EffortLevel | None = None
    max_output_tokens: int | None = None
    subagent_enabled: bool | None = None
    max_concurrent_subagents: int | None = None
    command_name: str | None = None
    command_kind: str | None = None
    command_args: str | None = None
    command_prompt: str | None = None
    authoring_actions: list[str] = Field(default_factory=list)
    knowledge_document_mentions: list[str] = Field(default_factory=list)
    original_user_input: str | None = None
    mode: str | None = None
    is_plan_mode: bool | None = None
    thread_id: str | None = None
    execution_backend: str | None = None
    remote_session_id: str | None = None
    runtime_thread_id: str | None = Field(default=None, alias="x-thread-id")
    user_id: str | None = None
    runtime_user_id: str | None = Field(default=None, alias="x-user-id")
    runtime_model_name_header: str | None = Field(default=None, alias="x-model-name")
    runtime_agent_name: str | None = Field(default=None, alias="x-agent-name")
    runtime_agent_status: str | None = Field(default=None, alias="x-agent-status")
    runtime_execution_backend: str | None = Field(
        default=None,
        alias="x-execution-backend",
    )
    runtime_remote_session_id: str | None = Field(
        default=None,
        alias="x-remote-session-id",
    )
    langgraph_auth_user_id: str | None = None


@dataclass(frozen=True)
class LeadAgentRequest:
    thinking_enabled: bool
    effort: EffortLevel | None
    requested_model_name: str | None
    is_plan_mode: bool
    subagent_enabled: bool
    max_concurrent_subagents: int
    command_name: str | None
    command_kind: str | None
    command_args: str | None
    command_prompt: str | None
    authoring_actions: tuple[str, ...]
    target_agent_name: str | None
    agent_name: str
    agent_status: str
    thread_id: str | None
    user_id: str | None
    original_user_input: str | None
    runtime_model_name: str | None
    header_model_name: str | None
    execution_backend: str | None
    remote_session_id: str | None
    # Keep the northbound token budget override explicit so public `/v1` runs do
    # not depend on provider-specific naming at the gateway boundary.
    max_output_tokens: int | None = None

    def requires_direct_authoring_tool(self) -> bool:
        """Return whether this turn is an exclusive save/push confirmation.

        Hard authoring commands such as `/save-agent-to-store` or
        `/push-skill-prod` are explicit user confirmations. Those turns should
        keep the model focused on a single persistence tool call instead of
        branching into authoring skills or delegated subagent work.

        `/create-agent` also persists through `setup_agent`, but it remains an
        authoring workflow: the lead agent may still need to inspect existing
        runtime files, use helper skills such as `find-skills`, and then call
        `setup_agent`. Keep that command out of the exclusive direct-authoring
        branch even if a stale client still marks it as `hard`.
        """

        return (
            self.command_name != "create-agent"
            and self.command_kind == "hard"
            and len(self.authoring_actions) > 0
        )

    def allows_agent_setup(self) -> bool:
        # Dev lead_agent must be able to create/update agents from plain natural
        # language, not only through slash-command scaffolding. Non-lead dev
        # agents also need `setup_agent` for self-edits because mutating their
        # thread-local `/mnt/user-data/agents/...` copy would be lost.
        return self.agent_status == "dev"

    def always_available_tool_names(self) -> tuple[str, ...]:
        if self.agent_status != "dev" or self.agent_name != LEAD_AGENT_NAME:
            return ()
        # These runtime-only helpers are part of lead_agent's generic dev
        # authoring surface, even when the archived config uses explicit
        # `tool_names` for its normal task surface.
        return (
            "install_skill_from_registry",
            "save_skill_to_store",
            "setup_agent",
        )

    def always_available_authoring_actions(self) -> tuple[str, ...]:
        if self.agent_status != "dev" or self.agent_name != LEAD_AGENT_NAME:
            return ()
        return ("save_skill_to_store",)


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
    general_purpose_enabled: bool
    general_purpose_tools: list[Any]
    filesystem_enabled: bool
    system_prompt: str


@dataclass(frozen=True)
class LeadAgentGraphCacheEntry:
    graph: Any


@dataclass
class LeadAgentGraphBuildState:
    """Track an in-flight graph compilation for a cache key.

    Multiple UI requests can ask for the same lead-agent graph at the same
    time, especially when several tabs open the same thread and immediately
    query `/history` plus `/state`. Without an in-flight registry every caller
    pays the full compile cost, which amplifies latency and CPU usage. This
    state lets one builder compile while followers block and then reuse the
    cached graph.
    """

    event: Event
    error: BaseException | None = None


def _clear_lead_agent_graph_cache() -> None:
    with _lead_agent_graph_cache_lock:
        _lead_agent_graph_cache.clear()
        _lead_agent_graph_cache_order.clear()
        _lead_agent_graph_builds.clear()


def _apply_backend_runtime_limits(config: RunnableConfig) -> None:
    """Force backend-owned step limits onto the mutable request config.

    LangGraph graph factories receive the same config object that is later used
    for graph execution. Mutating it here keeps the registered graph as a real
    `CompiledStateGraph` while still overriding any caller-supplied
    `recursion_limit` before the graph runs.
    """

    config["recursion_limit"] = DEFAULT_AGENT_RECURSION_LIMIT


def _resolve_sandbox_provider() -> str:
    return resolve_runtime_sandbox_provider()


def _resolve_execution_backend() -> ExecutionBackend:
    return resolve_default_execution_backend()


def _get_sandbox_provider(provider_path: str):
    return get_runtime_sandbox_provider(provider_path)


def _effective_thread_id(thread_id: str | None) -> str:
    return thread_id or DEFAULT_THREAD_ID


def _runtime_agent_root(agent_name: str, status: str) -> str:
    return f"{VIRTUAL_PATH_PREFIX}/agents/{status}/{agent_name.lower()}"


def _build_runtime_seed_targets(
    *,
    agent_name: str,
    status: str,
    target_root: str,
    agent_config: AgentConfig | None,
    paths: Paths,
    request: LeadAgentRequest | None = None,
) -> list[tuple[str, bytes]]:
    del request
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
    request: LeadAgentRequest | None = None,
) -> None:
    paths = get_paths()
    ensure_builtin_agent_archive(agent_name, status=status, paths=paths)
    runtime_targets = _build_runtime_seed_targets(
        agent_name=agent_name,
        status=status,
        target_root=_runtime_agent_root(agent_name, status),
        agent_config=agent_config,
        paths=paths,
        request=request,
    )
    missing_uploads = _collect_missing_runtime_uploads(backend, runtime_targets)
    _upload_runtime_files(backend, missing_uploads)


def _seed_create_agent_target_runtime_materials_if_available(
    backend: BackendProtocol,
    *,
    request: LeadAgentRequest,
) -> None:
    """Seed an existing target archive into the thread runtime for `/create-agent`.

    The active runtime only seeds the executing agent by default (usually
    `lead_agent`). During `/create-agent` updates, the model may need to inspect
    the archived target agent's existing `AGENTS.md` and copied skills through
    the virtual `/mnt/user-data/agents/...` contract. If the target archive
    already exists, mirror it into the current thread runtime as an additional
    read-only context source.
    """

    if request.command_name != "create-agent" or not request.target_agent_name:
        return

    target_agent_name = normalize_effective_agent_name(request.target_agent_name)
    current_agent_name = normalize_effective_agent_name(request.agent_name)
    if target_agent_name == current_agent_name:
        return

    paths = get_paths()
    try:
        target_agent_config = load_agent_config(
            target_agent_name,
            status=request.agent_status,
            paths=paths,
        )
    except FileNotFoundError:
        return
    if target_agent_config is None:
        return

    _seed_runtime_materials(
        backend,
        agent_name=target_agent_name,
        status=request.agent_status,
        agent_config=target_agent_config,
    )


def _build_local_workspace_backend(
    user_data_dir: str,
    *,
    skills_mount: tuple[str, str] | None = None,
) -> BackendProtocol:
    return build_local_runtime_backend(
        user_data_dir,
        skills_mount=skills_mount,
    )


def _build_sandbox_workspace_backend(thread_id: str | None) -> BackendProtocol:
    return build_sandbox_runtime_backend(_effective_thread_id(thread_id))


def _build_workspace_backend(
    *,
    user_data_dir: str,
    thread_id: str | None,
    paths: Paths | None = None,
    requested_backend: str | None = None,
    remote_session_id: str | None = None,
) -> BackendProtocol:
    resolved_paths = paths or get_paths()
    return build_runtime_workspace_backend(
        user_data_dir=user_data_dir,
        thread_id=_effective_thread_id(thread_id),
        paths=resolved_paths,
        requested_backend=requested_backend,
        remote_session_id=remote_session_id,
    )


def _build_read_context_backend(thread_id: str | None) -> BackendProtocol:
    paths = get_paths()
    effective_thread_id = _effective_thread_id(thread_id)
    user_data_dir = str(paths.sandbox_user_data_dir(effective_thread_id))
    return _build_local_workspace_backend(
        user_data_dir,
        skills_mount=resolve_skills_mount(paths),
    )


def _build_shared_read_context_backend() -> BackendProtocol:
    """Build a backend for history/state graph loads.

    Read-only LangGraph access (`/history`, `/state`) never invokes tools or the
    filesystem data plane. A stable synthetic workspace keeps the compiled graph
    reusable across threads and users instead of tying cache entries to one
    thread-local path.
    """

    return _build_read_context_backend(DEFAULT_THREAD_ID)


def build_backend(
    thread_id: str | None,
    agent_name: str | None,
    status: str = "dev",
    agent_config: AgentConfig | None = None,
    *,
    request: LeadAgentRequest | None = None,
    execution_backend: str | None = None,
    remote_session_id: str | None = None,
):
    """Build the runtime backend for the agent.

    The backend provides:
    - Per-thread runtime workspace under `/mnt/user-data`
    - Thread-local copies of archived agent definition files (`AGENTS.md`, `config.yaml`, copied `skills/`)
    - Local-debug compatibility routing for archived skills under `/mnt/skills` when execution is not sandboxed

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
        requested_backend=execution_backend,
        remote_session_id=remote_session_id,
    )
    _seed_runtime_materials(
        workspace_backend,
        agent_name=effective_agent_name,
        status=status,
        agent_config=agent_config,
        request=request,
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
    - FilesystemMiddleware (replaces sandbox tools: execute, ls, read_file, write_file, str_replace, edit_file, glob, grep)

    We only keep OpenAgents-specific middleware where Deep Agents does not
    already provide the behavior:
    - ArtifactsMiddleware: persists presented files in graph state
    - RuntimeCommandMiddleware: injects per-turn slash-command metadata into the model context
    - UploadsMiddleware: injects uploaded file context into the current user turn
    - TitleMiddleware: persists a local first-turn title without another model call
    - Recovery middlewares: recover provider-specific outputs
    - ContextWindowMiddleware: emit telemetry for the admin console
    - ViewImageMiddleware: injects image content after successful `view_image` tool calls
    """
    # Authoring turns rely on explicit tool contracts plus backend/runtime
    # isolation instead of shell/path heuristics. Attached copied skills execute
    # from `/mnt/user-data/agents/...`, so a middleware that re-interprets
    # command strings as authoring policy would block legitimate runtime work.
    middlewares = [
        ArtifactsMiddleware(),
        QuestionDisciplineMiddleware(),
        RuntimeCommandMiddleware(),
        UploadsMiddleware(),
        KnowledgeContextMiddleware(),
        TitleMiddleware(),
        build_model_retry_middleware(),
        build_tool_retry_middleware(),
        ToolBatchSequencingMiddleware(),
        MaxTokensRecoveryMiddleware(),
        VisibleResponseRecoveryMiddleware(),
        ContextWindowMiddleware(),
    ]

    if model_config.supports_vision:
        middlewares.append(ViewImageMiddleware())

    return middlewares


def _path_mtime_ns(path: Path) -> int:
    try:
        return path.stat().st_mtime_ns
    except FileNotFoundError:
        return 0


def _model_config_cache_token(model_config: ModelConfig) -> str:
    payload = model_config.model_dump(exclude_none=True)
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _lead_agent_graph_cache_key(
    *,
    request: LeadAgentRequest,
    resolution: LeadAgentResolution,
    prepare_runtime_resources: bool,
) -> tuple[object, ...]:
    paths = get_paths()
    authored_dir = resolve_authored_agent_dir(
        request.agent_name,
        request.agent_status,
        paths=paths,
    )
    if authored_dir is None:
        if is_reserved_agent_name(request.agent_name):
            authored_dir = paths.system_agent_dir(request.agent_name, request.agent_status)
        else:
            authored_dir = paths.custom_agent_dir(request.agent_name, request.agent_status)
    normalized_request = request
    if not prepare_runtime_resources:
        normalized_request = replace(
            request,
            requested_model_name=None,
            runtime_model_name=None,
            thread_id=None,
            user_id=None,
            execution_backend=None,
            remote_session_id=None,
        )
    return (
        normalized_request,
        resolution.model_name,
        _model_config_cache_token(resolution.model_config),
        prepare_runtime_resources,
        _path_mtime_ns(authored_dir / "config.yaml"),
        _path_mtime_ns(authored_dir / AGENTS_MD_FILENAME),
        _path_mtime_ns(authored_dir / SUBAGENTS_FILENAME),
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
) -> LeadAgentGraphCacheEntry:
    entry = LeadAgentGraphCacheEntry(graph=graph)
    with _lead_agent_graph_cache_lock:
        _lead_agent_graph_cache[cache_key] = entry
        if cache_key in _lead_agent_graph_cache_order:
            _lead_agent_graph_cache_order.remove(cache_key)
        _lead_agent_graph_cache_order.append(cache_key)
        while len(_lead_agent_graph_cache_order) > _LEAD_AGENT_GRAPH_CACHE_MAX:
            evicted_key = _lead_agent_graph_cache_order.pop(0)
            _lead_agent_graph_cache.pop(evicted_key, None)
    return entry


def _claim_lead_agent_graph_build(
    cache_key: tuple[object, ...],
) -> tuple[LeadAgentGraphCacheEntry | None, LeadAgentGraphBuildState | None, bool]:
    """Return a cached graph or claim the right to build it.

    The boolean result is `True` only for the single thread that should compile
    the graph. Followers receive the shared build state and wait for the event.
    """

    with _lead_agent_graph_cache_lock:
        cached_entry = _lead_agent_graph_cache.get(cache_key)
        if cached_entry is not None:
            if cache_key in _lead_agent_graph_cache_order:
                _lead_agent_graph_cache_order.remove(cache_key)
            _lead_agent_graph_cache_order.append(cache_key)
            return cached_entry, None, False

        build_state = _lead_agent_graph_builds.get(cache_key)
        if build_state is not None:
            return None, build_state, False

        build_state = LeadAgentGraphBuildState(event=Event())
        _lead_agent_graph_builds[cache_key] = build_state
        return None, build_state, True


def _finish_lead_agent_graph_build(
    cache_key: tuple[object, ...],
    *,
    error: BaseException | None = None,
) -> None:
    with _lead_agent_graph_cache_lock:
        build_state = _lead_agent_graph_builds.pop(cache_key, None)
        if build_state is None:
            return
        build_state.error = error
        build_state.event.set()


def _wait_for_lead_agent_graph_build(
    cache_key: tuple[object, ...],
    build_state: LeadAgentGraphBuildState,
) -> LeadAgentGraphCacheEntry:
    build_state.event.wait()
    if build_state.error is not None:
        raise build_state.error

    cached_entry = _get_cached_lead_agent_graph(cache_key)
    if cached_entry is None:
        raise RuntimeError("Lead-agent graph build completed without a cached graph entry.")
    return cached_entry


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
    if isinstance(context, Mapping):
        return dict(context)
    dumped = getattr(context, "model_dump", None)
    if callable(dumped):
        try:
            data = dumped(by_alias=True)
        except TypeError:
            data = dumped()
        if isinstance(data, Mapping):
            return dict(data)
    return {}


def _runtime_context_field_name(context: object, key: str) -> str | None:
    model_fields = getattr(type(context), "model_fields", None)
    if not isinstance(model_fields, Mapping):
        return None

    for field_name, field_info in model_fields.items():
        if field_name == key:
            return field_name
        if getattr(field_info, "alias", None) == key:
            return field_name

    return None


def _assign_runtime_context_value(context: object, key: str, value: object) -> None:
    if isinstance(context, dict):
        context[key] = value
        return

    field_name = _runtime_context_field_name(context, key)
    if field_name is not None:
        try:
            setattr(context, field_name, value)
        except Exception:
            return
        return

    extras = getattr(context, "__pydantic_extra__", None)
    if isinstance(extras, dict):
        extras[key] = value
        return

    try:
        setattr(context, key, value)
    except Exception:
        return


def _update_runtime_context(runtime: ServerRuntime | None, **values: object) -> None:
    if runtime is None:
        return
    execution_runtime = runtime.execution_runtime
    if execution_runtime is None:
        return
    context = execution_runtime.context
    for key, value in values.items():
        _assign_runtime_context_value(context, key, value)


def _coerce_optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_bool(value: object, *, default: bool, field_name: str) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    if isinstance(value, int) and value in {0, 1}:
        return bool(value)
    raise ValueError(f"`{field_name}` must be a boolean.") from None


def _coerce_effort(value: object) -> EffortLevel | None:
    normalized = _coerce_optional_str(value)
    if normalized is None:
        return None
    normalized = normalized.lower()
    if normalized in {"low", "medium", "high", "max"}:
        return normalized
    raise ValueError(
        "`effort` must be one of: low, medium, high, max."
    ) from None


def _coerce_optional_positive_int(value: object, *, field_name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"`{field_name}` must be an integer.") from None
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        if not normalized.isdigit():
            raise ValueError(f"`{field_name}` must be a positive integer.") from None
        parsed = int(normalized)
    else:
        raise ValueError(f"`{field_name}` must be a positive integer.") from None
    if parsed <= 0:
        raise ValueError(f"`{field_name}` must be a positive integer.") from None
    return parsed


def _load_configurable_payload(config: RunnableConfig, runtime: ServerRuntime | None) -> dict:
    configurable_payload = config.get("configurable", {})
    if configurable_payload is None:
        configurable_payload = {}
    if not isinstance(configurable_payload, dict):
        raise ValueError("`configurable` must be an object.")

    # LangGraph runtime context carries server-injected headers such as thread/user
    # identity. Explicit configurable values still win, but thread-scoped read
    # requests such as `/state` can rely on the header-derived context when a fresh
    # thread has not persisted its runtime binding yet.
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


def _load_thread_binding(
    *,
    db_store: RuntimeDBStore,
    thread_id: str | None,
    user_id: str | None,
) -> ThreadBinding | None:
    if thread_id and not user_id:
        raise ValueError("Thread-scoped requests require user identity. Provide `context.user_id`/`configurable.user_id`, forward `x-user-id` through LangGraph configurable headers, or configure LangGraph custom auth.")

    if not thread_id:
        return None

    assert user_id is not None
    binding = db_store.get_thread_binding(thread_id)
    if binding is not None and binding.user_id != user_id:
        raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({binding.user_id}).")
    return binding


def _persist_thread_runtime(
    *,
    db_store: RuntimeDBStore,
    thread_id: str | None,
    user_id: str | None,
    model_name: str,
    agent_name: str,
    agent_status: str,
    execution_backend: str | None,
    remote_session_id: str | None,
) -> None:
    if not thread_id:
        return

    assert user_id is not None
    db_store.save_thread_runtime_if_needed(
        thread_id=thread_id,
        user_id=user_id,
        model_name=model_name,
        agent_name=agent_name,
        agent_status=agent_status,
        execution_backend=execution_backend,
        remote_session_id=remote_session_id,
    )


def _bind_request_to_thread_runtime(
    *,
    request: LeadAgentRequest,
    thread_binding: ThreadBinding | None,
) -> LeadAgentRequest:
    if thread_binding is None:
        return request

    bound_agent_name = thread_binding.agent_name or request.agent_name
    bound_agent_status = thread_binding.agent_status or request.agent_status
    bound_execution_backend = thread_binding.execution_backend
    bound_remote_session_id = thread_binding.remote_session_id if bound_execution_backend == "remote" else None

    if bound_agent_name != request.agent_name or bound_agent_status != request.agent_status or bound_execution_backend != request.execution_backend or bound_remote_session_id != request.remote_session_id:
        logger.info(
            "Thread '%s' is already bound to agent=%s status=%s backend=%s remote_session_id=%s; using persisted thread runtime.",
            request.thread_id,
            bound_agent_name,
            bound_agent_status,
            bound_execution_backend,
            bound_remote_session_id,
        )

    return replace(
        request,
        agent_name=bound_agent_name,
        agent_status=bound_agent_status,
        execution_backend=bound_execution_backend,
        remote_session_id=bound_remote_session_id,
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
    always_available_tool_names: tuple[str, ...],
    always_available_authoring_actions: tuple[str, ...],
    setup_agent_enabled: bool,
):
    from src.tools import get_available_tools

    return get_available_tools(
        model_name=model_name,
        model_supports_vision=model_supports_vision,
        groups=agent_config.tool_groups,
        tool_names=agent_config.tool_names,
        mcp_servers=agent_config.mcp_servers,
        agent_status=agent_status,
        authoring_actions=list(authoring_actions),
        always_available_tool_names=list(always_available_tool_names),
        always_available_authoring_actions=list(always_available_authoring_actions),
        setup_agent_enabled=setup_agent_enabled,
    )


def _resolve_run_model(
    *,
    requested_model_name: str | None,
    runtime_model_name: str | None,
    header_model_name: str | None,
    agent_config: AgentConfig | None,
    thread_binding: ThreadBinding | None,
    thread_id: str | None,
    db_store: RuntimeDBStore,
) -> tuple[str, ModelConfig]:
    """Resolve the run model with strict precedence and no implicit fallback."""
    # Precedence is intentionally strict: explicit per-request selection beats runtime
    # defaults, which beat the agent archive, which finally beats thread stickiness.
    # Explicit header identity is only a seed for thread reads before the first
    # persisted binding exists, so it is kept behind the persisted thread model.
    # The conflict checks below keep those sources from silently drifting apart.
    agent_model_name = agent_config.model if agent_config and agent_config.model else None
    if requested_model_name and agent_model_name and requested_model_name != agent_model_name:
        raise ValueError(f"Model conflict: requested model '{requested_model_name}' does not match agent model '{agent_model_name}'.")
    if runtime_model_name and agent_model_name and runtime_model_name != agent_model_name:
        raise ValueError(f"Model conflict: requested model '{runtime_model_name}' does not match agent model '{agent_model_name}'.")
    if requested_model_name and runtime_model_name and requested_model_name != runtime_model_name:
        raise ValueError("Model conflict: `configurable.model_name` and `configurable.model_config.name` must match.")
    persisted_thread_model_name = thread_binding.model_name if thread_binding is not None else None
    header_model_is_seed = persisted_thread_model_name is None

    if header_model_is_seed and header_model_name and requested_model_name and header_model_name != requested_model_name:
        raise ValueError("Model conflict: `configurable.model_name` and `x-model-name` must match.")
    if header_model_is_seed and header_model_name and runtime_model_name and header_model_name != runtime_model_name:
        raise ValueError("Model conflict: `configurable.model_config.name` and `x-model-name` must match.")
    if header_model_is_seed and header_model_name and agent_model_name and header_model_name != agent_model_name:
        raise ValueError(f"Model conflict: request header model '{header_model_name}' does not match agent model '{agent_model_name}'.")
    # Thread-scoped headers are only a seed before the first persisted runtime
    # binding exists. Once a thread model is bound, stale client headers must not
    # override or conflict with the persisted thread runtime.
    effective_header_model_name = header_model_name if header_model_is_seed else None

    model_name = requested_model_name or runtime_model_name or agent_model_name or persisted_thread_model_name or effective_header_model_name
    if not model_name:
        raise ValueError(
            "No model resolved for this run. Provide `configurable.model_name`/`model`, `configurable.model_config.name`, `agent.model`, a persisted thread runtime model, or `x-model-name` for thread-scoped requests before the first run."
        )

    model_config = db_store.get_model(model_name)
    if model_config is None:
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


def _unwrap_runtime_backend(backend: BackendProtocol) -> BackendProtocol:
    current = backend
    seen: set[int] = set()
    while True:
        current_id = id(current)
        if current_id in seen:
            return current
        seen.add(current_id)
        wrapped = getattr(current, "__wrapped_backend__", None)
        if wrapped is None:
            return current
        current = wrapped


def _resolve_execute_timeout_contract(
    backend: BackendProtocol,
) -> dict[str, int | None]:
    unwrapped = _unwrap_runtime_backend(backend)
    if isinstance(unwrapped, CompositeBackend):
        unwrapped = _unwrap_runtime_backend(unwrapped.default)

    default_timeout = getattr(unwrapped, "_default_timeout", None)
    if not isinstance(default_timeout, int):
        default_timeout = getattr(unwrapped, "_default_timeout_seconds", None)
    if not isinstance(default_timeout, int):
        default_timeout = None

    from deepagents.middleware.filesystem import FilesystemMiddleware

    max_timeout = inspect.signature(
        FilesystemMiddleware.__init__,
    ).parameters["max_execute_timeout"].default
    if not isinstance(max_timeout, int):
        max_timeout = None
    return {
        "default_timeout_seconds": default_timeout,
        "max_timeout_seconds": max_timeout,
    }


def _build_run_metadata(
    *,
    agent_name: str,
    agent_status: str,
    model_name: str,
    thinking_enabled: bool,
    effort: EffortLevel | None,
    max_output_tokens: int | None,
    is_plan_mode: bool,
    subagent_enabled: bool,
    thread_id: str | None,
    user_id: str | None,
    execution_backend: str | None,
    original_user_input: str | None,
    execute_timeout_contract: dict[str, int | None],
) -> dict[str, object]:
    original_input_preview = (
        str(original_user_input).strip()[:240]
        if original_user_input
        else None
    )
    original_input_digest = (
        hashlib.sha256(str(original_user_input).strip().encode("utf-8")).hexdigest()
        if original_user_input
        else None
    )
    return {
        "agent_name": agent_name,
        "agent_status": agent_status,
        "model_name": model_name,
        "thinking_enabled": thinking_enabled,
        "effort": effort,
        "max_output_tokens": max_output_tokens,
        "is_plan_mode": is_plan_mode,
        "subagent_enabled": subagent_enabled,
        "thread_id": thread_id,
        "user_id": user_id,
        "execution_backend": execution_backend,
        "original_user_input_preview": original_input_preview,
        "original_user_input_digest": original_input_digest,
        "execute_timeout_contract": execute_timeout_contract,
    }


def _resolve_lead_agent_request(
    config: RunnableConfig,
    runtime: ServerRuntime | None,
) -> LeadAgentRequest:
    cfg = _load_configurable_payload(config, runtime)
    command_resolution = resolve_runtime_command(
        command_name=_coerce_optional_str(cfg.get("command_name")),
        command_args=_coerce_optional_str(cfg.get("command_args")),
        original_user_input=_coerce_optional_str(cfg.get("original_user_input")),
        target_agent_name=_coerce_optional_str(cfg.get("target_agent_name")),
        paths=get_paths(),
    )
    return LeadAgentRequest(
        thinking_enabled=_coerce_bool(
            cfg.get("thinking_enabled"),
            default=True,
            field_name="thinking_enabled",
        ),
        effort=_coerce_effort(cfg.get("effort")),
        requested_model_name=_coerce_optional_str(cfg.get("model_name") or cfg.get("model")),
        is_plan_mode=_coerce_bool(
            cfg.get("is_plan_mode"),
            default=False,
            field_name="is_plan_mode",
        ),
        subagent_enabled=_coerce_bool(
            cfg.get("subagent_enabled"),
            default=DEFAULT_SUBAGENT_ENABLED,
            field_name="subagent_enabled",
        ),
        max_concurrent_subagents=_coerce_optional_positive_int(
            cfg.get("max_concurrent_subagents"),
            field_name="max_concurrent_subagents",
        ) or 3,
        command_name=command_resolution.name,
        command_kind=command_resolution.kind,
        command_args=command_resolution.args,
        command_prompt=command_resolution.prompt,
        authoring_actions=command_resolution.authoring_actions,
        target_agent_name=command_resolution.target_agent_name,
        agent_name=normalize_effective_agent_name(_coerce_optional_str(cfg.get("agent_name") or cfg.get("x-agent-name"))),
        agent_status=_resolve_agent_status(cfg.get("agent_status") or cfg.get("x-agent-status") or "dev"),
        thread_id=_coerce_optional_str(cfg.get("thread_id") or cfg.get("x-thread-id")),
        user_id=_resolve_request_user_id(cfg, runtime),
        original_user_input=_coerce_optional_str(cfg.get("original_user_input")),
        runtime_model_name=_parse_runtime_model_config(cfg.get("model_config")),
        header_model_name=_coerce_optional_str(cfg.get("x-model-name")),
        execution_backend=_coerce_optional_str(cfg.get("execution_backend") or cfg.get("x-execution-backend")),
        remote_session_id=_coerce_optional_str(cfg.get("remote_session_id") or cfg.get("x-remote-session-id")),
        max_output_tokens=_coerce_optional_positive_int(
            cfg.get("max_output_tokens"),
            field_name="max_output_tokens",
        ),
    )


def _resolve_lead_agent_runtime(
    *,
    request: LeadAgentRequest,
    db_store: RuntimeDBStore,
    persist_thread_runtime: bool,
) -> tuple[LeadAgentRequest, LeadAgentResolution]:
    thread_binding = _load_thread_binding(
        db_store=db_store,
        thread_id=request.thread_id,
        user_id=request.user_id,
    )
    effective_request = _bind_request_to_thread_runtime(
        request=request,
        thread_binding=thread_binding,
    )
    agent_config = _load_agent_runtime_config(
        agent_name=effective_request.agent_name,
        agent_status=effective_request.agent_status,
    )
    _assert_agent_memory_access(
        agent_config=agent_config,
        user_id=effective_request.user_id,
    )
    model_name, model_config = _resolve_run_model(
        requested_model_name=effective_request.requested_model_name,
        runtime_model_name=effective_request.runtime_model_name,
        header_model_name=effective_request.header_model_name,
        agent_config=agent_config,
        thread_binding=thread_binding,
        thread_id=effective_request.thread_id,
        db_store=db_store,
    )
    if persist_thread_runtime:
        _persist_thread_runtime(
            db_store=db_store,
            thread_id=effective_request.thread_id,
            user_id=effective_request.user_id,
            model_name=model_name,
            agent_name=effective_request.agent_name,
            agent_status=effective_request.agent_status,
            execution_backend=effective_request.execution_backend,
            remote_session_id=effective_request.remote_session_id,
        )
    return (
        effective_request,
        LeadAgentResolution(
            agent_config=agent_config,
            model_name=model_name,
            model_config=model_config,
        ),
    )


def _update_request_runtime_context(
    runtime: ServerRuntime | None,
    request: LeadAgentRequest,
    *,
    resolved_model_name: str | None = None,
) -> None:
    _update_runtime_context(
        runtime,
        thread_id=request.thread_id,
        user_id=request.user_id,
        **{
            "x-thread-id": request.thread_id,
            "x-user-id": request.user_id,
            "x-agent-name": request.agent_name,
            "x-agent-status": request.agent_status,
            "x-model-name": resolved_model_name,
            "x-execution-backend": request.execution_backend,
            "x-remote-session-id": request.remote_session_id,
            "agent_name": request.agent_name,
            "target_agent_name": request.target_agent_name,
            "agent_status": request.agent_status,
            "model_name": resolved_model_name,
            "model": resolved_model_name,
            "command_name": request.command_name,
            "command_kind": request.command_kind,
            "command_args": request.command_args,
            "command_prompt": request.command_prompt,
            "authoring_actions": list(request.authoring_actions),
            "original_user_input": request.original_user_input,
            "execution_backend": request.execution_backend,
            "remote_session_id": request.remote_session_id,
            "max_output_tokens": request.max_output_tokens,
        },
    )


def _attach_trace_metadata(
    config: RunnableConfig,
    *,
    request: LeadAgentRequest,
    model_name: str,
    backend: BackendProtocol,
) -> None:
    if "metadata" not in config:
        config["metadata"] = {}

    # Registered tools must be derived from callback-captured LLM requests because
    # Deep Agents middleware can inject runtime tools such as `task` after graph
    # assembly. Trace metadata here stays limited to stable run identity/config.
    run_metadata = _build_run_metadata(
        agent_name=request.agent_name,
        agent_status=request.agent_status,
        model_name=model_name,
        thinking_enabled=request.thinking_enabled,
        effort=request.effort,
        max_output_tokens=request.max_output_tokens,
        is_plan_mode=request.is_plan_mode,
        subagent_enabled=request.subagent_enabled,
        thread_id=request.thread_id,
        user_id=request.user_id,
        execution_backend=request.execution_backend,
        original_user_input=request.original_user_input,
        execute_timeout_contract=_resolve_execute_timeout_contract(backend),
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

def _resolve_agent_backend(
    *,
    request: LeadAgentRequest,
    agent_config: AgentConfig,
    prepare_runtime_resources: bool,
) -> BackendProtocol:
    if not prepare_runtime_resources:
        return _build_shared_read_context_backend()
    backend = build_backend(
        request.thread_id,
        request.agent_name,
        request.agent_status,
        agent_config,
        request=request,
        execution_backend=request.execution_backend,
        remote_session_id=request.remote_session_id,
    )
    _seed_create_agent_target_runtime_materials_if_available(
        backend,
        request=request,
    )
    return backend


def _build_agent_subagents(
    *,
    request: LeadAgentRequest,
    agent_config: AgentConfig,
    tools: object,
    model_name: str,
    model_supports_vision: bool,
) -> LoadedSubagentSpecs | None:
    if request.requires_direct_authoring_tool():
        return None
    if not request.subagent_enabled:
        return None
    if not isinstance(tools, list):
        raise ValueError("Lead agent tools must resolve to a list before subagent construction.")
    return load_subagent_specs(
        tools,
        agent_config=agent_config,
        agent_status=request.agent_status,
        model_name=model_name,
        model_supports_vision=model_supports_vision,
    )


def _should_prepare_runtime_resources(runtime: ServerRuntime | None) -> bool:
    """Return whether this request needs a real thread-scoped runtime backend.

    Normal agent execution runs with an execution runtime context, so we prepare
    per-thread workspace resources and persist thread runtime metadata. Read-only
    graph loads such as history/state access may provide a runtime object without
    `execution_runtime`; those requests should reuse the shared read context
    instead of allocating thread-specific runtime resources.
    """

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
        user_id=request.user_id,
        agent_name=request.agent_name,
        agent_status=request.agent_status,
        memory_config=resolution.agent_config.memory,
        agent_config=resolution.agent_config,
    )


def _uses_explicit_runtime_tool_surface(agent_config: AgentConfig) -> bool:
    """Return whether the archive locked an exact normal-tool surface.

    `tool_names` is the user-facing explicit whitelist for the main agent's
    normal runtime tools. When that field is present, the runtime must not
    silently re-expand the surface by injecting Deep Agents filesystem or
    delegation helpers behind the settings UI. Agent-scoped MCP tools remain
    additive through `get_available_tools(...)`.
    """

    return agent_config.tool_names is not None


def _build_graph_parts(
    *,
    request: LeadAgentRequest,
    resolution: LeadAgentResolution,
) -> LeadAgentGraphParts:
    """Assemble request-specific Deep Agents graph inputs.

    This groups together the pieces that materially change the compiled graph:
    tool set, middleware, prompt, and subagents. The resulting object is
    easy to inspect in tests and keeps `_create_lead_agent` as a short
    orchestration narrative instead of a long construction routine.
    """

    tools = _load_agent_tools(
        agent_config=resolution.agent_config,
        model_name=resolution.model_name,
        model_supports_vision=resolution.model_config.supports_vision,
        agent_status=request.agent_status,
        authoring_actions=request.authoring_actions,
        always_available_tool_names=request.always_available_tool_names(),
        always_available_authoring_actions=request.always_available_authoring_actions(),
        setup_agent_enabled=request.allows_agent_setup(),
    )
    explicit_runtime_surface = _uses_explicit_runtime_tool_surface(resolution.agent_config)
    subagent_specs = None
    if not explicit_runtime_surface:
        subagent_specs = _build_agent_subagents(
            request=request,
            agent_config=resolution.agent_config,
            tools=tools,
            model_name=resolution.model_name,
            model_supports_vision=resolution.model_config.supports_vision,
        )
    return LeadAgentGraphParts(
        tools=tools,
        middleware=_build_openagents_middlewares(resolution.model_config),
        subagents=subagent_specs.custom_subagents if subagent_specs is not None else None,
        general_purpose_enabled=subagent_specs.general_purpose_enabled if subagent_specs is not None else False,
        general_purpose_tools=subagent_specs.general_purpose_tools if subagent_specs is not None else tools,
        filesystem_enabled=not explicit_runtime_surface,
        system_prompt=_build_system_prompt(request=request, resolution=resolution),
    )


def _create_lead_agent(
    config: RunnableConfig,
    runtime: ServerRuntime | None = None,
    *,
    prepare_runtime_resources: bool,
):
    _apply_backend_runtime_limits(config)
    request = _resolve_lead_agent_request(config, runtime)
    db_store = get_runtime_db_store()
    request, resolution = _resolve_lead_agent_runtime(
        request=request,
        db_store=db_store,
        persist_thread_runtime=prepare_runtime_resources,
    )
    _assert_requested_model_capabilities(
        request=request,
        resolution=resolution,
    )

    _update_request_runtime_context(
        runtime,
        request,
        resolved_model_name=resolution.model_name,
    )
    backend = _resolve_agent_backend(
        request=request,
        agent_config=resolution.agent_config,
        prepare_runtime_resources=prepare_runtime_resources,
    )
    cache_key = _lead_agent_graph_cache_key(
        request=request,
        resolution=resolution,
        prepare_runtime_resources=prepare_runtime_resources,
    )
    cached_entry, build_state, should_build = _claim_lead_agent_graph_build(cache_key)
    if cached_entry is not None:
        _attach_trace_metadata(
            config,
            request=request,
            model_name=resolution.model_name,
            backend=backend,
        )
        return cached_entry.graph
    if not should_build:
        assert build_state is not None
        cached_entry = _wait_for_lead_agent_graph_build(cache_key, build_state)
        _attach_trace_metadata(
            config,
            request=request,
            model_name=resolution.model_name,
            backend=backend,
        )
        return cached_entry.graph

    logger.info(
        "Create Agent(%s) -> thinking_enabled: %s, effort: %s, is_plan_mode: %s, model_name: %s, subagent_enabled: %s, agent_status: %s",
        request.agent_name,
        request.thinking_enabled,
        request.effort,
        request.is_plan_mode,
        resolution.model_name,
        request.subagent_enabled,
        request.agent_status,
    )

    try:
        graph_parts = _build_graph_parts(
            request=request,
            resolution=resolution,
        )
        _attach_trace_metadata(
            config,
            request=request,
            model_name=resolution.model_name,
            backend=backend,
        )

        deep_agent_kwargs: dict[str, Any] = {
            "model": create_chat_model(
                name=resolution.model_name,
                thinking_enabled=request.thinking_enabled,
                effort=request.effort,
                # The public `/v1` contract exposes `max_output_tokens`. Keep
                # the runtime field explicit here so the gateway does not need
                # provider-specific knowledge about `max_tokens`.
                max_output_tokens=request.max_output_tokens,
                runtime_model_config=resolution.model_config,
            ),
            "tools": graph_parts.tools,
            "system_prompt": graph_parts.system_prompt,
            "middleware": graph_parts.middleware,
            "subagents": graph_parts.subagents,
            "general_purpose_tools": graph_parts.general_purpose_tools,
            "general_purpose_enabled": graph_parts.general_purpose_enabled,
            # Explicit archive tool_names must stay authoritative. When the
            # user chose an exact tool subset in settings, do not let Deep
            # Agents inject hidden filesystem helpers back into the runtime.
            "filesystem_enabled": graph_parts.filesystem_enabled,
            "backend": backend,
            "context_schema": LeadAgentRuntimeContext,
            "name": request.agent_name,
            # Keep planner/todo behavior behind explicit plan-mode opt-in.
            "todo_enabled": bool(request.is_plan_mode),
        }

        graph = create_deep_agent(**deep_agent_kwargs).with_config(
            {"recursion_limit": DEFAULT_AGENT_RECURSION_LIMIT}
        )
        cached_entry = _store_cached_lead_agent_graph(
            cache_key,
            graph=graph,
        )
    except BaseException as exc:
        _finish_lead_agent_graph_build(cache_key, error=exc)
        raise

    _finish_lead_agent_graph_build(cache_key)
    return cached_entry.graph


def prime_lead_agent_read_graph_cache(
    *,
    agent_statuses: tuple[str, ...] = ("dev", "prod"),
) -> None:
    """Preload shared read-only graphs for common lead-agent page loads.

    Thread history/state endpoints are the main source of UI latency. Prime the
    read-only cache once per enabled model so the first thread page load can
    reuse a compiled graph instead of paying the cold compile cost inline.
    """

    db_store = get_runtime_db_store()
    try:
        model_names = db_store.list_enabled_model_names()
    except Exception:
        logger.warning("Skipping lead-agent read graph warmup: failed to load enabled models.", exc_info=True)
        return

    for agent_status in agent_statuses:
        for model_name in model_names:
            try:
                _create_lead_agent(
                    {
                        "configurable": {
                            "agent_status": agent_status,
                            "model_name": model_name,
                        }
                    },
                    None,
                    prepare_runtime_resources=False,
                )
            except Exception:
                logger.warning(
                    "Skipping lead-agent read graph warmup for status=%s model=%s.",
                    agent_status,
                    model_name,
                    exc_info=True,
                )


async def make_lead_agent(config: RunnableConfig, runtime: ServerRuntime | None = None):
    prepare_runtime_resources = _should_prepare_runtime_resources(runtime)
    return await asyncio.to_thread(
        _create_lead_agent,
        config,
        runtime,
        prepare_runtime_resources=prepare_runtime_resources,
    )
