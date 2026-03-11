import logging

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.paths import get_paths
from src.tools.builtins.authoring_persistence import push_agent_directory_to_prod

logger = logging.getLogger(__name__)


@tool
def push_agent_prod(
    runtime: ToolRuntime,
    agent_name: str | None = None,
) -> Command:
    """Promote a saved dev agent into `.openagents/agents/prod`.

    Args:
        agent_name: Optional target agent name. Defaults to runtime `agent_name`.
    """

    resolved_agent_name = str(agent_name or runtime.context.get("agent_name") or "").strip()
    try:
        target_dir, backup_dir = push_agent_directory_to_prod(resolved_agent_name, paths=get_paths())
        parts = [f"Agent '{resolved_agent_name}' pushed to {target_dir}."]
        if backup_dir is not None:
            parts.append(f"Previous prod version backed up to {backup_dir}.")
        return Command(update={"messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)]})
    except Exception as exc:
        logger.error("Failed to push agent '%s' to prod: %s", resolved_agent_name, exc, exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {exc}", tool_call_id=runtime.tool_call_id)]})
