import logging

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.paths import get_paths
from src.tools.builtins.authoring_persistence import push_skill_directory_to_prod
from src.utils.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


@tool
def push_skill_prod(
    runtime: ToolRuntime,
    skill_name: str | None = None,
) -> Command:
    """Promote a saved dev skill into `.openagents/skills/store/prod`.

    Args:
        skill_name: Optional skill name or relative path under the skill store.
    """

    resolved_skill_name = str(
        skill_name
        or runtime_context_value(runtime.context, "target_skill_name")
        or ""
    ).strip()
    try:
        target_dir, backup_dir = push_skill_directory_to_prod(resolved_skill_name, paths=get_paths())
        parts = [f"Skill '{resolved_skill_name}' pushed to {target_dir}."]
        if backup_dir is not None:
            parts.append(f"Previous prod version backed up to {backup_dir}.")
        return Command(update={"messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)]})
    except Exception as exc:
        logger.error("Failed to push skill '%s' to prod: %s", resolved_skill_name, exc, exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {exc}", tool_call_id=runtime.tool_call_id)]})
