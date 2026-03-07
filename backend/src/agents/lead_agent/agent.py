import logging

from deepagents import SubAgent, create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend, LocalShellBackend
from langchain_core.runnables import RunnableConfig
from langgraph_sdk.runtime import ServerRuntime

from src.agents.lead_agent.prompt import apply_prompt_template
from src.agents.middlewares.thread_data_middleware import ThreadDataMiddleware
from src.agents.middlewares.title_middleware import TitleMiddleware
from src.agents.middlewares.uploads_middleware import UploadsMiddleware
from src.agents.middlewares.view_image_middleware import ViewImageMiddleware
from src.config.runtime_db import DBAgentConfig, RuntimeDBStore, get_runtime_db_store
from src.config.model_config import ModelConfig
from src.config.paths import get_paths
from src.models import create_chat_model

logger = logging.getLogger(__name__)


def build_backend(thread_id: str, agent_name: str | None, status: str = "dev"):
    """Build a CompositeBackend for the agent.

    Replaces the old LocalSandbox + replace_virtual_path system with deepagents backends.

    The backend provides:
    - Default: LocalShellBackend for thread workspace (per-thread isolated runtime)
    - /skills/: Agent-specific skills (shared across all threads using this agent)
    - /public-skills/: Global public skills (shared across all agents)
    """
    paths = get_paths()

    # === Runtime layer (per-thread isolated) ===
    if thread_id:
        user_data_dir = str(paths.sandbox_user_data_dir(thread_id))
        paths.ensure_thread_dirs(thread_id)
    else:
        user_data_dir = str(paths.base_dir / "threads" / "_default" / "user-data")

    workspace_backend = LocalShellBackend(
        root_dir=user_data_dir,
        virtual_mode=True,
        inherit_env=True,
        timeout=600,
    )

    routes = {}

    # === Definition layer (shared across all threads) ===
    if agent_name:
        agent_dir = paths.agent_dir(agent_name, status)
        skills_dir = agent_dir / "skills"
        if skills_dir.exists():
            routes["/skills/"] = FilesystemBackend(
                root_dir=str(skills_dir),
                virtual_mode=True,
            )

    # Global public skills are only exposed for the default agent flow.
    if not agent_name:
        skills_root = paths.skills_dir
        if skills_root.exists():
            routes["/public-skills/"] = FilesystemBackend(
                root_dir=str(skills_root),
                virtual_mode=True,
            )

    return CompositeBackend(default=workspace_backend, routes=routes)


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
    middlewares = [ThreadDataMiddleware(), UploadsMiddleware(), TitleMiddleware()]

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
    agent_name: str | None,
    agent_status: str,
    db_store: RuntimeDBStore,
) -> DBAgentConfig | None:
    if not agent_name:
        return None
    config = db_store.get_agent(agent_name, agent_status)
    if config is None:
        raise ValueError(f"Agent '{agent_name}' with status '{agent_status}' not found in database.")
    return config


# SubAgent definitions (replace backend/src/subagents/builtins/)
OPENAGENTS_SUBAGENTS: list[SubAgent] = [
    {
        "name": "general-purpose",
        "description": "General-purpose subagent for research, code exploration, file operations, analysis, and any non-trivial task. Has access to all tools except task and ask_clarification.",
        "system_prompt": (
            "You are a general-purpose subagent. Complete the assigned task thoroughly and return a clear result.\n"
            "Use all available tools as needed. Be systematic and thorough.\n"
            "When doing research, always cite sources with markdown links."
        ),
    },
    {
        "name": "bash",
        "description": "Command execution specialist for git, build, test, deploy, and other shell operations.",
        "system_prompt": (
            "You are a bash command specialist subagent.\n"
            "Execute the requested shell commands carefully.\n"
            "Report command output and any errors clearly.\n"
            "For destructive operations, always verify the target first."
        ),
    },
]


