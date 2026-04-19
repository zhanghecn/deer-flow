from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Literal

from fastapi import APIRouter
from langchain.agents.middleware.todo import TodoListMiddleware
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from deepagents.middleware.filesystem import FilesystemMiddleware
from src.config.app_config import load_tool_configs
from src.reflection import resolve_variable
from src.tools.tools import (
    AUTHORING_TOOL_REGISTRY,
    COMPATIBILITY_BUILTIN_TOOLS,
    DEFAULT_BUILTIN_TOOLS,
    DEV_BUILTIN_TOOLS,
    MAIN_AGENT_ONLY_TOOL_NAMES,
)
from src.tools.builtins import setup_agent, view_image_tool

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
    read_only_reason: str | None = Field(
        default=None,
        description="Why this tool is visible but not directly filterable from archive settings.",
    )


class ToolCatalogResponse(BaseModel):
    tools: list[ToolCatalogItemResponse]


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
    if name == "view_image":
        return "preview"
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
        read_only_reason=(read_only_reason or "").strip() or None,
    )


def _iter_builtin_tools() -> Iterable[tuple[BaseTool, dict[str, object]]]:
    yielded: set[str] = set()

    for tool in [*DEFAULT_BUILTIN_TOOLS, *COMPATIBILITY_BUILTIN_TOOLS, view_image_tool]:
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
            read_only_reason=(
                "Injected by FilesystemMiddleware for runtime file access; archive tool_names cannot remove it."
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
            read_only_reason=(
                "Injected only for plan-mode runs by TodoListMiddleware; archive tool_names do not control it."
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
        read_only_reason=(
            "Injected by SubAgentMiddleware when general-purpose or custom subagents are enabled."
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
