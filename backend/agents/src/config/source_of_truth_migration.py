from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from threading import Lock
from typing import Any

import yaml

from src.config.paths import Paths, get_paths

logger = logging.getLogger(__name__)

_MIGRATED_BASE_DIRS: set[Path] = set()
_MIGRATED_BASE_DIRS_LOCK = Lock()


@dataclass(frozen=True)
class SourceOfTruthMigrationResult:
    copied_skills: int = 0
    copied_agents: int = 0
    rewritten_manifests: int = 0
    created_dirs: tuple[Path, ...] = ()
    skipped_conflicts: tuple[str, ...] = ()

    def changed(self) -> bool:
        return any(
            (
                self.copied_skills,
                self.copied_agents,
                self.rewritten_manifests,
                len(self.created_dirs),
            )
        )


def _relative_skill_source_path(source_path: str) -> PurePosixPath | None:
    normalized = str(source_path or "").strip().strip("/")
    if normalized.startswith("system/skills/"):
        return PurePosixPath(normalized[len("system/skills/") :])
    if normalized.startswith("custom/skills/"):
        return None
    if normalized.startswith("store/dev/"):
        return PurePosixPath(normalized[len("store/dev/") :])
    if normalized.startswith("store/prod/"):
        return PurePosixPath(normalized[len("store/prod/") :])
    return None


def _rewrite_skill_ref(raw_ref: Any) -> dict[str, str] | None:
    from src.config.agents_config import AgentSkillRef, serialize_agent_skill_ref

    if not isinstance(raw_ref, dict):
        return None
    parsed = AgentSkillRef.model_validate(raw_ref)
    if parsed.source_path is None:
        return serialize_agent_skill_ref(parsed)

    relative_path = _relative_skill_source_path(parsed.source_path)
    if relative_path is None:
        return serialize_agent_skill_ref(parsed)

    rewritten = AgentSkillRef(
        name=parsed.name,
        source_path=PurePosixPath("system", "skills", relative_path).as_posix(),
    )
    return serialize_agent_skill_ref(rewritten)


def _iter_skill_dirs(scope_root: Path) -> dict[PurePosixPath, Path]:
    discovered: dict[PurePosixPath, Path] = {}
    if not scope_root.exists():
        return discovered

    for skill_file in sorted(scope_root.rglob("SKILL.md")):
        skill_dir = skill_file.parent
        relative_path = PurePosixPath(skill_dir.relative_to(scope_root).as_posix())
        if any(part.startswith(".") for part in relative_path.parts):
            continue
        discovered[relative_path] = skill_dir
    return discovered


def _directory_fingerprint(directory: Path) -> dict[str, bytes]:
    fingerprint: dict[str, bytes] = {}
    for file_path in sorted(path for path in directory.rglob("*") if path.is_file()):
        relative_path = file_path.relative_to(directory).as_posix()
        fingerprint[relative_path] = file_path.read_bytes()
    return fingerprint


def _directories_match(left: Path, right: Path) -> bool:
    return _directory_fingerprint(left) == _directory_fingerprint(right)


def _copy_tree_if_missing_or_same(*, source_dir: Path, target_dir: Path) -> bool:
    if target_dir.exists():
        return False
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_dir, target_dir)
    return True


def _canonical_agent_destination(*, paths: Paths, status: str, agent_name: str) -> Path:
    if agent_name == "lead_agent":
        return paths.system_agent_dir(agent_name, status)
    return paths.custom_agent_dir(agent_name, status)


def _legacy_agent_dirs(paths: Paths) -> list[Path]:
    discovered: list[Path] = []
    for status in ("dev", "prod"):
        status_dir = paths.agents_dir / status
        if not status_dir.exists():
            continue
        for agent_dir in sorted(path for path in status_dir.iterdir() if path.is_dir()):
            if not (agent_dir / "config.yaml").exists():
                continue
            discovered.append(agent_dir)
    return discovered


