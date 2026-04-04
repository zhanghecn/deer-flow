"""Build archived agent files that should be copied into a thread runtime."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Protocol

import yaml

from src.config.agents_config import resolve_authored_agent_dir
from src.config.paths import Paths, get_paths


class AgentSeedManifest(Protocol):
    agents_md_path: str
    skill_refs: list[object] | None


@dataclass(frozen=True)
class _LocalSkillRef:
    name: str
    materialized_path: str | None


@dataclass(frozen=True)
class _LocalSeedManifest:
    agents_md_path: str
    skill_refs: list[_LocalSkillRef]


def _normalize_relative_path(raw_path: str, *, field_name: str) -> PurePosixPath:
    normalized = str(raw_path).strip()
    if not normalized:
        raise ValueError(f"Agent field '{field_name}' must be a non-empty relative path.")

    path = PurePosixPath(normalized)
    if path.is_absolute():
        raise ValueError(f"Agent field '{field_name}' must stay inside the archived agent directory.")
    if ".." in path.parts:
        raise ValueError(f"Agent field '{field_name}' cannot escape the archived agent directory.")
    return path


def _dedupe_paths(paths: list[PurePosixPath]) -> tuple[PurePosixPath, ...]:
    ordered: list[PurePosixPath] = []
    seen: set[PurePosixPath] = set()
    for path in paths:
        if path in seen:
            continue
        ordered.append(path)
        seen.add(path)
    return tuple(ordered)


def _load_manifest(agent_name: str, status: str, *, paths: Paths) -> _LocalSeedManifest:
    from src.config.agents_config import AgentSkillRef

    agent_dir = resolve_authored_agent_dir(agent_name, status, paths=paths)
    if agent_dir is None:
        raise FileNotFoundError(f"Agent '{agent_name}' ({status}) not found in local archive.")

    config_path = agent_dir / "config.yaml"
    if not config_path.exists():
        raise FileNotFoundError(f"Agent '{agent_name}' ({status}) not found in local archive.")

    payload = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"Agent config must be a mapping: {config_path}")

    agents_md_path = str(payload.get("agents_md_path") or "AGENTS.md").strip() or "AGENTS.md"
    raw_skill_refs = payload.get("skill_refs") or []
    if not isinstance(raw_skill_refs, list):
        raise ValueError(f"Agent config field 'skill_refs' must be a list: {config_path}")

    skill_refs: list[_LocalSkillRef] = []
    for index, raw_ref in enumerate(raw_skill_refs):
        if not isinstance(raw_ref, dict):
            raise ValueError(f"Agent config field 'skill_refs[{index}]' must be an object: {config_path}")
        parsed_ref = AgentSkillRef.model_validate(raw_ref)
        skill_refs.append(
            _LocalSkillRef(
                name=parsed_ref.name,
                materialized_path=parsed_ref.materialized_path,
            )
        )

    return _LocalSeedManifest(agents_md_path=agents_md_path, skill_refs=skill_refs)


def _manifest_relative_paths(manifest: AgentSeedManifest) -> tuple[PurePosixPath, ...]:
    relative_paths = [
        PurePosixPath("config.yaml"),
        _normalize_relative_path(manifest.agents_md_path, field_name="agents_md_path"),
    ]
    for index, skill_ref in enumerate(manifest.skill_refs or []):
        materialized_path = getattr(skill_ref, "materialized_path", None)
        skill_name = str(getattr(skill_ref, "name", "") or "").strip()
        if not materialized_path:
            raise ValueError(
                f"Agent skill ref '{skill_name or index}' is missing 'materialized_path' at index {index}."
            )
        relative_paths.append(
            _normalize_relative_path(
                str(materialized_path),
                field_name=f"skill_refs[{index}].materialized_path",
            )
        )
    return _dedupe_paths(relative_paths)


def _resolve_archive_file(agent_dir: Path, relative_path: PurePosixPath) -> Path:
    archive_root = agent_dir.resolve()
    absolute_path = (archive_root / Path(relative_path.as_posix())).resolve()
    try:
        absolute_path.relative_to(archive_root)
    except ValueError as exc:
        raise ValueError(f"Archived file '{relative_path.as_posix()}' escapes agent directory '{archive_root}'.") from exc
    return absolute_path


def _read_archive_entry(agent_dir: Path, relative_path: PurePosixPath) -> list[tuple[PurePosixPath, bytes]]:
    absolute_path = _resolve_archive_file(agent_dir, relative_path)
    if absolute_path.is_dir():
        files: list[tuple[PurePosixPath, bytes]] = []
        for nested_file in sorted(absolute_path.rglob("*")):
            if not nested_file.is_file():
                continue
            nested_relative = relative_path / PurePosixPath(nested_file.relative_to(absolute_path).as_posix())
            files.append((nested_relative, nested_file.read_bytes()))
        return files
    return [(relative_path, absolute_path.read_bytes())]


def runtime_seed_targets(
    agent_name: str,
    *,
    status: str = "dev",
    target_root: str,
    paths: Paths | None = None,
    manifest: AgentSeedManifest | None = None,
) -> list[tuple[str, bytes]]:
    paths = paths or get_paths()
    loaded_manifest = manifest or _load_manifest(agent_name, status, paths=paths)
    agent_dir = resolve_authored_agent_dir(agent_name, status, paths=paths)
    if agent_dir is None:
        raise FileNotFoundError(f"Agent archive not found: {agent_name} ({status})")
    normalized_target_root = target_root.rstrip("/")

    targets: list[tuple[str, bytes]] = []
    for relative_path in _manifest_relative_paths(loaded_manifest):
        for nested_relative, content in _read_archive_entry(agent_dir, relative_path):
            targets.append((f"{normalized_target_root}/{nested_relative.as_posix()}", content))
    return targets
