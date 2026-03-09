import logging

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.agent_materialization import materialize_agent_definition
from src.config.paths import get_paths

logger = logging.getLogger(__name__)


def _extract_skill_names(skills: list[dict] | None) -> list[str]:
    selected: list[str] = []
    for skill_entry in skills or []:
        raw_name = skill_entry.get("name") if isinstance(skill_entry, dict) else None
        if raw_name is None:
            continue
        name = str(raw_name).strip()
        if name:
            selected.append(name)
    return selected


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
        skills: Optional list of skills to copy from the shared skills library.
            Each entry must provide a "name" key.
    """

    agent_name: str | None = runtime.context.get("agent_name")

    try:
        paths = get_paths()
        if agent_name:
            agent_status = str(runtime.context.get("agent_status", "dev")).strip() or "dev"
            materialized = materialize_agent_definition(
                name=agent_name,
                status=agent_status,
                agents_md=agents_md,
                description=description,
                model=model,
                tool_groups=tool_groups,
                skill_names=_extract_skill_names(skills),
                paths=paths,
            )
            created_skills = [skill_ref.name for skill_ref in materialized.skill_refs]
            agent_dir = paths.agent_dir(agent_name, agent_status)
        else:
            agent_dir = paths.base_dir
            agent_dir.mkdir(parents=True, exist_ok=True)
            (agent_dir / "AGENTS.md").write_text(agents_md, encoding="utf-8")
            created_skills = []

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
        logger.error(f"[agent_creator] Failed to create agent '{agent_name}': {e}", exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {e}", tool_call_id=runtime.tool_call_id)]})
