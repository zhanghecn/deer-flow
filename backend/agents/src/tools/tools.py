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
    install_skill_from_registry,
    list_knowledge_documents,
    present_file_tool,
    promote_skill_shared,
    push_agent_prod,
    push_skill_prod,
    question_tool,
    save_agent_to_store,
    save_skill_to_store,
    skill_tool,
    setup_agent,
    view_image_tool,
)

logger = logging.getLogger(__name__)

BUILTIN_TOOLS = [
    skill_tool,
    present_file_tool,
    question_tool,
    list_knowledge_documents,
    get_document_tree,
    get_document_evidence,
    get_document_image,
]
DEV_BUILTIN_TOOLS = [
    install_skill_from_registry,
]

AUTHORING_TOOL_REGISTRY = {
    "save_agent_to_store": save_agent_to_store,
    "save_skill_to_store": save_skill_to_store,
    "push_agent_prod": push_agent_prod,
    "push_skill_prod": push_skill_prod,
    "promote_skill_shared": promote_skill_shared,
}

MAIN_AGENT_ONLY_TOOL_NAMES = frozenset({"question"})


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

        extensions_config = ExtensionsConfig.from_file()
        if not extensions_config.get_enabled_mcp_servers():
            return []

        mcp_tools = get_cached_mcp_tools(server_names=list(mcp_servers) if mcp_servers is not None else None)
        if mcp_tools:
            server_desc = f"from servers {list(mcp_servers)}" if mcp_servers is not None else "from all servers"
            logger.info("Using %s cached MCP tool(s) %s", len(mcp_tools), server_desc)
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
    setup_agent_enabled: bool,
) -> list[tuple[str, BaseTool]]:
    builtin_tools = BUILTIN_TOOLS.copy()
    if agent_status == "dev":
        for tool in DEV_BUILTIN_TOOLS:
            if tool not in builtin_tools:
                builtin_tools.append(tool)
        if setup_agent_enabled and setup_agent not in builtin_tools:
            builtin_tools.append(setup_agent)
        for action in authoring_actions or []:
            authoring_tool = AUTHORING_TOOL_REGISTRY.get(action)
            if authoring_tool is None or authoring_tool in builtin_tools:
                continue
            builtin_tools.append(authoring_tool)

    if model_supports_vision is None:
        model_config = get_runtime_db_store().get_model(model_name) if model_name else None
        model_supports_vision = bool(model_config and model_config.supports_vision)

    if model_supports_vision and view_image_tool not in builtin_tools:
        builtin_tools.append(view_image_tool)
        logger.info("Including view_image_tool for model '%s' (supports_vision=True)", model_name)

    return [(tool.name, tool) for tool in builtin_tools]


def _tool_items_by_name(
    *,
    include_mcp: bool,
    mcp_servers: Sequence[str] | None,
    model_name: str | None,
    model_supports_vision: bool | None,
    agent_status: str | None,
    authoring_actions: Sequence[str] | None,
    setup_agent_enabled: bool,
) -> dict[str, Any]:
    all_items = [
        *_load_configured_tool_items(),
        *_resolve_builtin_tool_items(
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
            authoring_actions=authoring_actions,
            setup_agent_enabled=setup_agent_enabled,
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
    setup_agent_enabled: bool = False,
) -> list[BaseTool]:
    """Get the tools available to the runtime.

    Explicit ``tool_names`` take precedence over ``groups``. When ``tool_names``
    is omitted, configured tools are selected by group and then merged with the
    applicable built-ins and MCP tools.
    """

    requested_tool_names = _normalize_requested_tool_names(tool_names)
    if requested_tool_names is not None:
        available_by_name = _tool_items_by_name(
            include_mcp=include_mcp,
            mcp_servers=mcp_servers,
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
            authoring_actions=authoring_actions,
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
        return resolved

    tool_items = [
        *_load_configured_tool_items(groups=groups),
        *_resolve_builtin_tool_items(
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
            authoring_actions=authoring_actions,
            setup_agent_enabled=setup_agent_enabled,
        ),
        *_load_mcp_tool_items(
            include_mcp=include_mcp,
            mcp_servers=mcp_servers,
        ),
    ]
    return _dedupe_tool_items(tool_items)
