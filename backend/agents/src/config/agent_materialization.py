"""Helpers for materializing agent definitions onto the local filesystem."""

from __future__ import annotations

import shutil
from pathlib import Path, PurePosixPath

import yaml

from src.config.agents_config import (
    AGENTS_MD_FILENAME,
    AgentConfig,
    AgentMemoryConfig,
    AgentSkillRef,
    serialize_agent_skill_ref,
)
from src.config.paths import Paths, get_paths
from src.skills import load_skills
from src.skills.types import Skill

_SKILL_SCOPE_PRIORITY: dict[str, int] = {
    "shared": 0,
    "store/prod": 1,
    "store/dev": 2,
}


def _dedupe_skill_names(skill_names: list[str] | None) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for raw_name in skill_names or []:
        name = str(raw_name).strip()
        if not name or name in seen:
            continue
        ordered.append(name)
        seen.add(name)
    return ordered


def _get_skill_catalog(paths: Paths) -> dict[str, Skill]:
    catalog: dict[str, Skill] = {}
    for skill in load_skills(skills_path=paths.skills_dir, use_config=False, enabled_only=False):
        existing = catalog.get(skill.name)
        if existing is None:
            catalog[skill.name] = skill
            continue

        existing_priority = _SKILL_SCOPE_PRIORITY.get(existing.category, 999)
        next_priority = _SKILL_SCOPE_PRIORITY.get(skill.category, 999)
        if next_priority < existing_priority:
            catalog[skill.name] = skill

    return catalog


def resolve_skill_refs(skill_names: list[str] | None, paths: Paths | None = None) -> list[Skill]:
    paths = paths or get_paths()
    requested = _dedupe_skill_names(skill_names)
    if not requested:
        return []

    catalog = _get_skill_catalog(paths)
    resolved: list[Skill] = []
    for name in requested:
        skill = catalog.get(name)
        if skill is None:
            raise ValueError(f"Skill '{name}' not found in OpenAgents skills library.")
        resolved.append(skill)
    return resolved


def _skill_relative_path(skill: Skill) -> Path:
    if str(skill.relative_path) != ".":
        return skill.relative_path
    return Path(skill.skill_dir.name)


def _to_agent_skill_ref(skill: Skill) -> AgentSkillRef:
    return AgentSkillRef(
        name=skill.name,
        source_path=Path(skill.category, skill.skill_path or skill.skill_dir.name).as_posix(),
    )


def materialize_agent_skills(
    *,
    skills_dir: Path,
    skill_names: list[str] | None,
    paths: Paths | None = None,
) -> list[AgentSkillRef]:
    """Copy selected shared skills into an agent-owned skills directory."""

    paths = paths or get_paths()
    if skills_dir.exists():
        shutil.rmtree(skills_dir)
    skills_dir.mkdir(parents=True, exist_ok=True)

    resolved_skills = resolve_skill_refs(skill_names, paths)
    skill_refs: list[AgentSkillRef] = []
    for skill in resolved_skills:
        relative_path = _skill_relative_path(skill)
        materialized_dir = skills_dir / relative_path
        materialized_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(skill.skill_dir, materialized_dir, dirs_exist_ok=True)
        skill_refs.append(_to_agent_skill_ref(skill))

    return skill_refs


def materialize_inline_agent_skills(
    *,
    skills_dir: Path,
    inline_skills: list[dict[str, str]] | None,
) -> list[AgentSkillRef]:
    """Write inline agent-owned skills directly into the agent skills directory."""

    skill_refs: list[AgentSkillRef] = []
    seen_names: set[str] = set()

    for raw_skill in inline_skills or []:
        name = str((raw_skill or {}).get("name") or "").strip()
        content = str((raw_skill or {}).get("content") or "")
        if not name:
            raise ValueError("Inline agent skill requires a non-empty `name`.")
        if not content.strip():
            raise ValueError(f"Inline agent skill '{name}' requires non-empty `content`.")
        if name in seen_names:
            raise ValueError(f"Duplicate inline agent skill '{name}'.")

        relative_path = PurePosixPath(name)
        if relative_path.is_absolute() or ".." in relative_path.parts or not relative_path.parts:
            raise ValueError(f"Inline agent skill '{name}' must use a safe relative name.")

        skill_dir = skills_dir / relative_path
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")

        skill_refs.append(
            AgentSkillRef(
                name=name,
                materialized_path=PurePosixPath("skills", relative_path).as_posix(),
            )
        )
        seen_names.add(name)

    return skill_refs


