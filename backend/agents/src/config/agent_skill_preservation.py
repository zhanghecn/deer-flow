"""Helpers for preserving an agent's existing copied or inline skills on update."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from src.config.agents_config import AGENT_NAME_PATTERN, AGENTS_MD_FILENAME, AgentConfig, resolve_authored_agent_dir


def _load_agent_config_from_directory(
    agent_dir: Path,
    *,
    agent_name: str,
    agent_status: str,
) -> AgentConfig | None:
    config_file = agent_dir / "config.yaml"
    if not config_file.is_file():
        return None

    try:
        payload = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return None
    if not isinstance(payload, dict):
        return None

    payload.setdefault("name", agent_name)
    payload.setdefault("status", agent_status)
    payload.setdefault("agents_md_path", AGENTS_MD_FILENAME)

    try:
        return AgentConfig.model_validate(payload)
    except Exception:
        return None


def _skill_file_for_ref(agent_root: Path, *, materialized_path: str) -> Path:
    candidate = agent_root / Path(materialized_path)
    if candidate.is_file():
        return candidate
    return candidate / "SKILL.md"


def load_existing_agent_owned_skill_content(
    *,
    skill_name: str,
    agent_name: str | None,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> str | None:
    normalized_agent_name = str(agent_name or "").strip().lower()
    if not normalized_agent_name or paths is None:
        return None
    if not AGENT_NAME_PATTERN.match(normalized_agent_name):
        return None

    candidate_roots: list[Path] = []
    if thread_id and hasattr(paths, "sandbox_agents_dir"):
        sandbox_root = paths.sandbox_agents_dir(thread_id)
        candidate_roots.append(Path(sandbox_root) / agent_status / normalized_agent_name)
    authored_root = resolve_authored_agent_dir(normalized_agent_name, agent_status, paths=paths)
    if authored_root is not None:
        candidate_roots.append(authored_root)

    seen_roots: set[Path] = set()
    for agent_root in candidate_roots:
        if agent_root in seen_roots:
            continue
        seen_roots.add(agent_root)
        agent_config = _load_agent_config_from_directory(
            agent_root,
            agent_name=normalized_agent_name,
            agent_status=agent_status,
        )
        if agent_config is None:
            continue
        for skill_ref in agent_config.skill_refs:
            if skill_ref.name != skill_name:
                continue
            if skill_ref.source_path is not None or not skill_ref.materialized_path:
                continue
            skill_file = _skill_file_for_ref(agent_root, materialized_path=skill_ref.materialized_path)
            if not skill_file.is_file():
                continue
            return skill_file.read_text(encoding="utf-8")
    return None


def load_existing_agent_skill_inputs(
    *,
    agent_name: str | None,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Return current skill inputs in setup_agent-compatible form.

    Archived copied skills stay as `{name, source_path}` refs so update flows
    rematerialize the latest archived skill content. Agent-owned inline skills
    stay as `{name, content}` so updates do not silently drop locally owned
    runtime behavior.
    """

    normalized_agent_name = str(agent_name or "").strip().lower()
    if not normalized_agent_name or paths is None:
        return [], []
    if not AGENT_NAME_PATTERN.match(normalized_agent_name):
        return [], []

    candidate_roots: list[Path] = []
    authored_root = resolve_authored_agent_dir(normalized_agent_name, agent_status, paths=paths)
    if authored_root is not None:
        candidate_roots.append(authored_root)
    if thread_id and hasattr(paths, "sandbox_agents_dir"):
        sandbox_root = paths.sandbox_agents_dir(thread_id)
        candidate_roots.append(Path(sandbox_root) / agent_status / normalized_agent_name)

    seen_roots: set[Path] = set()
    for agent_root in candidate_roots:
        if agent_root in seen_roots:
            continue
        seen_roots.add(agent_root)
        agent_config = _load_agent_config_from_directory(
            agent_root,
            agent_name=normalized_agent_name,
            agent_status=agent_status,
        )
        if agent_config is None or not agent_config.skill_refs:
            continue

        preserved_skill_refs: list[dict[str, str]] = []
        preserved_inline_skills: list[dict[str, str]] = []
        seen_names: set[str] = set()
        for skill_ref in agent_config.skill_refs:
            if skill_ref.name in seen_names:
                continue
            seen_names.add(skill_ref.name)
            if skill_ref.source_path is not None:
                preserved_skill_refs.append(
                    {
                        "name": skill_ref.name,
                        "source_path": skill_ref.source_path,
                    }
                )
                continue
            if not skill_ref.materialized_path:
                continue
            skill_file = _skill_file_for_ref(agent_root, materialized_path=skill_ref.materialized_path)
            if not skill_file.is_file():
                continue
            preserved_inline_skills.append(
                {
                    "name": skill_ref.name,
                    "content": skill_file.read_text(encoding="utf-8"),
                }
            )
        return preserved_skill_refs, preserved_inline_skills

    return [], []
