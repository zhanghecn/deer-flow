import logging

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.paths import get_paths
from src.tools.builtins.authoring_persistence import promote_skill_directory_to_shared

logger = logging.getLogger(__name__)


@tool
def promote_skill_shared(
    runtime: ToolRuntime,
    skill_name: str,
) -> Command:
    """Promote a prod store skill into `.openagents/skills/shared`.

    Args:
        skill_name: Skill name or relative path under the skill store.
    """

    try:
        target_dir, backup_dir = promote_skill_directory_to_shared(skill_name, paths=get_paths())
        parts = [f"Skill '{skill_name}' promoted to {target_dir}."]
        if backup_dir is not None:
            parts.append(f"Previous shared version backed up to {backup_dir}.")
        return Command(update={"messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)]})
    except Exception as exc:
        logger.error("Failed to promote skill '%s' to shared: %s", skill_name, exc, exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {exc}", tool_call_id=runtime.tool_call_id)]})
