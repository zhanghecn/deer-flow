from __future__ import annotations

from pathlib import Path
from threading import Lock

import yaml

from src.config.paths import Paths, get_paths
from src.skills import load_skills

LEAD_AGENT_NAME = "lead_agent"
RESERVED_AGENT_NAMES = frozenset({LEAD_AGENT_NAME})

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


def _default_lead_agent_skill_names(paths: Paths) -> list[str]:
    return [
        skill.name
        for skill in load_skills(skills_path=paths.skills_dir, use_config=False, enabled_only=False)
        if skill.category == "shared"
    ]


def _selected_skill_names(
    config_data: dict[str, object],
    *,
    paths: Paths,
    had_legacy_skills_mode: bool,
) -> list[str]:
    if "skill_refs" not in config_data:
        return _default_lead_agent_skill_names(paths)

    raw_refs = config_data.get("skill_refs")
    if not isinstance(raw_refs, list):
        raise ValueError("lead_agent config field 'skill_refs' must be a list.")

    names: list[str] = []
    seen: set[str] = set()
    for raw_ref in raw_refs:
        if not isinstance(raw_ref, dict):
            raise ValueError("lead_agent config field 'skill_refs' must contain objects.")
        raw_name = raw_ref.get("name")
        if raw_name is None:
            raise ValueError("lead_agent config field 'skill_refs' entries must include 'name'.")
        name = str(raw_name).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name)
    if had_legacy_skills_mode and not names:
        return _default_lead_agent_skill_names(paths)
    return names


def _copy_builtin_skills(*, paths: Paths, status: str, skill_names: list[str]) -> list[dict[str, str]]:
    from src.config.agent_materialization import materialize_agent_skills
    from src.config.agents_config import serialize_agent_skill_ref

    skill_refs = materialize_agent_skills(
        skills_dir=paths.agent_skills_dir(LEAD_AGENT_NAME, status),
        skill_names=skill_names,
        target_status=status,
        paths=paths,
        allow_shared=True,
    )
    return [serialize_agent_skill_ref(skill_ref) for skill_ref in skill_refs]


def _ensure_lead_agent_archive_for_status(*, status: str, paths: Paths) -> None:
    agent_dir = paths.agent_dir(LEAD_AGENT_NAME, status)
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

    skill_refs = _copy_builtin_skills(
        paths=paths,
        status=status,
        skill_names=_selected_skill_names(
            config_data,
            paths=paths,
            had_legacy_skills_mode=had_legacy_skills_mode,
        ),
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
