import logging

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.paths import get_paths
from src.tools.builtins.authoring_persistence import (
    resolve_default_skill_source_dir,
    resolve_runtime_source_path,
    save_skill_directory_to_store,
)
from src.tools.builtins.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


@tool
def save_skill_to_store(
    runtime: ToolRuntime,
    skill_name: str | None = None,
    source_path: str | None = None,
) -> Command:
    """Persist a drafted skill into `.openagents/skills/store/dev`.

    Args:
        skill_name: Optional skill name or relative path under the skill store.
        source_path: Optional explicit runtime or absolute source directory path.
    """

    resolved_skill_name = str(
        skill_name
        or runtime_context_value(runtime.context, "target_skill_name")
        or ""
    ).strip()
    try:
        paths = get_paths()
        resolved_source = (
            resolve_runtime_source_path(runtime=runtime, source_path=source_path, paths=paths)
            if source_path
            else resolve_default_skill_source_dir(runtime=runtime, skill_name=resolved_skill_name, paths=paths)
        )
        target_dir, backup_dir = save_skill_directory_to_store(
            source_dir=resolved_source,
            skill_name=resolved_skill_name,
            paths=paths,
        )
        parts = [f"Skill '{resolved_skill_name}' saved to {target_dir}."]
        if backup_dir is not None:
            parts.append(f"Previous version backed up to {backup_dir}.")
        return Command(
            update={
                "messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)],
            }
        )
    except Exception as exc:
        logger.error("Failed to save skill '%s': %s", resolved_skill_name, exc, exc_info=True)
        return Command(update={"messages": [ToolMessage(content=f"Error: {exc}", tool_call_id=runtime.tool_call_id)]})
