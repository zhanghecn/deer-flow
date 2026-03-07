from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from deepagents import SubAgent
from langchain.tools import BaseTool

from src.config.paths import get_paths

SUBAGENTS_FILENAME = "subagents.yaml"


def _default_subagents_path() -> Path:
    return Path(__file__).with_name(SUBAGENTS_FILENAME)


def _resolve_subagents_path(agent_name: str | None, agent_status: str) -> Path:
    if agent_name:
        custom_path = get_paths().agent_dir(agent_name, agent_status) / SUBAGENTS_FILENAME
        if custom_path.exists():
            return custom_path
    return _default_subagents_path()


def _require_non_empty_string(value: Any, *, field: str, agent_name: str, source_path: Path) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{source_path}: subagent '{agent_name}' field '{field}' must be a string.")
    text = value.strip()
    if not text:
        raise ValueError(f"{source_path}: subagent '{agent_name}' field '{field}' must be non-empty.")
    return text


def load_subagent_specs(
    tools: list[BaseTool],
    *,
    agent_name: str | None,
    agent_status: str,
) -> list[SubAgent]:
    """Load subagent definitions from YAML and resolve tool names."""
    source_path = _resolve_subagents_path(agent_name, agent_status)
    if not source_path.exists():
        return []

    with source_path.open(encoding="utf-8") as handle:
        raw_data = yaml.safe_load(handle) or {}

    if not isinstance(raw_data, dict):
        raise ValueError(f"{source_path}: subagents config must be a mapping of subagent name -> config.")

    tools_by_name = {tool.name: tool for tool in tools}
    loaded_specs: list[SubAgent] = []

    for raw_subagent_name, raw_spec in raw_data.items():
        if not isinstance(raw_subagent_name, str):
            raise ValueError(f"{source_path}: subagent keys must be strings.")
        subagent_name = raw_subagent_name.strip()
        if not subagent_name:
            raise ValueError(f"{source_path}: subagent name cannot be empty.")
        if not isinstance(raw_spec, dict):
            raise ValueError(f"{source_path}: subagent '{subagent_name}' config must be an object.")

        description = _require_non_empty_string(
            raw_spec.get("description"),
            field="description",
            agent_name=subagent_name,
            source_path=source_path,
        )
        system_prompt = _require_non_empty_string(
            raw_spec.get("system_prompt"),
            field="system_prompt",
            agent_name=subagent_name,
            source_path=source_path,
        )

        spec: SubAgent = {
            "name": subagent_name,
            "description": description,
            "system_prompt": system_prompt,
        }

        raw_model = raw_spec.get("model")
        if raw_model is not None:
            spec["model"] = _require_non_empty_string(
                raw_model,
                field="model",
                agent_name=subagent_name,
                source_path=source_path,
            )

        raw_skills = raw_spec.get("skills")
        if raw_skills is not None:
            if not isinstance(raw_skills, list):
                raise ValueError(f"{source_path}: subagent '{subagent_name}' field 'skills' must be a list.")
            skills = [
                _require_non_empty_string(
                    item,
                    field="skills[]",
                    agent_name=subagent_name,
                    source_path=source_path,
                )
                for item in raw_skills
            ]
            spec["skills"] = skills

        raw_tools = raw_spec.get("tools")
        if raw_tools is not None:
            if not isinstance(raw_tools, list):
                raise ValueError(f"{source_path}: subagent '{subagent_name}' field 'tools' must be a list.")
            resolved_tools: list[BaseTool] = []
            for raw_tool_name in raw_tools:
                tool_name = _require_non_empty_string(
                    raw_tool_name,
                    field="tools[]",
                    agent_name=subagent_name,
                    source_path=source_path,
                )
                tool = tools_by_name.get(tool_name)
                if tool is None:
                    raise ValueError(
                        f"{source_path}: subagent '{subagent_name}' references unknown tool '{tool_name}'."
                    )
                resolved_tools.append(tool)
            spec["tools"] = resolved_tools

        loaded_specs.append(spec)

    return loaded_specs