def make_lead_agent(config: RunnableConfig, runtime: ServerRuntime | None = None):
    # Lazy import to avoid circular dependency
    from src.tools import get_available_tools
    from src.tools.builtins import setup_agent

    configurable_payload = config.get("configurable", {})
    if configurable_payload is None:
        configurable_payload = {}
    if not isinstance(configurable_payload, dict):
        raise ValueError("`configurable` must be an object.")

    runtime_context_payload = _extract_runtime_context(runtime)

    cfg = dict(runtime_context_payload)
    cfg.update(configurable_payload)

    thinking_enabled = cfg.get("thinking_enabled", True)
    reasoning_effort = cfg.get("reasoning_effort", None)
    requested_model_raw = cfg.get("model_name") or cfg.get("model")
    requested_model_name: str | None = str(requested_model_raw).strip() if requested_model_raw is not None else None
    if requested_model_name == "":
        requested_model_name = None
    subagent_enabled = cfg.get("subagent_enabled", False)
    max_concurrent_subagents = cfg.get("max_concurrent_subagents", 3)
    is_bootstrap = cfg.get("is_bootstrap", False)
    agent_name_raw = cfg.get("agent_name")
    agent_name = str(agent_name_raw).strip() if agent_name_raw is not None else None
    if agent_name == "":
        agent_name = None

    agent_status_raw = cfg.get("agent_status", "dev")
    agent_status = str(agent_status_raw).strip() if agent_status_raw is not None else "dev"
    if agent_status == "":
        agent_status = "dev"

    thread_id_raw = cfg.get("thread_id")
    thread_id = str(thread_id_raw).strip() if thread_id_raw is not None else None
    if thread_id == "":
        thread_id = None
    user_id_raw = cfg.get("user_id")
    user_id = str(user_id_raw).strip() if user_id_raw is not None else None
    if user_id == "":
        user_id = None
    runtime_model_payload = cfg.get("model_config")

    db_store = get_runtime_db_store()
    if thread_id and user_id:
        db_store.assert_thread_access(thread_id=thread_id, user_id=user_id)

    runtime_model_name = _parse_runtime_model_config(runtime_model_payload)
    agent_config = (
        _load_agent_runtime_config(agent_name=agent_name, agent_status=agent_status, db_store=db_store)
        if (agent_name and not is_bootstrap)
        else None
    )
    model_name, model_config = _resolve_run_model(
        requested_model_name=requested_model_name,
        runtime_model_name=runtime_model_name,
        agent_config=agent_config,
        thread_id=thread_id,
        user_id=user_id,
        db_store=db_store,
    )
    if thread_id and user_id:
        db_store.save_thread_runtime(
            thread_id=thread_id,
            user_id=user_id,
            model_name=model_name,
            agent_name=agent_name,
        )

    if thinking_enabled and not model_config.supports_thinking:
        raise ValueError(f"Thinking mode is enabled but model '{model_name}' does not support thinking.")

    logger.info(
        "Create Agent(%s) -> thinking_enabled: %s, reasoning_effort: %s, model_name: %s, subagent_enabled: %s, agent_status: %s",
        agent_name or "default",
        thinking_enabled,
        reasoning_effort,
        model_name,
        subagent_enabled,
        agent_status,
    )

    # Inject run metadata for LangSmith trace tagging
    if "metadata" not in config:
        config["metadata"] = {}
    config["metadata"].update(
        {
            "agent_name": agent_name or "default",
            "model_name": model_name or "default",
            "thinking_enabled": thinking_enabled,
            "reasoning_effort": reasoning_effort,
            "subagent_enabled": subagent_enabled,
        }
    )

    # Build CompositeBackend (replaces LocalSandbox + replace_virtual_path)
    backend = build_backend(thread_id, agent_name, agent_status)

    # Skills sources for deepagents SkillsMiddleware.
    # For named agents, only use agent-owned skills to avoid implicit fallback.
    if agent_name:
        skills_sources = ["/skills/"]
    else:
        skills_sources = ["/public-skills/"]

    # Memory sources (AGENTS.md loaded from agent definition directory)
    memory_sources = []
    paths = get_paths()
    if agent_name:
        agent_dir = paths.agent_dir(agent_name, agent_status)
        agents_md_path = agent_dir / "AGENTS.md"
        if agents_md_path.exists():
            memory_sources.append(str(agents_md_path))

    # SubAgents (only if enabled)
    subagents = OPENAGENTS_SUBAGENTS if subagent_enabled else None

    # openagents specific extra middlewares
    extra_middleware = _build_openagents_middlewares(model_config)

    # Community tools + MCP tools (sandbox tools provided by deepagents FilesystemMiddleware)
    # Exclude file:read, file:write, bash groups — deepagents provides ls, read_file, write_file, edit_file, execute, glob, grep
    tools = get_available_tools(
        model_name=model_name,
        model_supports_vision=model_config.supports_vision,
        groups=agent_config.tool_groups if agent_config else None,
        exclude_groups=["file:read", "file:write", "bash"],
        mcp_servers=agent_config.mcp_servers if agent_config else None,
        subagent_enabled=False,  # SubAgent handled by deepagents SubAgentMiddleware
    )

    if is_bootstrap:
        tools = tools + [setup_agent]

    # System prompt
    system_prompt = apply_prompt_template(
        subagent_enabled=subagent_enabled,
        max_concurrent_subagents=max_concurrent_subagents,
        agent_name=agent_name,
        available_skills=set(["bootstrap"]) if is_bootstrap else None,
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
        skills=skills_sources if not is_bootstrap else None,
        memory=memory_sources if memory_sources else None,
        backend=backend,
        interrupt_on=interrupt_on,
        name=agent_name or "lead_agent",
    )
