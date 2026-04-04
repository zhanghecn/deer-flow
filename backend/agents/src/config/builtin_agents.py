from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING

import yaml

from src.config.paths import Paths, get_paths
from src.skills import load_skills, skill_source_path

if TYPE_CHECKING:
    from src.config.agents_config import AgentSkillRef

LEAD_AGENT_NAME = "lead_agent"
RESERVED_AGENT_NAMES = frozenset({LEAD_AGENT_NAME})
_DEFAULT_LEAD_AGENT_PROD_SKILL_NAMES = ("bootstrap",)
logger = logging.getLogger(__name__)

_BUILTIN_LEAD_AGENT_AGENTS_MD = Path(__file__).resolve().parents[1] / "agents" / "lead_agent" / "AGENTS.md"
_ENSURED_ARCHIVES: set[tuple[str, str]] = set()
_ENSURED_ARCHIVES_LOCK = Lock()


def normalize_effective_agent_name(agent_name: str | None) -> str:
    normalized = str(agent_name or "").strip().lower()
    return normalized or LEAD_AGENT_NAME


def is_reserved_agent_name(agent_name: str | None) -> bool:
    return normalize_effective_agent_name(agent_name) in RESERVED_AGENT_NAMES


def _load_config_data(config_path: Path) -> dict[str, object]:
    if not config_path.exists():
        return {}
    loaded = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"Built-in agent config must be a mapping: {config_path}")
    return dict(loaded)


def _default_lead_agent_skill_refs(paths: Paths) -> list["AgentSkillRef"]:
    from src.config.agents_config import AgentSkillRef

    prod_skills_by_name: dict[str, object] = {}
    for skill in load_skills(skills_path=paths.skills_dir, use_config=False, enabled_only=False):
        if skill.name not in _DEFAULT_LEAD_AGENT_PROD_SKILL_NAMES:
            continue
        if skill.category != "system":
            continue
        prod_skills_by_name.setdefault(skill.name, skill)

    return [
        AgentSkillRef(
            name=skill.name,
            source_path=skill_source_path(skill),
        )
        for skill_name in _DEFAULT_LEAD_AGENT_PROD_SKILL_NAMES
        for skill in [prod_skills_by_name.get(skill_name)]
        if skill is not None
    ]


def _selected_skill_refs(
    config_data: dict[str, object],
    *,
    paths: Paths,
    had_legacy_skills_mode: bool,
) -> list[AgentSkillRef]:
    from src.config.agents_config import AgentSkillRef

    if "skill_refs" not in config_data:
        return _default_lead_agent_skill_refs(paths)

    raw_refs = config_data.get("skill_refs")
    if not isinstance(raw_refs, list):
        raise ValueError("lead_agent config field 'skill_refs' must be a list.")

    selected_refs: list[AgentSkillRef] = []
    seen: set[str] = set()
    for raw_ref in raw_refs:
        if not isinstance(raw_ref, dict):
            raise ValueError("lead_agent config field 'skill_refs' must contain objects.")
        skill_ref = AgentSkillRef.model_validate(raw_ref)
        if skill_ref.name in seen:
            continue
        seen.add(skill_ref.name)
        selected_refs.append(skill_ref)
    if had_legacy_skills_mode and not selected_refs:
        return _default_lead_agent_skill_refs(paths)
    return selected_refs


def _sanitize_builtin_skill_refs(
    skill_refs: list["AgentSkillRef"],
    *,
    status: str,
    paths: Paths,
) -> tuple[list["AgentSkillRef"], bool]:
    # Built-in lead-agent archives are repository-managed data. If an older
    # archived config still points at skill scopes that are no longer valid for
    # the current archive status, rewrite that stale manifest instead of
    # bricking runtime startup on every boot.
    from src.skills.archive import archived_skill_categories

    allowed_categories = set(archived_skill_categories(status))
    archived_skills_by_source_path = {
        skill_source_path(skill): skill
        for skill in load_skills(skills_path=paths.skills_dir, use_config=False, enabled_only=False)
        if skill.category in allowed_categories
    }
    sanitized_refs: list[AgentSkillRef] = []
    dropped_refs: list[str] = []

    for skill_ref in skill_refs:
        if skill_ref.source_path is None:
            sanitized_refs.append(skill_ref)
            continue

        archived_skill = archived_skills_by_source_path.get(skill_ref.source_path)
        if archived_skill is None or archived_skill.category not in allowed_categories:
            dropped_refs.append(skill_ref.source_path)
            continue
        if archived_skill.name != skill_ref.name:
            dropped_refs.append(skill_ref.source_path)
            continue
        sanitized_refs.append(skill_ref)

    if not dropped_refs:
        return sanitized_refs, False

    logger.warning(
        "Dropping stale built-in lead_agent skill refs for status=%s: %s",
        status,
        ", ".join(dropped_refs),
    )
    return sanitized_refs, True


