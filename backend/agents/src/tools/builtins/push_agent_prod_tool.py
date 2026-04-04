import logging

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.builtin_agents import LEAD_AGENT_NAME, normalize_effective_agent_name
from src.config.paths import get_paths
from src.tools.builtins.authoring_persistence import push_agent_directory_to_prod
from src.utils.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


@tool("push_agent_prod", parse_docstring=True)
def push_agent_prod(
    runtime: ToolRuntime,
    agent_name: str | None = None,
) -> Command:
    """Promote a saved dev agent into `.openagents/custom/agents/prod`.

    Args:
        agent_name: Optional target agent name. Defaults to the current non-`lead_agent` runtime agent.
    """

    resolved_agent_name = str(agent_name or "").strip().lower()
    if not resolved_agent_name:
        current_agent_name = normalize_effective_agent_name(runtime_context_value(runtime.context, "agent_name"))
        if current_agent_name != LEAD_AGENT_NAME:
            resolved_agent_name = current_agent_name
    try:
        if not resolved_agent_name:
            raise ValueError(
                "push_agent_prod requires explicit `agent_name` when the current runtime agent is `lead_agent`."
            )
        target_dir, backup_dir = push_agent_directory_to_prod(resolved_agent_name, paths=get_paths())
        parts = [f"Agent '{resolved_agent_name}' pushed to {target_dir}."]
        if backup_dir is not None:
            parts.append(f"Previous prod version backed up to {backup_dir}.")
        return Command(update={"messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)]})
    except Exception as exc:
        logger.error("Failed to push agent '%s' to prod: %s", resolved_agent_name, exc, exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {exc}", tool_call_id=runtime.tool_call_id)]})
