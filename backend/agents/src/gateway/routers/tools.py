from __future__ import annotations

import logging
from collections.abc import Iterable
from time import perf_counter
from typing import Literal

from deepagents.middleware.filesystem import FilesystemMiddleware
from fastapi import APIRouter
from langchain.agents.middleware.todo import TodoListMiddleware
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from src.config.app_config import load_tool_configs
from src.mcp.library import validate_mcp_profile_payload
from src.mcp.tools import get_mcp_tools_for_extensions_config
from src.reflection import resolve_variable
from src.tools.builtins import setup_agent
from src.tools.tools import (
    AUTHORING_TOOL_REGISTRY,
    COMPATIBILITY_BUILTIN_TOOLS,
    DEFAULT_BUILTIN_TOOLS,
    DEV_BUILTIN_TOOLS,
    MAIN_AGENT_ONLY_TOOL_NAMES,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tools", tags=["tools"])

_MIDDLEWARE_INJECTED_POLICY = "middleware_injected"
_TASK_TOOL_DESCRIPTION = (
    "Delegate a complex, independent task to an isolated subagent when subagents are enabled."
)
class ToolCatalogItemResponse(BaseModel):
    name: str = Field(..., description="Stable tool identifier exposed to the model.")
    group: str = Field(..., description="Logical grouping used by the settings UI.")
    label: str = Field(..., description="Human-readable tool label.")
    description: str = Field(..., description="Short explanation of what the tool does.")
    configurable_for_main_agent: bool = Field(
        ...,
        description="Whether archived main-agent tool_names may include this tool.",
    )
    configurable_for_subagent: bool = Field(
        ...,
        description="Whether archived subagent tool_names may include this tool.",
    )
    reserved_policy: Literal["normal", "main_agent_only", "runtime_only", "middleware_injected"] = Field(
        ...,
        description="Why a tool may be unavailable for explicit archive configuration.",
    )
    source: Literal["builtin", "config", "middleware"] = Field(
        ...,
        description="Where this catalog item comes from.",
    )
    middleware_name: str | None = Field(
        default=None,
        description="Runtime middleware switch that owns this tool, when applicable.",
    )
    middleware_configurable: bool = Field(
        default=False,
        description="Whether the settings UI can enable or disable the owning middleware.",
    )
    read_only_reason: str | None = Field(
        default=None,
        description="Why this tool is visible but not directly filterable from archive settings.",
    )


class ToolCatalogResponse(BaseModel):
    tools: list[ToolCatalogItemResponse]


class MCPProfileDiscoveryItemRequest(BaseModel):
    """One canonical MCP profile payload to inspect from the settings UI."""

    ref: str = Field(..., description="Canonical profile ref or fallback identifier.")
    profile_name: str = Field(..., description="Human-readable profile name from the MCP library.")
    config_json: dict[str, object] = Field(
        ...,
        description="Canonical Claude Code-style mcpServers JSON for this profile.",
    )


class MCPDiscoveredToolResponse(BaseModel):
    """Tool metadata returned by real MCP discovery."""

    name: str = Field(..., description="Stable MCP tool name returned by the server.")
    description: str = Field(default="", description="Tool description reported by the MCP server.")
    input_schema: dict[str, object] = Field(
        default_factory=dict,
        description="JSON schema for tool inputs when available.",
    )


class MCPProfileDiscoveryResultResponse(BaseModel):
    """One profile discovery result shown by the agent settings page."""

    ref: str = Field(..., description="Canonical profile ref or fallback identifier.")
    profile_name: str = Field(..., description="Human-readable profile name from the MCP library.")
    server_name: str | None = Field(
        default=None,
        description="Single server name defined by this profile.",
    )
    reachable: bool = Field(..., description="Whether the MCP server could be initialized and listed.")
    latency_ms: float | None = Field(
        default=None,
        description="Discovery latency in milliseconds when the probe ran.",
    )
    tool_count: int = Field(default=0, description="Number of tools discovered from this profile.")
    tools: list[MCPDiscoveredToolResponse] = Field(
        default_factory=list,
        description="Discovered MCP tools for this profile.",
    )
    error: str | None = Field(
        default=None,
        description="Human-readable discovery failure when reachable is false.",
    )


class MCPProfileDiscoveryBatchRequest(BaseModel):
    """Batch discovery payload for selected MCP profiles."""

    profiles: list[MCPProfileDiscoveryItemRequest] = Field(
        default_factory=list,
        description="Selected MCP profiles to inspect.",
    )


class MCPProfileDiscoveryBatchResponse(BaseModel):
    """Batch discovery result for the settings UI."""

    results: list[MCPProfileDiscoveryResultResponse] = Field(default_factory=list)


def _titleize_tool_name(name: str) -> str:
    parts = name.replace("-", " ").replace("_", " ").split()
    return " ".join(part[:1].upper() + part[1:] for part in parts if part)


def _clean_tool_description(description: str | None, *, fallback: str) -> str:
    cleaned = (description or "").strip()
    if not cleaned:
        return fallback
    return " ".join(line.strip() for line in cleaned.splitlines() if line.strip())


def _group_for_middleware_tool(name: str) -> str:
    if name == "task":
        return "delegation"
    if name == "write_todos":
        return "planning"
    if name == "execute":
        return "execution"
    return "filesystem"


def _group_for_builtin_tool(name: str) -> str:
    if name == "present_files":
        return "output"
    if name == "question":
        return "interaction"
    if name.startswith("get_document_"):
        return "knowledge"
    if name in {
        "install_skill_from_registry",
        "save_agent_to_store",
        "save_skill_to_store",
        "push_agent_prod",
        "push_skill_prod",
        "setup_agent",
    }:
        return "authoring"
    return "builtin"


def _append_catalog_item(
    catalog: dict[str, ToolCatalogItemResponse],
    *,
    name: str,
    group: str,
    label: str,
    description: str,
    configurable_for_main_agent: bool,
    configurable_for_subagent: bool,
    reserved_policy: Literal["normal", "main_agent_only", "runtime_only", "middleware_injected"],
    source: Literal["builtin", "config", "middleware"],
    middleware_name: str | None = None,
    middleware_configurable: bool = False,
    read_only_reason: str | None = None,
) -> None:
    normalized_name = str(name).strip()
    if not normalized_name or normalized_name in catalog:
        return

    catalog[normalized_name] = ToolCatalogItemResponse(
        name=normalized_name,
        group=str(group).strip() or "custom",
        label=str(label).strip() or _titleize_tool_name(normalized_name),
        description=_clean_tool_description(
            description,
            fallback=f"{_titleize_tool_name(normalized_name)} tool.",
        ),
        configurable_for_main_agent=configurable_for_main_agent,
        configurable_for_subagent=configurable_for_subagent,
        reserved_policy=reserved_policy,
        source=source,
        middleware_name=(middleware_name or "").strip() or None,
        middleware_configurable=middleware_configurable,
        read_only_reason=(read_only_reason or "").strip() or None,
    )


def _iter_builtin_tools() -> Iterable[tuple[BaseTool, dict[str, object]]]:
    yielded: set[str] = set()

    for tool in [*DEFAULT_BUILTIN_TOOLS, *COMPATIBILITY_BUILTIN_TOOLS]:
        if tool.name in yielded:
            continue
        yielded.add(tool.name)
        yield tool, {
            "configurable_for_main_agent": True,
            "configurable_for_subagent": tool.name not in MAIN_AGENT_ONLY_TOOL_NAMES,
            "reserved_policy": "main_agent_only" if tool.name in MAIN_AGENT_ONLY_TOOL_NAMES else "normal",
        }

    for tool in [*DEV_BUILTIN_TOOLS, *AUTHORING_TOOL_REGISTRY.values(), setup_agent]:
        if tool.name in yielded:
            continue
        yielded.add(tool.name)
        yield tool, {
            "configurable_for_main_agent": False,
            "configurable_for_subagent": False,
            "reserved_policy": "runtime_only",
        }


def _scan_builtin_tool_catalog() -> list[ToolCatalogItemResponse]:
    catalog: dict[str, ToolCatalogItemResponse] = {}
    for tool, metadata in _iter_builtin_tools():
        _append_catalog_item(
            catalog,
            name=tool.name,
            group=getattr(tool, "group", None) or _group_for_builtin_tool(tool.name),
            label=_titleize_tool_name(tool.name),
            description=getattr(tool, "description", None) or "",
            configurable_for_main_agent=bool(metadata["configurable_for_main_agent"]),
            configurable_for_subagent=bool(metadata["configurable_for_subagent"]),
            reserved_policy=metadata["reserved_policy"],  # type: ignore[arg-type]
            source="builtin",
            read_only_reason=(
                "Runtime-only authoring helper injected by the lead-agent workflow."
                if metadata["reserved_policy"] == "runtime_only"
                else None
            ),
        )
    return list(catalog.values())


def _serialize_schema(schema_candidate: object) -> dict[str, object]:
    """Convert Pydantic schema helpers into plain JSON for the browser."""

    if schema_candidate is None:
        return {}
    if hasattr(schema_candidate, "model_json_schema"):
        try:
            payload = schema_candidate.model_json_schema()
            if isinstance(payload, dict):
                return payload
        except Exception:  # noqa: BLE001 - schema access should not break discovery
            return {}
    if hasattr(schema_candidate, "schema"):
        try:
            payload = schema_candidate.schema()
            if isinstance(payload, dict):
                return payload
        except Exception:  # noqa: BLE001 - schema access should not break discovery
            return {}
    if isinstance(schema_candidate, dict):
        return schema_candidate
    return {}


def _serialize_discovered_tool(tool: BaseTool) -> MCPDiscoveredToolResponse:
    """Normalize LangChain/BaseTool instances into a stable MCP discovery shape."""

    input_schema = {}

    # MCP adapter tools typically expose get_input_schema(), but we keep a
    # fallback chain so future LangChain upgrades do not silently drop schema.
    get_input_schema = getattr(tool, "get_input_schema", None)
    if callable(get_input_schema):
        try:
            input_schema = _serialize_schema(get_input_schema())
        except Exception:  # noqa: BLE001 - fall back to args_schema below
            input_schema = {}

    if not input_schema:
        input_schema = _serialize_schema(getattr(tool, "args_schema", None))

    return MCPDiscoveredToolResponse(
        name=str(getattr(tool, "name", "") or "").strip(),
        description=str(getattr(tool, "description", "") or "").strip(),
        input_schema=input_schema,
    )


async def _discover_mcp_profile(
    profile: MCPProfileDiscoveryItemRequest,
) -> MCPProfileDiscoveryResultResponse:
    """Resolve tools for one explicit MCP profile config."""

    started_at = perf_counter()
    try:
        server_name, extensions_config = validate_mcp_profile_payload(profile.config_json)
        tools = await get_mcp_tools_for_extensions_config(
            extensions_config,
            server_names=[server_name],
        )
        serialized_tools = [_serialize_discovered_tool(tool) for tool in tools]
        return MCPProfileDiscoveryResultResponse(
            ref=profile.ref,
            profile_name=profile.profile_name,
            server_name=server_name,
            reachable=True,
            latency_ms=round((perf_counter() - started_at) * 1000, 2),
            tool_count=len(serialized_tools),
            tools=serialized_tools,
        )
    except Exception as exc:  # noqa: BLE001 - return per-profile error details to the UI
        logger.warning(
            "Failed to discover MCP tools for profile '%s': %s",
            profile.ref,
            exc,
            exc_info=True,
        )
        return MCPProfileDiscoveryResultResponse(
            ref=profile.ref,
            profile_name=profile.profile_name,
            server_name=None,
            reachable=False,
            latency_ms=round((perf_counter() - started_at) * 1000, 2),
            tool_count=0,
            tools=[],
            error=str(exc),
        )


def _scan_configured_tool_catalog() -> list[ToolCatalogItemResponse]:
    catalog: dict[str, ToolCatalogItemResponse] = {}
    tool_configs, _ = load_tool_configs()

    for tool_config in tool_configs:
        try:
            resolved_tool = resolve_variable(tool_config.use, BaseTool)
            description = getattr(resolved_tool, "description", "") or ""
        except Exception as exc:  # noqa: BLE001
            # Keep the catalog visible even if one configured provider import is
            # temporarily broken. Archive settings still need the tool name/group.
            logger.warning(
                "Failed to resolve configured tool '%s' from '%s': %s",
                tool_config.name,
                tool_config.use,
                exc,
            )
            description = "Configured runtime tool from config.yaml."

        _append_catalog_item(
            catalog,
            name=tool_config.name,
            group=tool_config.group,
            label=_titleize_tool_name(tool_config.name),
            description=description,
            configurable_for_main_agent=True,
            configurable_for_subagent=True,
            reserved_policy="normal",
            source="config",
        )

    return list(catalog.values())


def _scan_middleware_tool_catalog() -> list[ToolCatalogItemResponse]:
    catalog: dict[str, ToolCatalogItemResponse] = {}

    filesystem_tools = FilesystemMiddleware().tools
    for tool in filesystem_tools:
        _append_catalog_item(
            catalog,
            name=tool.name,
            group=_group_for_middleware_tool(tool.name),
            label=_titleize_tool_name(tool.name),
            description=getattr(tool, "description", "") or "",
            configurable_for_main_agent=False,
            configurable_for_subagent=False,
            reserved_policy=_MIDDLEWARE_INJECTED_POLICY,
            source="middleware",
            middleware_name="filesystem",
            middleware_configurable=True,
            read_only_reason=(
                "Injected by FilesystemMiddleware unless the agent runtime middleware deny-list disables it."
            ),
        )

    for tool in TodoListMiddleware().tools:
        _append_catalog_item(
            catalog,
            name=tool.name,
            group=_group_for_middleware_tool(tool.name),
            label=_titleize_tool_name(tool.name),
            description=getattr(tool, "description", "") or "",
            configurable_for_main_agent=False,
            configurable_for_subagent=False,
            reserved_policy=_MIDDLEWARE_INJECTED_POLICY,
            source="middleware",
            middleware_name="todo",
            middleware_configurable=True,
            read_only_reason=(
                "Injected for plan-mode runs by TodoListMiddleware unless the agent runtime middleware deny-list disables todo."
            ),
        )

    _append_catalog_item(
        catalog,
        name="task",
        group=_group_for_middleware_tool("task"),
        label="Task",
        description=_TASK_TOOL_DESCRIPTION,
        configurable_for_main_agent=False,
        configurable_for_subagent=False,
        reserved_policy=_MIDDLEWARE_INJECTED_POLICY,
        source="middleware",
        middleware_name="subagents",
        middleware_configurable=True,
        read_only_reason=(
            "Injected by SubAgentMiddleware when per-turn delegation and the agent subagents middleware are enabled."
        ),
    )

    return list(catalog.values())


def build_runtime_tool_catalog() -> list[ToolCatalogItemResponse]:
    """Return the runtime-owned tool catalog for the settings UI.

    The archive manifest only controls explicitly configured runtime tools. The
    actual run graph also injects middleware-owned tools afterward, so this
    catalog intentionally scans both layers and annotates which entries remain
    read-only from the archive settings screen.
    """

    items = [
        *_scan_builtin_tool_catalog(),
        *_scan_configured_tool_catalog(),
        *_scan_middleware_tool_catalog(),
    ]
    return sorted(items, key=lambda item: (item.group, item.name))


@router.get(
    "/catalog",
    response_model=ToolCatalogResponse,
    summary="List runtime-aware tool catalog",
)
async def list_tool_catalog() -> ToolCatalogResponse:
    return ToolCatalogResponse(tools=build_runtime_tool_catalog())


@router.post(
    "/mcp/discover",
    response_model=MCPProfileDiscoveryBatchResponse,
    summary="Discover tools from explicit MCP profiles",
)
async def discover_mcp_profiles(
    request: MCPProfileDiscoveryBatchRequest,
) -> MCPProfileDiscoveryBatchResponse:
    """Probe only the selected MCP profiles from the settings UI.

    The gateway stores canonical Claude Code-style `mcpServers` JSON, but the
    actual tool surface is runtime-owned. This route keeps the UI honest by
    resolving the selected profiles through the same MCP adapter stack used at
    execution time instead of trusting static JSON alone.
    """

    results = [
        await _discover_mcp_profile(profile)
        for profile in request.profiles
    ]
    return MCPProfileDiscoveryBatchResponse(results=results)
