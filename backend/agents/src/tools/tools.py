import asyncio
import logging
from collections.abc import Sequence
from typing import Any

from langchain.tools import BaseTool

from src.config.app_config import load_tool_configs
from src.config.runtime_db import get_runtime_db_store
from src.reflection import resolve_variable
from src.tools.builtins import (
    get_document_evidence,
    get_document_image,
    get_document_tree,
    get_document_tree_node_detail,
    install_skill_from_registry,
    present_file_tool,
    push_agent_prod,
    push_skill_prod,
    question_tool,
    save_agent_to_store,
    save_skill_to_store,
    setup_agent,
)

logger = logging.getLogger(__name__)

# Knowledge tools are kept adjacent so the KB protocol stays easy to audit.
# Only the default slice joins the common runtime surface; compatibility tools
# remain opt-in via explicit `tool_names=[...]`.
DEFAULT_KNOWLEDGE_BUILTIN_TOOLS = [
    get_document_tree,
    get_document_evidence,
    get_document_image,
]
COMPATIBILITY_KNOWLEDGE_BUILTIN_TOOLS = [
    get_document_tree_node_detail,
]

# Default built-ins are part of the common runtime surface for normal agent work.
# Keep this list small and stable because every addition broadens what any agent can
# call when it relies on `tool_groups` instead of an explicit `tool_names` whitelist.
DEFAULT_BUILTIN_TOOLS = [
    present_file_tool,
    question_tool,
    *DEFAULT_KNOWLEDGE_BUILTIN_TOOLS,
]
# Compatibility built-ins remain implemented for archived agents or niche flows
# that opt into them explicitly via `tool_names=[...]`, but they are intentionally
# excluded from the default runtime surface.
COMPATIBILITY_BUILTIN_TOOLS = [
    *COMPATIBILITY_KNOWLEDGE_BUILTIN_TOOLS,
]
# Dev-only built-ins are repository-specific authoring helpers. They are not a
# LangChain convention; this repo exposes them only for dev archives because prod
# agents must not mutate agent/skill archives or install new capabilities.
DEV_BUILTIN_TOOLS = [
    install_skill_from_registry,
]

AUTHORING_TOOL_REGISTRY = {
    "save_agent_to_store": save_agent_to_store,
    "save_skill_to_store": save_skill_to_store,
    "push_agent_prod": push_agent_prod,
    "push_skill_prod": push_skill_prod,
}

MAIN_AGENT_ONLY_TOOL_NAMES = frozenset({"question"})


def _run_async_tool_loader(coro) -> list[BaseTool]:
    """Run a small MCP-loading coroutine from sync code.

    Tool assembly still happens on synchronous code paths. When the caller is
    already inside an event loop, fall back to a short-lived worker thread so
    the explicit agent-scoped MCP subset path can still initialize tools
    without reviving the global singleton cache.
    """

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor() as executor:
        return executor.submit(asyncio.run, coro).result()


def _normalize_requested_tool_names(tool_names: Sequence[str] | None) -> list[str] | None:
    if tool_names is None:
        return None

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_name in tool_names:
        name = str(raw_name).strip()
        if not name or name in seen:
            continue
        normalized.append(name)
        seen.add(name)
    return normalized


def _dedupe_tool_items(tool_items: Sequence[tuple[str, Any]]) -> list[Any]:
    deduped: list[Any] = []
    seen: set[str] = set()
    for name, tool in tool_items:
        if not name or name in seen:
            continue
        deduped.append(tool)
        seen.add(name)
    return deduped


def _load_configured_tool_items(*, groups: Sequence[str] | None = None) -> list[tuple[str, Any]]:
    tool_configs, _ = load_tool_configs()
    configured_items: list[tuple[str, Any]] = []
    for tool_config in tool_configs:
        if groups is not None and tool_config.group not in groups:
            continue
        configured_items.append((tool_config.name, resolve_variable(tool_config.use, BaseTool)))
    return configured_items


