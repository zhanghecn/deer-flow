"""Helpers for materializing agent definitions onto the local filesystem."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path, PurePosixPath
from uuid import uuid4

import yaml

from src.config.agents_config import (
    AGENTS_MD_FILENAME,
    SUBAGENTS_FILENAME,
    AgentConfig,
    AgentMemoryConfig,
    AgentSkillRef,
    AgentSubagentConfig,
    AgentSubagentDefaults,
    AgentSubagentsConfig,
    _parse_skill_source_path,
    serialize_agent_subagents_config,
    serialize_agent_skill_ref,
    serialize_subagent_defaults,
)
from src.config.paths import Paths, get_paths
from src.skills import load_skills, skill_source_path
from src.skills.types import Skill

_SKILL_SCOPE_PRIORITY: dict[str, int] = {
    "system": 0,
    "custom": 1,
    "store/dev": 0,
    "store/prod": 1,
}
_AUTHORED_SKILL_SCOPES = ("system", "custom")
_DEV_AGENT_SKILL_SCOPES = _AUTHORED_SKILL_SCOPES + ("store/dev", "store/prod")
_PROD_AGENT_SKILL_SCOPES = _AUTHORED_SKILL_SCOPES + ("store/prod",)


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


def _normalize_copied_skill_refs(
    *,
    skill_names: list[str] | None,
    skill_refs: list[AgentSkillRef | dict[str, str]] | None,
) -> list[AgentSkillRef]:
    normalized: list[AgentSkillRef] = []
    seen: dict[str, AgentSkillRef] = {}

    for name in _dedupe_skill_names(skill_names):
        ref = AgentSkillRef(name=name)
        normalized.append(ref)
        seen[ref.name] = ref

    for raw_ref in skill_refs or []:
        ref = raw_ref if isinstance(raw_ref, AgentSkillRef) else AgentSkillRef.model_validate(raw_ref)
        existing = seen.get(ref.name)
        if existing is None:
            normalized.append(ref)
            seen[ref.name] = ref
            continue
        if existing.model_dump(exclude_none=True) != ref.model_dump(exclude_none=True):
            raise ValueError(f"Agent definition duplicates copied skill '{ref.name}' with conflicting sources.")

    return normalized


def _allowed_skill_scopes_for_agent(
    *,
    target_status: str,
) -> tuple[str, ...]:
    if target_status == "prod":
        return _PROD_AGENT_SKILL_SCOPES
    return _DEV_AGENT_SKILL_SCOPES


def _skills_by_name_for_scopes(
    *,
    paths: Paths,
    allowed_scopes: tuple[str, ...],
) -> dict[str, list[Skill]]:
    catalog: dict[str, list[Skill]] = {}
    for skill in load_skills(skills_path=paths.skills_dir, use_config=False, enabled_only=False):
        if skill.category not in allowed_scopes:
            continue
        catalog.setdefault(skill.name, []).append(skill)

    return catalog


def _skills_by_source_path_for_scopes(
    *,
    paths: Paths,
    allowed_scopes: tuple[str, ...],
) -> dict[str, Skill]:
    catalog: dict[str, Skill] = {}
    for skill in load_skills(skills_path=paths.skills_dir, use_config=False, enabled_only=False):
        if skill.category not in allowed_scopes:
            continue
        catalog[skill_source_path(skill)] = skill

    return catalog


def _sort_skills_for_scope_priority(skills: list[Skill], *, allowed_scopes: tuple[str, ...]) -> list[Skill]:
    scope_order = {scope: index for index, scope in enumerate(allowed_scopes)}
    return sorted(
        skills,
        key=lambda skill: (
            scope_order.get(skill.category, 999),
            _SKILL_SCOPE_PRIORITY.get(skill.category, 999),
            skill.skill_path,
        ),
    )


def _resolve_requested_skill(
    *,
    skill_name: str,
    catalog: dict[str, list[Skill]],
    allowed_scopes: tuple[str, ...],
    target_status: str,
) -> Skill:
    matches = _sort_skills_for_scope_priority(catalog.get(skill_name, []), allowed_scopes=allowed_scopes)
    if not matches:
        scopes = ", ".join(allowed_scopes)
        raise ValueError(f"Skill '{skill_name}' not found in allowed scopes: {scopes}.")

    scoped_matches = {skill.category for skill in matches}
    if target_status == "dev" and {"store/dev", "store/prod"} <= scoped_matches:
        raise ValueError(
            f"Skill '{skill_name}' exists in both store/dev and store/prod. "
            "Attach it with an explicit `source_path`."
        )

    if len(matches) > 1:
        locations = ", ".join(skill_source_path(skill) for skill in matches)
        raise ValueError(f"Skill '{skill_name}' is ambiguous across multiple sources: {locations}.")

    return matches[0]


def _resolve_skill_ref(
    *,
    skill_ref: AgentSkillRef,
    catalog: dict[str, list[Skill]],
    skills_by_source_path: dict[str, Skill],
    allowed_scopes: tuple[str, ...],
    target_status: str,
) -> Skill:
    if skill_ref.source_path is None:
        return _resolve_requested_skill(
            skill_name=skill_ref.name,
            catalog=catalog,
            allowed_scopes=allowed_scopes,
            target_status=target_status,
        )

    skill = skills_by_source_path.get(skill_ref.source_path)
    if skill is None:
        scopes = ", ".join(allowed_scopes)
        raise ValueError(f"Skill '{skill_ref.name}' from {skill_ref.source_path} not found in allowed scopes: {scopes}.")
    if skill.name != skill_ref.name:
        raise ValueError(f"Skill ref name '{skill_ref.name}' does not match installed skill '{skill.name}' at {skill_ref.source_path}.")
    return skill


def validate_skill_refs_for_status(
    skill_refs: list[AgentSkillRef],
    *,
    target_status: str,
    paths: Paths | None = None,
) -> None:
    paths = paths or get_paths()
    allowed_scopes = _allowed_skill_scopes_for_agent(target_status=target_status)
    catalog = _skills_by_name_for_scopes(paths=paths, allowed_scopes=allowed_scopes)
    skills_by_source_path = _skills_by_source_path_for_scopes(paths=paths, allowed_scopes=allowed_scopes)

    for skill_ref in skill_refs:
        if skill_ref.source_path is None:
            continue
        scope, _relative_path = _parse_skill_source_path(skill_ref.source_path)
        if scope not in allowed_scopes:
            scopes = ", ".join(allowed_scopes)
            raise ValueError(f"Skill '{skill_ref.name}' from {scope} is not allowed for {target_status} agent archives. Allowed scopes: {scopes}.")
        _resolve_skill_ref(
            skill_ref=skill_ref,
            catalog=catalog,
            skills_by_source_path=skills_by_source_path,
            allowed_scopes=allowed_scopes,
            target_status=target_status,
        )


def resolve_skill_refs(
    skill_names: list[str] | None,
    *,
    target_status: str = "dev",
    paths: Paths | None = None,
) -> list[Skill]:
    paths = paths or get_paths()
    requested = _dedupe_skill_names(skill_names)
    if not requested:
        return []

    allowed_scopes = _allowed_skill_scopes_for_agent(target_status=target_status)
    catalog = _skills_by_name_for_scopes(paths=paths, allowed_scopes=allowed_scopes)
    resolved: list[Skill] = []
    for name in requested:
        skill = _resolve_requested_skill(
            skill_name=name,
            catalog=catalog,
            allowed_scopes=allowed_scopes,
            target_status=target_status,
        )
        resolved.append(skill)
    return resolved


def _skill_relative_path(skill: Skill) -> Path:
    if str(skill.relative_path) != ".":
        return skill.relative_path
    return Path(skill.skill_dir.name)


def _to_agent_skill_ref(skill: Skill) -> AgentSkillRef:
    return AgentSkillRef(
        name=skill.name,
        source_path=skill_source_path(skill),
    )


def _materialize_resolved_skills(*, skills_dir: Path, resolved_skills: list[Skill]) -> list[AgentSkillRef]:
    skill_refs: list[AgentSkillRef] = []
    for skill in resolved_skills:
        relative_path = _skill_relative_path(skill)
        materialized_dir = skills_dir / relative_path
        materialized_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(skill.skill_dir, materialized_dir, dirs_exist_ok=True)
        skill_refs.append(_to_agent_skill_ref(skill))
    return skill_refs


def materialize_agent_skills(
    *,
    skills_dir: Path,
    skill_names: list[str] | None,
    target_status: str = "dev",
    paths: Paths | None = None,
) -> list[AgentSkillRef]:
    """Copy selected archived skills into an agent-owned skills directory."""

    paths = paths or get_paths()
    if skills_dir.exists():
        shutil.rmtree(skills_dir)
    skills_dir.mkdir(parents=True, exist_ok=True)

    resolved_skills = resolve_skill_refs(
        skill_names,
        target_status=target_status,
        paths=paths,
    )
    return _materialize_resolved_skills(skills_dir=skills_dir, resolved_skills=resolved_skills)


def materialize_agent_skill_refs(
    *,
    skills_dir: Path,
    skill_refs: list[AgentSkillRef],
    target_status: str = "dev",
    paths: Paths | None = None,
) -> list[AgentSkillRef]:
    paths = paths or get_paths()
    if skills_dir.exists():
        shutil.rmtree(skills_dir)
    skills_dir.mkdir(parents=True, exist_ok=True)

    allowed_scopes = _allowed_skill_scopes_for_agent(target_status=target_status)
    catalog = _skills_by_name_for_scopes(paths=paths, allowed_scopes=allowed_scopes)
    skills_by_source_path = _skills_by_source_path_for_scopes(paths=paths, allowed_scopes=allowed_scopes)
    resolved_skills = [
        _resolve_skill_ref(
            skill_ref=skill_ref,
            catalog=catalog,
            skills_by_source_path=skills_by_source_path,
            allowed_scopes=allowed_scopes,
            target_status=target_status,
        )
        for skill_ref in skill_refs
    ]
    return _materialize_resolved_skills(skills_dir=skills_dir, resolved_skills=resolved_skills)


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
    tool_names: list[str] | None,
    mcp_servers: list[str] | None,
    skill_refs: list[AgentSkillRef],
    memory: AgentMemoryConfig | None,
    subagent_defaults: AgentSubagentDefaults | None,
) -> None:
    manifest: dict[str, object] = {
        "name": name,
        "description": description,
        "status": status,
        "agents_md_path": AGENTS_MD_FILENAME,
        "skill_refs": [serialize_agent_skill_ref(skill_ref) for skill_ref in skill_refs],
        "memory": (memory or AgentMemoryConfig()).model_dump(exclude_none=True),
        "subagent_defaults": serialize_subagent_defaults(subagent_defaults or AgentSubagentDefaults()),
    }
    if model is not None:
        manifest["model"] = model
    if tool_groups is not None:
        manifest["tool_groups"] = tool_groups
    if tool_names is not None:
        manifest["tool_names"] = tool_names
    if mcp_servers is not None:
        manifest["mcp_servers"] = mcp_servers

    config_file = agent_dir / "config.yaml"
    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(manifest, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def _write_agent_subagents_file(
    *,
    agent_dir: Path,
    subagents: list[AgentSubagentConfig],
) -> None:
    if not subagents:
        return

    subagents_file = agent_dir / SUBAGENTS_FILENAME
    payload = serialize_agent_subagents_config(AgentSubagentsConfig(subagents=subagents))
    with open(subagents_file, "w", encoding="utf-8") as handle:
        yaml.dump(payload, handle, default_flow_style=False, allow_unicode=True, sort_keys=False)


def materialize_agent_definition(
    *,
    name: str,
    status: str = "dev",
    agents_md: str,
    description: str = "",
    model: str | None = None,
    tool_groups: list[str] | None = None,
    tool_names: list[str] | None = None,
    mcp_servers: list[str] | None = None,
    skill_names: list[str] | None = None,
    skill_refs: list[AgentSkillRef | dict[str, str]] | None = None,
    inline_skills: list[dict[str, str]] | None = None,
    memory: AgentMemoryConfig | dict | None = None,
    subagent_defaults: AgentSubagentDefaults | dict | None = None,
    subagents: list[AgentSubagentConfig | dict[str, object]] | None = None,
    paths: Paths | None = None,
) -> AgentConfig:
    """Write an agent definition to disk and copy referenced skills locally."""

    paths = paths or get_paths()
    agent_dir = paths.custom_agent_dir(name, status)
    agent_parent = agent_dir.parent
    agent_parent.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{agent_dir.name}.tmp-", dir=agent_parent))
    backup_dir: Path | None = None

    try:
        agents_md_path = staging_dir / AGENTS_MD_FILENAME
        agents_md_path.write_text(agents_md, encoding="utf-8")

        skills_dir = staging_dir / "skills"
        skills_dir.mkdir(parents=True, exist_ok=True)

        copied_skill_ref_inputs = _normalize_copied_skill_refs(
            skill_names=skill_names,
            skill_refs=skill_refs,
        )
        copied_skill_refs = materialize_agent_skill_refs(
            skills_dir=skills_dir,
            skill_refs=copied_skill_ref_inputs,
            target_status=status,
            paths=paths,
        )
        inline_skill_refs = materialize_inline_agent_skills(
            skills_dir=skills_dir,
            inline_skills=inline_skills,
        )
        duplicate_names = {ref.name for ref in copied_skill_refs} & {ref.name for ref in inline_skill_refs}
        if duplicate_names:
            joined = ", ".join(sorted(duplicate_names))
            raise ValueError(f"Agent definition duplicates skill names across copied and inline skills: {joined}.")
        skill_refs = copied_skill_refs + inline_skill_refs

        memory_config = memory if isinstance(memory, AgentMemoryConfig) else AgentMemoryConfig.model_validate(memory or {})
        subagent_defaults_config = subagent_defaults if isinstance(subagent_defaults, AgentSubagentDefaults) else AgentSubagentDefaults.model_validate(subagent_defaults or {})
        subagent_configs = [item if isinstance(item, AgentSubagentConfig) else AgentSubagentConfig.model_validate(item) for item in (subagents or [])]

        _write_agent_manifest(
            agent_dir=staging_dir,
            name=name,
            status=status,
            description=description,
            model=model,
            tool_groups=tool_groups,
            tool_names=tool_names,
            mcp_servers=mcp_servers,
            skill_refs=skill_refs,
            memory=memory_config,
            subagent_defaults=subagent_defaults_config,
        )
        _write_agent_subagents_file(agent_dir=staging_dir, subagents=subagent_configs)

        if agent_dir.exists():
            backup_dir = agent_parent / f".{agent_dir.name}.bak-{uuid4().hex}"
            agent_dir.rename(backup_dir)
        try:
            staging_dir.rename(agent_dir)
        except Exception:
            if backup_dir is not None and backup_dir.exists():
                backup_dir.rename(agent_dir)
            raise

        if backup_dir is not None and backup_dir.exists():
            shutil.rmtree(backup_dir)

        return AgentConfig(
            name=name,
            description=description,
            model=model,
            tool_groups=tool_groups,
            tool_names=tool_names,
            mcp_servers=mcp_servers,
            status=status,
            agents_md_path=AGENTS_MD_FILENAME,
            skill_refs=skill_refs,
            memory=memory_config,
            subagent_defaults=subagent_defaults_config,
        )
    finally:
        if staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)


def publish_agent_definition(name: str, *, paths: Paths | None = None) -> AgentConfig:
    """Copy a dev agent definition to prod."""

    paths = paths or get_paths()
    dev_dir = paths.custom_agent_dir(name, "dev")
    prod_dir = paths.custom_agent_dir(name, "prod")

    if not dev_dir.exists():
        raise FileNotFoundError(f"Dev agent directory not found: {dev_dir}")

    dev_config_file = dev_dir / "config.yaml"
    config_data = yaml.safe_load(dev_config_file.read_text(encoding="utf-8")) or {}
    if not isinstance(config_data, dict):
        raise ValueError(f"Agent config must be a mapping: {dev_config_file}")
    config_data["status"] = "prod"
    config_data.pop("runtime_backend", None)
    config_data.setdefault("agents_md_path", AGENTS_MD_FILENAME)
    agent_config = AgentConfig.model_validate(config_data)
    validate_skill_refs_for_status(
        agent_config.skill_refs,
        target_status="prod",
        paths=paths,
    )

    if prod_dir.exists():
        shutil.rmtree(prod_dir)
    prod_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(dev_dir, prod_dir)

    config_file = prod_dir / "config.yaml"
    with open(config_file, "w", encoding="utf-8") as f:
        yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    return agent_config
