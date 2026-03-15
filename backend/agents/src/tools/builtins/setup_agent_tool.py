import logging
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command
from pydantic import BaseModel, Field

from src.config.agent_materialization import materialize_agent_definition
from src.config.paths import get_paths
from src.tools.builtins.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


class SetupAgentSkillInput(BaseModel):
    """Single skill entry for setup_agent."""

    name: str = Field(
        description=(
            "Skill name. When copying an existing shared/store skill, use the existing skill name. "
            "When creating a brand-new agent-owned skill, use the target local skill name."
        )
    )
    content: str | None = Field(
        default=None,
        description=(
            "Optional full SKILL.md markdown for a brand-new agent-owned skill. "
            "Omit this field when copying an existing shared/store skill by name."
        ),
    )


def _skill_entry_field(skill_entry: SetupAgentSkillInput | dict[str, Any], key: str) -> Any:
    if isinstance(skill_entry, SetupAgentSkillInput):
        return getattr(skill_entry, key, None)
    if isinstance(skill_entry, dict):
        return skill_entry.get(key)
    return getattr(skill_entry, key, None)


def _split_skill_inputs(
    skills: list[SetupAgentSkillInput | dict[str, Any]] | None,
) -> tuple[list[str], list[dict[str, str]]]:
    copied_skill_names: list[str] = []
    inline_skills: list[dict[str, str]] = []

    for skill_entry in skills or []:
        raw_name = _skill_entry_field(skill_entry, "name")
        raw_content = _skill_entry_field(skill_entry, "content")

        if raw_name is None:
            if raw_content is None:
                continue
            raise ValueError("setup_agent skill entries with `content` must also provide `name`.")

        name = str(raw_name).strip()
        if not name:
            if raw_content is None:
                continue
            raise ValueError("setup_agent skill entries require a non-empty `name`.")

        if raw_content is None:
            copied_skill_names.append(name)
            continue

        content = str(raw_content)
        if not content.strip():
            raise ValueError(
                f"setup_agent skill '{name}' provided empty `content`. "
                "Omit `content` to copy an existing skill, or provide the full SKILL.md."
            )
        inline_skills.append({"name": name, "content": content})

    return copied_skill_names, inline_skills


@tool
def setup_agent(
    agents_md: str,
    description: str,
    runtime: ToolRuntime,
    model: str | None = None,
    tool_groups: list[str] | None = None,
    skills: list[SetupAgentSkillInput] | None = None,
) -> Command:
    """Create or update a dev agent definition with copied and/or inline skills.

    Args:
        agents_md: Full AGENTS.md content defining the agent's personality and behavior.
        description: One-line description of what the agent does.
        model: Optional model override for the agent (e.g. "openai/gpt-4o").
        tool_groups: Optional list of tool groups the agent can use.
        skills: Optional list of skill entries.
            Use {"name": "..."} to copy an existing shared/store skill by name.
            Use {"name": "...", "content": "...full SKILL.md..."} to create a new agent-owned skill.
    """

    target_agent_name = runtime_context_value(runtime.context, "target_agent_name") or runtime_context_value(
        runtime.context,
        "agent_name",
    )
    agent_name = str(target_agent_name).strip() if target_agent_name is not None else None

    try:
        if not agent_name:
            raise ValueError("setup_agent requires `agent_name` or `target_agent_name` in runtime context.")

        paths = get_paths()
        agent_status = str(runtime_context_value(runtime.context, "agent_status", "dev")).strip() or "dev"
        copied_skill_names, inline_skills = _split_skill_inputs(skills)
        materialized = materialize_agent_definition(
            name=agent_name,
            status=agent_status,
            agents_md=agents_md,
            description=description,
            model=model,
            tool_groups=tool_groups,
            skill_names=copied_skill_names,
            inline_skills=inline_skills,
            paths=paths,
        )
        materialized_skills = [skill_ref.name for skill_ref in materialized.skill_refs]
        agent_dir = paths.agent_dir(agent_name, agent_status)

        parts = [f"Agent '{agent_name}' created successfully!"]
        if materialized_skills:
            parts.append(f"Skills materialized: {', '.join(materialized_skills)}")

        logger.info(
            "[agent_creator] Created agent '%s' at %s (skills: %s)",
            agent_name,
            agent_dir,
            materialized_skills,
        )
        return Command(
            update={
                "created_agent_name": agent_name,
                "messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)],
            }
        )

    except Exception as e:
        logger.error(f"[agent_creator] Failed to create agent '{agent_name}': {e}", exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {e}", tool_call_id=runtime.tool_call_id)]})