def _load_mcp_tool_items(
    *,
    include_mcp: bool,
    mcp_servers: Sequence[str] | None,
) -> list[tuple[str, BaseTool]]:
    if not include_mcp:
        return []

    try:
        from src.config.extensions_config import ExtensionsConfig
        from src.mcp.cache import get_cached_mcp_tools
        from src.mcp.library import build_extensions_config_for_profile_refs, is_mcp_profile_ref
        from src.mcp.tools import get_mcp_tools_for_extensions_config

        normalized_servers = [str(server).strip() for server in (mcp_servers or []) if str(server).strip()]
        profile_refs = [server for server in normalized_servers if is_mcp_profile_ref(server)]
        legacy_server_names = [server for server in normalized_servers if not is_mcp_profile_ref(server)]

        explicit_tools: list[BaseTool] = []
        if profile_refs:
            # Agent-scoped MCP bindings now prefer canonical library refs. Those refs
            # describe the active runtime subset directly, so they must bypass the
            # legacy global-config cache instead of reconnecting every globally
            # enabled server and filtering afterward.
            explicit_config = build_extensions_config_for_profile_refs(profile_refs)
            if explicit_config.get_enabled_mcp_servers():
                explicit_tools = _run_async_tool_loader(
                    get_mcp_tools_for_extensions_config(explicit_config)
                )

        extensions_config = ExtensionsConfig.from_file()
        cached_tools: list[BaseTool] = []
        if extensions_config.get_enabled_mcp_servers():
            requested_cached_names = legacy_server_names if normalized_servers else None
            cached_tools = get_cached_mcp_tools(server_names=requested_cached_names)
            if cached_tools:
                server_desc = (
                    f"from legacy servers {legacy_server_names}"
                    if legacy_server_names
                    else "from all servers"
                )
                logger.info("Using %s cached MCP tool(s) %s", len(cached_tools), server_desc)

        if not explicit_tools and not cached_tools:
            return []

        mcp_tools = [*explicit_tools, *cached_tools]
        if mcp_tools:
            server_desc = (
                f"from profile refs {profile_refs} and legacy servers {legacy_server_names}"
                if profile_refs and legacy_server_names
                else f"from profile refs {profile_refs}"
                if profile_refs
                else f"from servers {list(mcp_servers)}"
                if mcp_servers is not None
                else "from all servers"
            )
            logger.info("Resolved %s MCP tool(s) %s", len(mcp_tools), server_desc)
        return [(tool.name, tool) for tool in mcp_tools]
    except ImportError:
        logger.warning("MCP module not available. Install 'langchain-mcp-adapters' package to enable MCP tools.")
    except Exception as e:
        logger.error("Failed to get cached MCP tools: %s", e)
    return []


def _resolve_builtin_tool_items(
    *,
    model_name: str | None,
    model_supports_vision: bool | None,
    agent_status: str | None,
    authoring_actions: Sequence[str] | None,
    always_available_authoring_actions: Sequence[str] | None,
    setup_agent_enabled: bool,
    include_compatibility: bool = False,
) -> list[tuple[str, BaseTool]]:
    builtin_tools = DEFAULT_BUILTIN_TOOLS.copy()
    if include_compatibility:
        # Archived agents may opt into compatibility tools explicitly without
        # broadening the default runtime tool surface for every agent.
        for tool in COMPATIBILITY_BUILTIN_TOOLS:
            if tool not in builtin_tools:
                builtin_tools.append(tool)
    if setup_agent_enabled and setup_agent not in builtin_tools:
        builtin_tools.append(setup_agent)

    if agent_status == "dev":
        for tool in DEV_BUILTIN_TOOLS:
            if tool not in builtin_tools:
                builtin_tools.append(tool)
        requested_authoring_actions = list(authoring_actions or [])
        for action in always_available_authoring_actions or []:
            if action not in requested_authoring_actions:
                requested_authoring_actions.append(action)
        for action in requested_authoring_actions:
            authoring_tool = AUTHORING_TOOL_REGISTRY.get(action)
            if authoring_tool is None or authoring_tool in builtin_tools:
                continue
            builtin_tools.append(authoring_tool)

    if model_supports_vision is None:
        model_config = get_runtime_db_store().get_model(model_name) if model_name else None
        model_supports_vision = bool(model_config and model_config.supports_vision)

    return [(tool.name, tool) for tool in builtin_tools]


def _tool_items_by_name(
    *,
    include_mcp: bool,
    mcp_servers: Sequence[str] | None,
    model_name: str | None,
    model_supports_vision: bool | None,
    agent_status: str | None,
    authoring_actions: Sequence[str] | None,
    always_available_authoring_actions: Sequence[str] | None,
    setup_agent_enabled: bool,
) -> dict[str, Any]:
    # Explicit `tool_names` resolution must see both normal built-ins and
    # opt-in compatibility built-ins. Otherwise an archived agent manifest can
    # validly reference a built-in tool that exists in code but is hidden from
    # the default surface, which is exactly how the contract-reviewer bug slipped in.
    all_items = [
        *_load_configured_tool_items(),
        *_resolve_builtin_tool_items(
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
            authoring_actions=authoring_actions,
            always_available_authoring_actions=always_available_authoring_actions,
            setup_agent_enabled=setup_agent_enabled,
            include_compatibility=True,
        ),
        *_load_mcp_tool_items(
            include_mcp=include_mcp,
            mcp_servers=mcp_servers,
        ),
    ]
    return {name: tool for name, tool in all_items}


