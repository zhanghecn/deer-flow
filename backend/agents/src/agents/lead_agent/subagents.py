from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from deepagents import SubAgent
from langchain.tools import BaseTool

from src.config.agents_config import (
    SUBAGENTS_FILENAME,
    AgentConfig,
    AgentSubagentConfig,
    AgentSubagentsConfig,
    _parse_agent_subagents_payload,
)
from src.config.paths import get_paths
from src.tools.tools import filter_main_agent_only_tools, get_available_tools


@dataclass(frozen=True)
class LoadedSubagentSpecs:
    custom_subagents: list[SubAgent]
    general_purpose_enabled: bool
    general_purpose_tools: list[BaseTool]


def _default_subagents_path() -> Path:
    return Path(__file__).with_name(SUBAGENTS_FILENAME)


def _resolve_subagents_path(agent_name: str | None, agent_status: str) -> Path:
    if agent_name:
        custom_path = get_paths().agent_dir(agent_name, agent_status) / SUBAGENTS_FILENAME
        if custom_path.exists():
            return custom_path
    return _default_subagents_path()


def _load_subagents_config(source_path: Path) -> AgentSubagentsConfig:
    if not source_path.exists():
        return AgentSubagentsConfig()

    with source_path.open(encoding="utf-8") as handle:
        raw_data = yaml.safe_load(handle)

    return _parse_agent_subagents_payload(raw_data, source_path=source_path)


def _resolve_subagent_tools(
    *,
    tool_names: list[str] | None,
    inherited_tools: list[BaseTool],
    agent_config: AgentConfig,
    model_name: str | None,
    model_supports_vision: bool | None,
    agent_status: str,
) -> list[BaseTool]:
    if tool_names is None:
        return filter_main_agent_only_tools(inherited_tools)

    resolved = get_available_tools(
        tool_names=tool_names,
        mcp_servers=agent_config.mcp_servers,
        model_name=model_name,
        model_supports_vision=model_supports_vision,
        agent_status=agent_status,
        include_mcp=True,
    )
    return filter_main_agent_only_tools(resolved)


def _build_subagent_spec(
    subagent: AgentSubagentConfig,
    *,
    inherited_tools: list[BaseTool],
    agent_config: AgentConfig,
    model_name: str | None,
    model_supports_vision: bool | None,
    agent_status: str,
) -> SubAgent:
    spec: SubAgent = {
        "name": subagent.name,
        "description": subagent.description,
        "system_prompt": subagent.system_prompt,
        "tools": _resolve_subagent_tools(
            tool_names=subagent.tool_names,
            inherited_tools=inherited_tools,
            agent_config=agent_config,
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
        ),
    }
    if subagent.model is not None:
        spec["model"] = subagent.model
    return spec


def load_subagent_specs(
    main_tools: list[BaseTool],
    *,
    agent_config: AgentConfig,
    agent_status: str,
    model_name: str | None,
    model_supports_vision: bool | None,
) -> LoadedSubagentSpecs:
    """Load subagent definitions from YAML and resolve tool allowlists."""
    source_path = _resolve_subagents_path(agent_config.name, agent_status)
    config = _load_subagents_config(source_path)

    inherited_tools = filter_main_agent_only_tools(main_tools)
    general_purpose_tools = _resolve_subagent_tools(
        tool_names=agent_config.subagent_defaults.tool_names,
        inherited_tools=inherited_tools,
        agent_config=agent_config,
        model_name=model_name,
        model_supports_vision=model_supports_vision,
        agent_status=agent_status,
    )

    custom_subagents = [
        _build_subagent_spec(
            subagent,
            inherited_tools=inherited_tools,
            agent_config=agent_config,
            model_name=model_name,
            model_supports_vision=model_supports_vision,
            agent_status=agent_status,
        )
        for subagent in config.subagents
        if subagent.enabled
    ]

    return LoadedSubagentSpecs(
        custom_subagents=custom_subagents,
        general_purpose_enabled=agent_config.subagent_defaults.general_purpose_enabled,
        general_purpose_tools=general_purpose_tools,
    )
