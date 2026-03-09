from __future__ import annotations

from pathlib import Path

import yaml

from src.config.paths import Paths, get_paths

LEAD_AGENT_NAME = "lead_agent"
RESERVED_AGENT_NAMES = frozenset({LEAD_AGENT_NAME})
DEFAULT_LEAD_AGENT_SKILLS = ("bootstrap",)

_BUILTIN_LEAD_AGENT_AGENTS_MD = Path(__file__).resolve().parents[1] / "agents" / "lead_agent" / "AGENTS.md"


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


def _selected_skill_names(config_data: dict[str, object]) -> list[str]:
    if "skill_refs" not in config_data:
        return list(DEFAULT_LEAD_AGENT_SKILLS)

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
    return names


def _copy_builtin_skills(*, paths: Paths, status: str, skill_names: list[str]) -> list[dict[str, str]]:
    from src.config.agent_materialization import materialize_agent_skills

    skill_refs = materialize_agent_skills(
        skills_dir=paths.agent_skills_dir(LEAD_AGENT_NAME, status),
        skill_names=skill_names,
        paths=paths,
    )
    return [skill_ref.model_dump(exclude_none=True) for skill_ref in skill_refs]


def _ensure_lead_agent_archive_for_status(*, status: str, paths: Paths) -> None:
    agent_dir = paths.agent_dir(LEAD_AGENT_NAME, status)
    agent_dir.mkdir(parents=True, exist_ok=True)

    agents_md_path = agent_dir / "AGENTS.md"
    if not agents_md_path.exists():
        agents_md_path.write_text(_BUILTIN_LEAD_AGENT_AGENTS_MD.read_text(encoding="utf-8"), encoding="utf-8")

    config_path = agent_dir / "config.yaml"
    config_data = _load_config_data(config_path)
    config_data.pop("skills_mode", None)

    changed = False
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
        skill_names=_selected_skill_names(config_data),
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
    _ensure_lead_agent_archive_for_status(status=status, paths=paths)
