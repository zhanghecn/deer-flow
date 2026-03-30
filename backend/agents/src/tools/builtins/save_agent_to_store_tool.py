import logging

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.builtin_agents import LEAD_AGENT_NAME, normalize_effective_agent_name
from src.config.paths import get_paths
from src.tools.builtins.authoring_persistence import (
    resolve_default_agent_source_dir,
    resolve_runtime_source_path,
    save_agent_directory_to_store,
)
from src.utils.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


@tool
def save_agent_to_store(
    runtime: ToolRuntime,
    agent_name: str | None = None,
    source_path: str | None = None,
) -> Command:
    """Persist a drafted or runtime-edited agent into `.openagents/agents/dev`.

    Args:
        agent_name: Optional target agent name. Defaults to the current non-`lead_agent` runtime agent.
        source_path: Optional explicit runtime or absolute source directory path.
    """

    resolved_agent_name = str(agent_name or "").strip().lower()
    if not resolved_agent_name:
        current_agent_name = normalize_effective_agent_name(runtime_context_value(runtime.context, "agent_name"))
        if current_agent_name != LEAD_AGENT_NAME:
            resolved_agent_name = current_agent_name
    try:
        if not resolved_agent_name:
            raise ValueError(
                "save_agent_to_store requires explicit `agent_name` when the current runtime agent is `lead_agent`."
            )
        paths = get_paths()
        resolved_source = (
            resolve_runtime_source_path(runtime=runtime, source_path=source_path, paths=paths)
            if source_path
            else resolve_default_agent_source_dir(runtime=runtime, agent_name=resolved_agent_name, paths=paths)
        )
        target_dir, backup_dir = save_agent_directory_to_store(
            source_dir=resolved_source,
            agent_name=resolved_agent_name,
            paths=paths,
        )
        parts = [f"Agent '{resolved_agent_name}' saved to {target_dir}."]
        if backup_dir is not None:
            parts.append(f"Previous version backed up to {backup_dir}.")
        return Command(
            update={
                "messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)],
            }
        )
    except Exception as exc:
        logger.error("Failed to save agent '%s': %s", resolved_agent_name, exc, exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {exc}", tool_call_id=runtime.tool_call_id)]})
