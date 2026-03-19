import logging

from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime

from src.config.paths import get_paths
from src.tools.builtins.authoring_persistence import install_registry_skill_to_store

logger = logging.getLogger(__name__)


@tool
def install_skill_from_registry(
    runtime: ToolRuntime,
    source: str,
    skill_name: str | None = None,
) -> str:
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
        return f"Skill '{installed_name}' installed successfully to .openagents/skills/store/dev."
    except Exception as exc:
        logger.error("Failed to install registry skill '%s': %s", source, exc, exc_info=True)
        return f"Error: {exc}"