def _rewrite_agent_manifest(agent_dir: Path) -> bool:
    config_path = agent_dir / "config.yaml"
    if not config_path.exists():
        return False

    loaded = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"Agent config must be a mapping: {config_path}")

    raw_skill_refs = loaded.get("skill_refs")
    if not isinstance(raw_skill_refs, list):
        return False

    rewritten_refs: list[dict[str, str]] = []
    changed = False
    for raw_ref in raw_skill_refs:
        rewritten = _rewrite_skill_ref(raw_ref)
        if rewritten is None:
            rewritten_refs.append(raw_ref)
            continue
        rewritten_refs.append(rewritten)
        changed = changed or rewritten != raw_ref

    if not changed:
        return False

    loaded["skill_refs"] = rewritten_refs
    config_path.write_text(
        yaml.dump(loaded, default_flow_style=False, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    return True


def migrate_source_of_truth_layout(
    *,
    paths: Paths | None = None,
    log: logging.Logger | None = None,
) -> SourceOfTruthMigrationResult:
    paths = paths or get_paths()
    log = log or logger

    created_dirs: list[Path] = []
    for directory in (
        paths.system_dir,
        paths.custom_dir,
        paths.runtime_dir,
        paths.system_agents_dir,
        paths.system_skills_dir,
        paths.custom_agents_dir,
        paths.custom_skills_dir,
    ):
        if directory.exists():
            continue
        directory.mkdir(parents=True, exist_ok=True)
        created_dirs.append(directory)

    copied_skills = 0
    copied_agents = 0
    rewritten_manifests = 0
    skipped_conflicts: list[str] = []

    legacy_skills_by_relative_path: dict[PurePosixPath, list[Path]] = {}
    for scope_root in (paths.store_prod_skills_dir, paths.store_dev_skills_dir):
        for relative_path, skill_dir in _iter_skill_dirs(scope_root).items():
            legacy_skills_by_relative_path.setdefault(relative_path, []).append(skill_dir)

    for relative_path, source_dirs in sorted(legacy_skills_by_relative_path.items()):
        first_dir = source_dirs[0]
        for candidate in source_dirs[1:]:
            if _directories_match(first_dir, candidate):
                continue
            raise ValueError(
                "Legacy skill migration found conflicting definitions for "
                f"'{relative_path.as_posix()}': {first_dir} vs {candidate}. "
                "Resolve the duplicate before continuing."
            )

        target_dir = paths.system_skill_dir(relative_path)
        if _copy_tree_if_missing_or_same(source_dir=first_dir, target_dir=target_dir):
            copied_skills += 1

    for legacy_agent_dir in _legacy_agent_dirs(paths):
        status = legacy_agent_dir.parent.name
        agent_name = legacy_agent_dir.name
        target_dir = _canonical_agent_destination(paths=paths, status=status, agent_name=agent_name)

        if not target_dir.exists():
            target_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(legacy_agent_dir, target_dir)
            copied_agents += 1
        elif not _directories_match(legacy_agent_dir, target_dir):
            skipped_conflicts.append(f"{legacy_agent_dir} -> {target_dir}")

    for agents_root in (paths.system_agents_dir, paths.custom_agents_dir):
        if not agents_root.exists():
            continue
        for config_path in sorted(agents_root.glob("*/*/config.yaml")):
            if _rewrite_agent_manifest(config_path.parent):
                rewritten_manifests += 1

    if created_dirs or copied_skills or copied_agents or rewritten_manifests or skipped_conflicts:
        log.info(
            "Source-of-truth migration finished: copied_skills=%s copied_agents=%s rewritten_manifests=%s skipped_conflicts=%s",
            copied_skills,
            copied_agents,
            rewritten_manifests,
            len(skipped_conflicts),
        )

    return SourceOfTruthMigrationResult(
        copied_skills=copied_skills,
        copied_agents=copied_agents,
        rewritten_manifests=rewritten_manifests,
        created_dirs=tuple(created_dirs),
        skipped_conflicts=tuple(skipped_conflicts),
    )


def ensure_source_of_truth_layout(*, paths: Paths | None = None, log: logging.Logger | None = None) -> SourceOfTruthMigrationResult:
    paths = paths or get_paths()
    resolved_base_dir = paths.base_dir.resolve()

    if resolved_base_dir in _MIGRATED_BASE_DIRS:
        return SourceOfTruthMigrationResult()

    with _MIGRATED_BASE_DIRS_LOCK:
        if resolved_base_dir in _MIGRATED_BASE_DIRS:
            return SourceOfTruthMigrationResult()
        result = migrate_source_of_truth_layout(paths=paths, log=log)
        _MIGRATED_BASE_DIRS.add(resolved_base_dir)
        return result


def reset_source_of_truth_migration_cache() -> None:
    with _MIGRATED_BASE_DIRS_LOCK:
        _MIGRATED_BASE_DIRS.clear()
