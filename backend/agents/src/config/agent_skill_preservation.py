"""Helpers for preserving an agent's existing copied or inline skills on update."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from src.config.agents_config import AGENT_NAME_PATTERN, AGENTS_MD_FILENAME, AgentConfig, resolve_authored_agent_dir


@dataclass(frozen=True)
class _ExistingAgentRoots:
    """Resolved archive/runtime locations for one existing agent update flow."""

    config: AgentConfig
    authored_root: Path | None
    runtime_root: Path | None


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


def _normalize_existing_agent_name(*, agent_name: str | None, paths: Any) -> str | None:
    normalized_agent_name = str(agent_name or "").strip().lower()
    if not normalized_agent_name or paths is None:
        return None
    if not AGENT_NAME_PATTERN.match(normalized_agent_name):
        return None
    return normalized_agent_name


def _resolve_runtime_agent_root(
    *,
    agent_name: str | None,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> Path | None:
    normalized_agent_name = _normalize_existing_agent_name(agent_name=agent_name, paths=paths)
    if normalized_agent_name is None or not thread_id or not hasattr(paths, "sandbox_agents_dir"):
        return None
    return Path(paths.sandbox_agents_dir(thread_id)) / agent_status / normalized_agent_name


def _load_existing_agent_roots(
    *,
    agent_name: str | None,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> _ExistingAgentRoots | None:
    normalized_agent_name = _normalize_existing_agent_name(agent_name=agent_name, paths=paths)
    if normalized_agent_name is None:
        return None

    authored_root = resolve_authored_agent_dir(normalized_agent_name, agent_status, paths=paths)
    authored_config = None
    if authored_root is not None:
        authored_config = _load_agent_config_from_directory(
            authored_root,
            agent_name=normalized_agent_name,
            agent_status=agent_status,
        )

    runtime_root = _resolve_runtime_agent_root(
        agent_name=normalized_agent_name,
        agent_status=agent_status,
        thread_id=thread_id,
        paths=paths,
    )
    runtime_config = None
    if runtime_root is not None:
        runtime_config = _load_agent_config_from_directory(
            runtime_root,
            agent_name=normalized_agent_name,
            agent_status=agent_status,
        )

    resolved_config = authored_config or runtime_config
    if resolved_config is None:
        return None
    return _ExistingAgentRoots(
        config=resolved_config,
        authored_root=authored_root,
        runtime_root=runtime_root,
    )


def _read_skill_content(
    agent_root: Path | None,
    *,
    materialized_path: str | None,
) -> str | None:
    if agent_root is None or not materialized_path:
        return None
    skill_file = _skill_file_for_ref(agent_root, materialized_path=materialized_path)
    if not skill_file.is_file():
        return None
    return skill_file.read_text(encoding="utf-8")


def _resolve_preserved_skill_entry(
    *,
    existing_roots: _ExistingAgentRoots,
    skill_name: str,
    expected_source_path: str | None = None,
) -> tuple[dict[str, str] | None, dict[str, str] | None]:
    for skill_ref in existing_roots.config.skill_refs:
        if skill_ref.name != skill_name:
            continue

        if expected_source_path is not None:
            if skill_ref.source_path is None or skill_ref.source_path != expected_source_path:
                return None, None

        archived_content = _read_skill_content(
            existing_roots.authored_root,
            materialized_path=skill_ref.materialized_path,
        )
        runtime_content = _read_skill_content(
            existing_roots.runtime_root,
            materialized_path=skill_ref.materialized_path,
        )

        if skill_ref.source_path is not None:
            # Once the model edits the thread-local copied skill, preserve that
            # exact runtime content inline so `setup_agent` persists the
            # customized agent-owned copy instead of silently rematerializing
            # from the archived reusable source again.
            if runtime_content is not None and runtime_content != archived_content:
                return None, {"name": skill_ref.name, "content": runtime_content}
            return {"name": skill_ref.name, "source_path": skill_ref.source_path}, None

        preserved_content = runtime_content if runtime_content is not None else archived_content
        if preserved_content is None:
            return None, None
        return None, {"name": skill_ref.name, "content": preserved_content}

    return None, None


def load_existing_agent_skill_input(
    *,
    skill_name: str,
    expected_source_path: str | None = None,
    agent_name: str | None,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> tuple[dict[str, str] | None, dict[str, str] | None]:
    existing_roots = _load_existing_agent_roots(
        agent_name=agent_name,
        agent_status=agent_status,
        thread_id=thread_id,
        paths=paths,
    )
    if existing_roots is None:
        return None, None
    return _resolve_preserved_skill_entry(
        existing_roots=existing_roots,
        skill_name=skill_name,
        expected_source_path=expected_source_path,
    )


def load_existing_agent_owned_skill_content(
    *,
    skill_name: str,
    agent_name: str | None,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> str | None:
    _copied_ref, inline_skill = load_existing_agent_skill_input(
        skill_name=skill_name,
        expected_source_path=None,
        agent_name=agent_name,
        agent_status=agent_status,
        thread_id=thread_id,
        paths=paths,
    )
    if inline_skill is None:
        return None
    return inline_skill["content"]


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

    existing_roots = _load_existing_agent_roots(
        agent_name=agent_name,
        agent_status=agent_status,
        thread_id=thread_id,
        paths=paths,
    )
    if existing_roots is None or not existing_roots.config.skill_refs:
        return [], []

    preserved_skill_refs: list[dict[str, str]] = []
    preserved_inline_skills: list[dict[str, str]] = []
    seen_names: set[str] = set()
    for skill_ref in existing_roots.config.skill_refs:
        if skill_ref.name in seen_names:
            continue
        seen_names.add(skill_ref.name)
        copied_ref, inline_skill = _resolve_preserved_skill_entry(
            existing_roots=existing_roots,
            skill_name=skill_ref.name,
            expected_source_path=skill_ref.source_path,
        )
        if copied_ref is not None:
            preserved_skill_refs.append(copied_ref)
            continue
        if inline_skill is not None:
            preserved_inline_skills.append(inline_skill)

    return preserved_skill_refs, preserved_inline_skills
