import logging
from pathlib import Path

from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime

from src.config.paths import get_paths
from src.skills import find_archived_skills_by_name, skill_source_path
from src.tools.builtins.authoring_persistence import install_registry_skill_to_store
from src.utils.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


def _candidate_skill_name(*, source: str, skill_name: str | None) -> str | None:
    normalized_name = str(skill_name or "").strip()
    if normalized_name:
        return normalized_name
    normalized_source = str(source or "").strip()
    if "@" not in normalized_source:
        return None
    _, inferred_name = normalized_source.rsplit("@", 1)
    inferred_name = inferred_name.strip()
    return inferred_name or None


def _archive_source_path(match: object) -> str:
    if hasattr(match, "category") and hasattr(match, "skill_dir"):
        return skill_source_path(match)

    category = str(getattr(match, "category", "") or "").strip()
    skill_path = str(getattr(match, "skill_path", "") or "").strip()
    skill_dir = getattr(match, "skill_dir", None)
    fallback_name = Path(skill_dir).name if skill_dir is not None else ""
    return Path(category, skill_path or fallback_name).as_posix()


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
        agent_status = str(runtime_context_value(runtime.context, "agent_status") or "dev").strip() or "dev"
        command_name = str(runtime_context_value(runtime.context, "command_name") or "").strip()
        resolved_skill_name = _candidate_skill_name(source=source, skill_name=skill_name)

        # During `/create-agent`, reuse any visible archived store skill
        # instead of silently reinstalling another same-named copy from the registry.
        if command_name == "create-agent" and resolved_skill_name:
            existing_matches = find_archived_skills_by_name(
                resolved_skill_name,
                agent_status,
            )
            if existing_matches:
                preferred_source = _archive_source_path(existing_matches[0])
                return (
                    f"Error: skill '{resolved_skill_name}' already exists at '{preferred_source}'. "
                    "During `/create-agent`, inspect `/mnt/skills/"
                    f"{preferred_source}/SKILL.md` and attach it with "
                    f"`setup_agent(..., skills=[{{source_path: \"{preferred_source}\"}}])` "
                    "instead of reinstalling it from the registry."
                )

        installed_name, _target_dir = install_registry_skill_to_store(
            source=source,
            skill_name=skill_name,
            paths=get_paths(),
        )
        return f"Skill '{installed_name}' installed successfully to .openagents/skills/store/dev."
    except Exception as exc:
        logger.error("Failed to install registry skill '%s': %s", source, exc, exc_info=True)
        return f"Error: {exc}"