def _canonicalize_builtin_skill_refs(
    skill_refs: list["AgentSkillRef"],
    *,
    paths: Paths,
) -> tuple[list["AgentSkillRef"], bool]:
    from src.config.agents_config import AgentSkillRef

    archived_skills_by_source_path = {
        skill_source_path(skill): skill
        for skill in load_skills(skills_path=paths.skills_dir, use_config=False, enabled_only=False)
        if skill.category == "system"
    }

    rewritten_refs: list[AgentSkillRef] = []
    changed = False
    for skill_ref in skill_refs:
        source_path = str(skill_ref.source_path or "").strip()
        if not source_path.startswith(("store/dev/", "store/prod/")):
            rewritten_refs.append(skill_ref)
            continue

        relative_path = source_path.split("/", 2)[-1]
        canonical_source_path = f"system/skills/{relative_path}"
        canonical_skill = archived_skills_by_source_path.get(canonical_source_path)
        if canonical_skill is None or canonical_skill.name != skill_ref.name:
            rewritten_refs.append(skill_ref)
            continue

        rewritten_refs.append(
            AgentSkillRef(
                name=skill_ref.name,
                source_path=canonical_source_path,
            )
        )
        changed = True

    return rewritten_refs, changed


def _copy_builtin_skills(*, paths: Paths, status: str, skill_refs: list["AgentSkillRef"]) -> list[dict[str, str]]:
    from src.config.agent_materialization import materialize_agent_skill_refs
    from src.config.agents_config import serialize_agent_skill_ref

    materialized_refs = materialize_agent_skill_refs(
        skills_dir=paths.system_agent_skills_dir(LEAD_AGENT_NAME, status),
        skill_refs=skill_refs,
        target_status=status,
        paths=paths,
    )
    return [serialize_agent_skill_ref(skill_ref) for skill_ref in materialized_refs]


def _ensure_lead_agent_archive_for_status(*, status: str, paths: Paths) -> None:
    agent_dir = paths.system_agent_dir(LEAD_AGENT_NAME, status)
    agent_dir.mkdir(parents=True, exist_ok=True)

    agents_md_path = agent_dir / "AGENTS.md"
    builtin_agents_md = _BUILTIN_LEAD_AGENT_AGENTS_MD.read_text(encoding="utf-8")
    # Seed the built-in prompt once, then treat the archived copy as the
    # editable source of truth. This keeps the generic system prompt in code
    # while letting lead_agent-specific instructions live under `.openagents`.
    if not agents_md_path.exists():
        agents_md_path.write_text(builtin_agents_md, encoding="utf-8")

    config_path = agent_dir / "config.yaml"
    config_data = _load_config_data(config_path)
    had_legacy_skills_mode = config_data.pop("skills_mode", None) is not None

    changed = had_legacy_skills_mode
    required_values: dict[str, object] = {
        "name": LEAD_AGENT_NAME,
        "status": status,
        "agents_md_path": "AGENTS.md",
    }
    for key, value in required_values.items():
        if config_data.get(key) != value:
            config_data[key] = value
            changed = True

    if "description" not in config_data:
        config_data["description"] = "Default system lead agent."
        changed = True

    selected_skill_refs = _selected_skill_refs(
        config_data,
        paths=paths,
        had_legacy_skills_mode=had_legacy_skills_mode,
    )
    selected_skill_refs, canonicalized = _canonicalize_builtin_skill_refs(
        selected_skill_refs,
        paths=paths,
    )
    selected_skill_refs, sanitized = _sanitize_builtin_skill_refs(
        selected_skill_refs,
        status=status,
        paths=paths,
    )
    changed = changed or canonicalized or sanitized

    skill_refs = _copy_builtin_skills(
        paths=paths,
        status=status,
        skill_refs=selected_skill_refs,
    )
    if config_data.get("skill_refs") != skill_refs:
        config_data["skill_refs"] = skill_refs
        changed = True

    if changed or not config_path.exists():
        config_path.write_text(
            yaml.dump(config_data, default_flow_style=False, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )


def ensure_builtin_agent_archive(
    agent_name: str | None,
    *,
    status: str = "dev",
    paths: Paths | None = None,
) -> None:
    effective_name = normalize_effective_agent_name(agent_name)
    if effective_name != LEAD_AGENT_NAME:
        return

    paths = paths or get_paths()
    cache_key = (effective_name, status)

    if cache_key in _ENSURED_ARCHIVES:
        return

    with _ENSURED_ARCHIVES_LOCK:
        if cache_key in _ENSURED_ARCHIVES:
            return
        _ensure_lead_agent_archive_for_status(status=status, paths=paths)
        _ENSURED_ARCHIVES.add(cache_key)
