import os
from pathlib import Path

from .parser import parse_skill_file
from .types import Skill

_SKILL_SCOPE_PATHS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("system", ("system", "skills")),
    ("custom", ("custom", "skills")),
    ("store/dev", ("store", "dev")),
    ("store/prod", ("store", "prod")),
)


def get_skills_root_path() -> Path:
    from src.config import get_app_config

    config = get_app_config()
    return config.skills.get_skills_path(config.config_dir)


def _candidate_skill_roots(skills_path: Path) -> tuple[Path, ...]:
    """Resolve authored roots during the `skills.path` migration.

    The canonical layout now lives under `.openagents/system` and
    `.openagents/custom`, but some call sites still pass the historical
    `.openagents/skills` root. Keep the root resolution in one place so the
    rest of the loader only reasons about concrete directories.
    """

    candidates: list[Path] = [skills_path]
    if skills_path.name == "skills":
        candidates.append(skills_path.parent)
    else:
        candidates.append(skills_path / "skills")

    ordered: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        ordered.append(candidate)
        seen.add(resolved)
    return tuple(ordered)


def _resolve_scope_root(skills_path: Path, path_parts: tuple[str, ...]) -> Path | None:
    for candidate_root in _candidate_skill_roots(skills_path):
        scope_root = candidate_root.joinpath(*path_parts)
        if scope_root.exists() and scope_root.is_dir():
            return scope_root
    return None


def load_skills(skills_path: Path | None = None, use_config: bool = True, enabled_only: bool = False) -> list[Skill]:
    """
    Load all skills from the skills directory.

    Scans OpenAgents skill scopes, parsing SKILL.md files
    to extract metadata. The enabled state is determined by the skills_state_config.json file.

    Args:
        skills_path: Optional custom path to skills directory.
                     If not provided and use_config is True, uses path from config.
                     Otherwise defaults to openagents/skills
        use_config: Whether to load skills path from config (default: True)
        enabled_only: If True, only return enabled skills (default: False)

    Returns:
        List of Skill objects, sorted by name
    """
    if skills_path is None:
        if use_config:
            skills_path = get_skills_root_path()
        else:
            raise RuntimeError("skills_path must be provided when use_config is False.")

    if not any(candidate.exists() for candidate in _candidate_skill_roots(skills_path)):
        return []

    skills = []

    # Scan supported skill scopes in deterministic order. Canonical authored
    # roots come first; legacy store scopes remain readable during migration.
    for category, path_parts in _SKILL_SCOPE_PATHS:
        category_path = _resolve_scope_root(skills_path, path_parts)
        if category_path is None:
            continue

        for current_root, dir_names, file_names in os.walk(category_path):
            # Keep traversal deterministic and skip hidden directories.
            dir_names[:] = sorted(name for name in dir_names if not name.startswith("."))
            if "SKILL.md" not in file_names:
                continue

            skill_file = Path(current_root) / "SKILL.md"
            relative_path = skill_file.parent.relative_to(category_path)

            skill = parse_skill_file(skill_file, category=category, relative_path=relative_path)
            if skill:
                skills.append(skill)

    # Load skills state configuration and update enabled status
    # NOTE: We use ExtensionsConfig.from_file() instead of get_extensions_config()
    # to always read the latest configuration from disk. This ensures that changes
    # made through the Gateway API (which runs in a separate process) are immediately
    # reflected in the LangGraph Server when loading skills.
    try:
        from src.config.extensions_config import ExtensionsConfig

        extensions_config = ExtensionsConfig.from_file()
        for skill in skills:
            skill.enabled = extensions_config.is_skill_enabled(skill.name, skill.category)
    except Exception as e:
        # If config loading fails, default to all enabled
        print(f"Warning: Failed to load extensions config: {e}")

    # Filter by enabled status if requested
    if enabled_only:
        skills = [skill for skill in skills if skill.enabled]

    # Sort by name for consistent ordering
    skills.sort(key=lambda s: s.name)

    return skills
