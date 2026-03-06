import logging

import yaml
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.paths import get_paths

logger = logging.getLogger(__name__)


@tool
def setup_agent(
    agents_md: str,
    description: str,
    runtime: ToolRuntime,
    model: str | None = None,
    tool_groups: list[str] | None = None,
    skills: list[dict] | None = None,
) -> Command:
    """Setup the custom OpenAgents agent with optional skills.

    Args:
        agents_md: Full AGENTS.md content defining the agent's personality and behavior.
        description: One-line description of what the agent does.
        model: Optional model override for the agent (e.g. "openai/gpt-4o").
        tool_groups: Optional list of tool groups the agent can use.
        skills: Optional list of skills to create for this agent.
            Each skill is a dict with "name" (str) and "skill_md" (str) keys.
    """

    agent_name: str | None = runtime.context.get("agent_name")

    try:
        paths = get_paths()
        agent_dir = paths.agent_dir(agent_name) if agent_name else paths.base_dir
        agent_dir.mkdir(parents=True, exist_ok=True)

        if agent_name:
            config_data: dict = {"name": agent_name}
            if description:
                config_data["description"] = description
            if model is not None:
                config_data["model"] = model
            if tool_groups is not None:
                config_data["tool_groups"] = tool_groups

            config_file = agent_dir / "config.yaml"
            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)

        agents_md_file = agent_dir / "AGENTS.md"
        agents_md_file.write_text(agents_md, encoding="utf-8")

        # Write agent-specific skills
        created_skills = []
        if skills:
            skills_dir = agent_dir / "skills"
            for skill_entry in skills:
                skill_name = skill_entry.get("name", "").strip()
                skill_md = skill_entry.get("skill_md", "").strip()
                if not skill_name or not skill_md:
                    continue
                skill_dir = skills_dir / skill_name
                skill_dir.mkdir(parents=True, exist_ok=True)
                (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
                created_skills.append(skill_name)

        parts = [f"Agent '{agent_name}' created successfully!"]
        if created_skills:
            parts.append(f"Skills created: {', '.join(created_skills)}")

        logger.info(f"[agent_creator] Created agent '{agent_name}' at {agent_dir} (skills: {created_skills})")
        return Command(
            update={
                "created_agent_name": agent_name,
                "messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)],
            }
        )

    except Exception as e:
        import shutil

        if agent_name and agent_dir.exists():
            shutil.rmtree(agent_dir)
        logger.error(f"[agent_creator] Failed to create agent '{agent_name}': {e}", exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {e}", tool_call_id=runtime.tool_call_id)]})
