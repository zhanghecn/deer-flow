import logging

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command

from src.config.paths import get_paths
from src.tools.builtins.authoring_persistence import install_registry_skill_to_store

logger = logging.getLogger(__name__)


@tool
def install_skill_from_registry(
    runtime: ToolRuntime,
    source: str,
    skill_name: str | None = None,
) -> Command:
    """Download an external registry skill and persist it into the dev skill store.

    Args:
        source: Registry reference like `owner/repo@skill-name`.
        skill_name: Optional explicit skill name when the source does not include `@skill-name`.
    """

    try:
        installed_name, _target_dir = install_registry_skill_to_store(
            source=source,
            skill_name=skill_name,
            paths=get_paths(),
        )
        return Command(
            update={
                "installed_skill_name": installed_name,
                "messages": [
                    ToolMessage(
                        content=f"Skill '{installed_name}' installed successfully to .openagents/skills/store/dev.",
                        tool_call_id=runtime.tool_call_id,
                    )
                ],
            }
        )
    except Exception as exc:
        logger.error("Failed to install registry skill '%s': %s", source, exc, exc_info=True)
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=f"Error: {exc}",
                        tool_call_id=runtime.tool_call_id,
                    )
                ]
            }
        )