def is_main_agent_only_tool(tool_name: str | None) -> bool:
    if tool_name is None:
        return False
    return tool_name in MAIN_AGENT_ONLY_TOOL_NAMES


def filter_main_agent_only_tools(tools: Sequence[BaseTool]) -> list[BaseTool]:
    return [tool for tool in tools if not is_main_agent_only_tool(getattr(tool, "name", None))]


def get_available_tools(
    groups: list[str] | None = None,
    tool_names: list[str] | None = None,
    include_mcp: bool = True,
    mcp_servers: list[str] | None = None,
    model_name: str | None = None,
    model_supports_vision: bool | None = None,
    agent_status: str | None = None,
    authoring_actions: list[str] | None = None,
    always_available_tool_names: list[str] | None = None,
    always_available_authoring_actions: list[str] | None = None,
    setup_agent_enabled: bool = False,
) -> list[BaseTool]:
    """Get the tools available to the runtime.

    This loader is repository policy, not a LangChain rule. OpenAgents combines:
    - configured tools from `config.yaml` tool groups,
    - repository-owned built-in tools,
    - dev-only authoring helpers,
    - opt-in compatibility built-ins,
    - MCP tools.

    Explicit ``tool_names`` take precedence over ``groups``. When ``tool_names``
    is omitted, configured tools are selected by group and then merged with the
    applicable built-ins and MCP tools.
    """

    requested_tool_names = _normalize_requested_tool_names(tool_names)
    contextual_tool_names = _normalize_requested_tool_names(always_available_tool_names)
    if requested_tool_names is not None and contextual_tool_names:
        # Explicit archive tool_names stay canonical for the normal runtime
        # surface, but dev-only runtime authoring helpers must still be additive
        # so lead_agent can create agents/skills from plain natural language.
        requested_tool_names = [
            *requested_tool_names,
            *[name for name in contextual_tool_names if name not in requested_tool_names],
        ]
    if requested_tool_names is not None:
        available_by_name = _tool_items_by_name(
            include_mcp=include_mcp,
            mcp_servers=mcp_servers,
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
            authoring_actions=authoring_actions,
            always_available_authoring_actions=always_available_authoring_actions,
            setup_agent_enabled=setup_agent_enabled,
        )

        resolved: list[BaseTool] = []
        missing: list[str] = []
        for name in requested_tool_names:
            tool = available_by_name.get(name)
            if tool is None:
                missing.append(name)
                continue
            resolved.append(tool)
        if missing:
            joined = ", ".join(missing)
            raise ValueError(f"Unknown tool name(s): {joined}.")

        # `tool_names` is the explicit whitelist for normal runtime/configured
        # tools. Agent-scoped MCP bindings are selected separately by
        # `mcp_servers`, so keep them additive even when the explicit whitelist
        # is empty. This preserves the intuitive "only MCP tools" operator flow.
        mcp_tool_items = _load_mcp_tool_items(
            include_mcp=include_mcp,
            mcp_servers=mcp_servers,
        )
        if not mcp_tool_items:
            return resolved
        return _dedupe_tool_items(
            [
                *((getattr(tool, "name", ""), tool) for tool in resolved),
                *mcp_tool_items,
            ]
        )

    tool_items = [
        *_load_configured_tool_items(groups=groups),
        *_resolve_builtin_tool_items(
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
            authoring_actions=authoring_actions,
            always_available_authoring_actions=always_available_authoring_actions,
            setup_agent_enabled=setup_agent_enabled,
        ),
        *_load_mcp_tool_items(
            include_mcp=include_mcp,
            mcp_servers=mcp_servers,
        ),
    ]
    if contextual_tool_names:
        available_by_name = _tool_items_by_name(
            include_mcp=include_mcp,
            mcp_servers=mcp_servers,
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
            authoring_actions=authoring_actions,
            always_available_authoring_actions=always_available_authoring_actions,
            setup_agent_enabled=setup_agent_enabled,
        )
        missing_contextual: list[str] = []
        for name in contextual_tool_names:
            tool = available_by_name.get(name)
            if tool is None:
                missing_contextual.append(name)
                continue
            tool_items.append((name, tool))
        if missing_contextual:
            joined = ", ".join(missing_contextual)
            raise ValueError(f"Unknown contextual tool name(s): {joined}.")
    return _dedupe_tool_items(tool_items)
