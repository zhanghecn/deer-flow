import logging

from deepagents import SubAgent, create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend, LocalShellBackend
from langchain_core.runnables import RunnableConfig

from src.agents.lead_agent.prompt import apply_prompt_template
from src.agents.middlewares.thread_data_middleware import ThreadDataMiddleware
from src.agents.middlewares.title_middleware import TitleMiddleware
from src.agents.middlewares.uploads_middleware import UploadsMiddleware
from src.agents.middlewares.view_image_middleware import ViewImageMiddleware
from src.config.agents_config import load_agent_config
from src.config.app_config import get_app_config
from src.config.model_config import ModelConfig
from src.config.paths import get_paths
from src.config.summarization_config import get_summarization_config
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


def _build_openagents_middlewares(model_name: str | None, runtime_model_config: ModelConfig | None = None):
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

    model_config = runtime_model_config
    if model_config is None:
        app_config = get_app_config()
        model_config = app_config.get_model_config(model_name) if model_name else None
    if model_config is not None and model_config.supports_vision:
        middlewares.append(ViewImageMiddleware())

    return middlewares


def _parse_runtime_model_config(payload: object) -> ModelConfig | None:
    if payload is None:
        return None
    if isinstance(payload, ModelConfig):
        return payload
    if isinstance(payload, dict):
        return ModelConfig.model_validate(payload)
    raise ValueError("`configurable.model_config` must be an object.")


def _resolve_run_model(
    *,
    requested_model_name: str | None,
    runtime_model_config: ModelConfig | None,
    agent_model_name: str | None,
) -> tuple[str, ModelConfig]:
    """Resolve run model with explicit precedence and no implicit fallback."""
    if runtime_model_config is not None:
        if requested_model_name and requested_model_name != runtime_model_config.name:
            raise ValueError(
                "Model conflict: `configurable.model_name` and `configurable.model_config.name` must match."
            )
        return runtime_model_config.name, runtime_model_config

    model_name = requested_model_name or agent_model_name
    if not model_name:
        raise ValueError(
            "No model resolved for this run. Provide `configurable.model_name`/`model`, "
            "or `configurable.model_config`, or set `agent.model`."
        )

    app_config = get_app_config()
    model_config = app_config.get_model_config(model_name)
    if model_config is None:
        raise ValueError(
            "Resolved model is not available. Provide a valid `configurable.model_name`/`model`, "
            "or inject `configurable.model_config`, or configure the model in config.yaml / OPENAGENTS_MODELS_JSON."
        )
    return model_name, model_config


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
        "name": "explore",
        "description": "File search specialist for navigating large codebases quickly with glob/grep/read patterns and returning precise file-level findings.",
        "system_prompt": (
            "You are a file search specialist. You excel at thoroughly navigating and exploring codebases.\n"
            "Your strengths:\n"
            "- Rapidly finding files using glob patterns\n"
            "- Searching code and text using grep patterns\n"
            "- Reading and analyzing file contents with pagination\n"
            "Guidelines:\n"
            "- Use glob for broad file pattern matching\n"
            "- Use grep for locating relevant content, then read_file for focused inspection\n"
            "- Return absolute file paths in your final answer\n"
            "- Do not modify files unless the caller explicitly asks you to edit\n"
            "- Keep findings concise and structured for handoff to the parent agent"
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


def make_lead_agent(config: RunnableConfig):
    # Lazy import to avoid circular dependency
    from src.tools import get_available_tools
    from src.tools.builtins import setup_agent

    cfg = config.get("configurable", {})

    thinking_enabled = cfg.get("thinking_enabled", True)
    reasoning_effort = cfg.get("reasoning_effort", None)
    requested_model_name: str | None = cfg.get("model_name") or cfg.get("model")
    subagent_enabled = cfg.get("subagent_enabled", False)
    max_concurrent_subagents = cfg.get("max_concurrent_subagents", 3)
    is_bootstrap = cfg.get("is_bootstrap", False)
    agent_name = cfg.get("agent_name")
    agent_status = cfg.get("agent_status", "dev")
    thread_id = cfg.get("thread_id")
    runtime_model_payload = cfg.get("model_config")

    runtime_model_config = _parse_runtime_model_config(runtime_model_payload)
    agent_config = load_agent_config(agent_name, status=agent_status) if (agent_name and not is_bootstrap) else None
    agent_model_name = agent_config.model if agent_config else None
    model_name, model_config = _resolve_run_model(
        requested_model_name=requested_model_name,
        runtime_model_config=runtime_model_config,
        agent_model_name=agent_model_name,
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
    extra_middleware = _build_openagents_middlewares(model_name, runtime_model_config=model_config)

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
    summarization_prompt = get_summarization_config().summary_prompt

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
        summarization_prompt=summarization_prompt,
        name=agent_name or "lead_agent",
    )
