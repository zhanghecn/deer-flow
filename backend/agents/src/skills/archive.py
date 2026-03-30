from __future__ import annotations

from pathlib import Path, PurePosixPath

from src.skills.loader import load_skills
from src.skills.types import Skill


def skill_source_path(skill: Skill) -> str:
    """Return the canonical archived source_path for a skill."""

    return Path(skill.category, skill.skill_path or skill.skill_dir.name).as_posix()


def archived_skill_categories(agent_status: str) -> tuple[str, ...]:
    if agent_status == "prod":
        return ("store/prod",)
    return ("store/dev", "store/prod")


def find_archived_skills_by_name(
    name: str,
    agent_status: str,
) -> list[Skill]:
    # Keep archive visibility rules in one place so authoring-time source_path
    # validation and duplicate-install checks stay consistent.
    allowed_categories = set(archived_skill_categories(agent_status))
    matches = [
        skill
        for skill in load_skills(enabled_only=False)
        if skill.name == name and skill.category in allowed_categories
    ]
    matches.sort(key=skill_source_path)
    return matches


def find_archived_skill_by_source_path(source_path: str) -> Skill | None:
    normalized_source_path = PurePosixPath(source_path).as_posix().strip("/")
    for skill in load_skills(enabled_only=False):
        if skill_source_path(skill) == normalized_source_path:
            return skill
    return None