def _write_agent_manifest(
    *,
    agent_dir: Path,
    name: str,
    status: str,
    description: str,
    model: str | None,
    tool_groups: list[str] | None,
    mcp_servers: list[str] | None,
    skill_refs: list[AgentSkillRef],
    memory: AgentMemoryConfig | None,
) -> None:
    manifest: dict[str, object] = {
        "name": name,
        "description": description,
        "status": status,
        "agents_md_path": AGENTS_MD_FILENAME,
        "skill_refs": [serialize_agent_skill_ref(skill_ref) for skill_ref in skill_refs],
        "memory": (memory or AgentMemoryConfig()).model_dump(exclude_none=True),
    }
    if model is not None:
        manifest["model"] = model
    if tool_groups is not None:
        manifest["tool_groups"] = tool_groups
    if mcp_servers is not None:
        manifest["mcp_servers"] = mcp_servers

    config_file = agent_dir / "config.yaml"
    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(manifest, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def materialize_agent_definition(
    *,
    name: str,
    status: str = "dev",
    agents_md: str,
    description: str = "",
    model: str | None = None,
    tool_groups: list[str] | None = None,
    mcp_servers: list[str] | None = None,
    skill_names: list[str] | None = None,
    inline_skills: list[dict[str, str]] | None = None,
    memory: AgentMemoryConfig | dict | None = None,
    paths: Paths | None = None,
) -> AgentConfig:
    """Write an agent definition to disk and copy referenced skills locally."""

    paths = paths or get_paths()
    agent_dir = paths.agent_dir(name, status)
    agent_dir.mkdir(parents=True, exist_ok=True)

    agents_md_path = agent_dir / AGENTS_MD_FILENAME
    agents_md_path.write_text(agents_md, encoding="utf-8")

    skills_dir = paths.agent_skills_dir(name, status)
    if skills_dir.exists():
        shutil.rmtree(skills_dir)
    skills_dir.mkdir(parents=True, exist_ok=True)

    copied_skill_refs = materialize_agent_skills(
        skills_dir=skills_dir,
        skill_names=skill_names,
        paths=paths,
    )
    inline_skill_refs = materialize_inline_agent_skills(
        skills_dir=skills_dir,
        inline_skills=inline_skills,
    )
    duplicate_names = {ref.name for ref in copied_skill_refs} & {
        ref.name for ref in inline_skill_refs
    }
    if duplicate_names:
        joined = ", ".join(sorted(duplicate_names))
        raise ValueError(
            f"Agent definition duplicates skill names across copied and inline skills: {joined}."
        )
    skill_refs = copied_skill_refs + inline_skill_refs

    memory_config = memory if isinstance(memory, AgentMemoryConfig) else AgentMemoryConfig.model_validate(memory or {})

    _write_agent_manifest(
        agent_dir=agent_dir,
        name=name,
        status=status,
        description=description,
        model=model,
        tool_groups=tool_groups,
        mcp_servers=mcp_servers,
        skill_refs=skill_refs,
        memory=memory_config,
    )

    agent_config = AgentConfig(
        name=name,
        description=description,
        model=model,
        tool_groups=tool_groups,
        mcp_servers=mcp_servers,
        status=status,
        agents_md_path=AGENTS_MD_FILENAME,
        skill_refs=skill_refs,
        memory=memory_config,
    )
    return agent_config


def publish_agent_definition(name: str, *, paths: Paths | None = None) -> AgentConfig:
    """Copy a dev agent definition to prod."""

    paths = paths or get_paths()
    dev_dir = paths.agent_dir(name, "dev")
    prod_dir = paths.agent_dir(name, "prod")

    if not dev_dir.exists():
        raise FileNotFoundError(f"Dev agent directory not found: {dev_dir}")

    if prod_dir.exists():
        shutil.rmtree(prod_dir)
    prod_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(dev_dir, prod_dir)

    config_file = prod_dir / "config.yaml"
    with open(config_file, encoding="utf-8") as f:
        config_data: dict = yaml.safe_load(f) or {}
    config_data["status"] = "prod"
    config_data.pop("runtime_backend", None)
    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    agent_config = AgentConfig.model_validate(config_data)
    return agent_config
