from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

import yaml
from langgraph.prebuilt import ToolRuntime

from src.agents.thread_state import ThreadState
from src.config.agents_config import AGENT_NAME_PATTERN, AGENTS_MD_FILENAME, AgentConfig
from src.config.paths import Paths, VIRTUAL_PATH_PREFIX, get_paths
from src.skills.parser import parse_skill_file


def _timestamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%d%H%M%S")


def _normalize_skill_path(skill_name: str) -> PurePosixPath:
    normalized = str(skill_name).strip()
    if not normalized:
        raise ValueError("skill_name is required.")

    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("skill_name must be a safe relative path.")
    return path


def _normalize_agent_name(agent_name: str) -> str:
    normalized = str(agent_name).strip().lower()
    if not normalized:
        raise ValueError("agent_name is required.")
    if not AGENT_NAME_PATTERN.match(normalized):
        raise ValueError(f"Invalid agent_name '{agent_name}'.")
    return normalized


def _require_directory(path: Path, *, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{label} directory not found: {path}")
    if not path.is_dir():
        raise ValueError(f"{label} path is not a directory: {path}")


def _prepare_target_directory(target_dir: Path) -> Path | None:
    if not target_dir.exists():
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        return None

    backup_dir = target_dir.parent / ".backups" / f"{target_dir.name}-{_timestamp()}"
    backup_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(target_dir, backup_dir)
    shutil.rmtree(target_dir)
    return backup_dir


def _copy_directory(source_dir: Path, target_dir: Path) -> tuple[Path, Path | None]:
    backup_dir = _prepare_target_directory(target_dir)
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_dir, target_dir)
    return target_dir, backup_dir


def _load_agent_payload(source_dir: Path, *, target_status: str) -> AgentConfig:
    config_file = source_dir / "config.yaml"
    if not config_file.exists():
        raise ValueError(f"Agent config.yaml is required: {config_file}")

    payload = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"Agent config must be a mapping: {config_file}")

    payload.setdefault("name", source_dir.name)
    payload["status"] = target_status
    payload.setdefault("agents_md_path", AGENTS_MD_FILENAME)
    return AgentConfig.model_validate(payload)


def validate_skill_directory(skill_dir: Path) -> None:
    _require_directory(skill_dir, label="skill source")
    skill_file = skill_dir / "SKILL.md"
    parsed = parse_skill_file(skill_file, category="shared", relative_path=Path(skill_dir.name))
    if parsed is None:
        raise ValueError(f"Valid SKILL.md is required: {skill_file}")


def validate_agent_directory(source_dir: Path, *, target_status: str) -> AgentConfig:
    _require_directory(source_dir, label="agent source")
    agent_config = _load_agent_payload(source_dir, target_status=target_status)

    agents_md_path = source_dir / agent_config.agents_md_path
    if not agents_md_path.exists():
        raise ValueError(f"Agent AGENTS.md is required: {agents_md_path}")
    if not agents_md_path.is_file():
        raise ValueError(f"Agent AGENTS.md path must be a file: {agents_md_path}")

    for skill_ref in agent_config.skill_refs:
        if not skill_ref.materialized_path:
            raise ValueError(f"Agent skill ref '{skill_ref.name}' must define a materialized path.")
        materialized_path = source_dir / skill_ref.materialized_path
        if not materialized_path.exists():
            raise ValueError(f"Agent skill ref '{skill_ref.name}' is missing copied files: {materialized_path}")

    return agent_config


def _rewrite_agent_status(target_dir: Path, *, status: str) -> None:
    config_file = target_dir / "config.yaml"
    payload = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"Agent config must be a mapping: {config_file}")
    payload["status"] = status
    config_file.write_text(
        yaml.dump(payload, default_flow_style=False, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def save_skill_directory_to_store(
    *,
    source_dir: Path,
    skill_name: str,
    paths: Paths | None = None,
) -> tuple[Path, Path | None]:
    paths = paths or get_paths()
    skill_path = _normalize_skill_path(skill_name)
    validate_skill_directory(source_dir)
    target_dir = paths.store_dev_skills_dir / Path(skill_path.as_posix())
    return _copy_directory(source_dir, target_dir)


def save_agent_directory_to_store(
    *,
    source_dir: Path,
    agent_name: str,
    paths: Paths | None = None,
) -> tuple[Path, Path | None]:
    paths = paths or get_paths()
    normalized_agent_name = _normalize_agent_name(agent_name)
    validate_agent_directory(source_dir, target_status="dev")
    target_dir = paths.agent_dir(normalized_agent_name, "dev")
    saved_target_dir, backup_dir = _copy_directory(source_dir, target_dir)
    _rewrite_agent_status(saved_target_dir, status="dev")
    return saved_target_dir, backup_dir


def push_skill_directory_to_prod(
    skill_name: str,
    *,
    paths: Paths | None = None,
) -> tuple[Path, Path | None]:
    paths = paths or get_paths()
    skill_path = _normalize_skill_path(skill_name)
    source_dir = paths.store_dev_skills_dir / Path(skill_path.as_posix())
    validate_skill_directory(source_dir)
    target_dir = paths.store_prod_skills_dir / Path(skill_path.as_posix())
    return _copy_directory(source_dir, target_dir)


def promote_skill_directory_to_shared(
    skill_name: str,
    *,
    paths: Paths | None = None,
) -> tuple[Path, Path | None]:
    paths = paths or get_paths()
    skill_path = _normalize_skill_path(skill_name)
    source_dir = paths.store_prod_skills_dir / Path(skill_path.as_posix())
    validate_skill_directory(source_dir)
    target_dir = paths.shared_skills_dir / Path(skill_path.as_posix())
    return _copy_directory(source_dir, target_dir)


def push_agent_directory_to_prod(
    agent_name: str,
    *,
    paths: Paths | None = None,
) -> tuple[Path, Path | None]:
    paths = paths or get_paths()
    normalized_agent_name = _normalize_agent_name(agent_name)
    source_dir = paths.agent_dir(normalized_agent_name, "dev")
    validate_agent_directory(source_dir, target_status="prod")
    target_dir = paths.agent_dir(normalized_agent_name, "prod")
    saved_target_dir, backup_dir = _copy_directory(source_dir, target_dir)
    _rewrite_agent_status(saved_target_dir, status="prod")
    return saved_target_dir, backup_dir


def _runtime_thread_id(runtime: ToolRuntime | None) -> str:
    context = getattr(runtime, "context", None) or {}
    thread_id = context.get("thread_id") or context.get("x-thread-id")
    if not thread_id:
        raise ValueError("thread_id is required in runtime context.")
    return str(thread_id)


def _thread_data(runtime: ToolRuntime[dict, ThreadState] | None) -> dict:
    if runtime is None or runtime.state is None:
        return {}
    thread_data = runtime.state.get("thread_data")
    if isinstance(thread_data, dict):
        return thread_data
    return {}


def resolve_runtime_source_path(
    *,
    runtime: ToolRuntime[dict, ThreadState] | None,
    source_path: str,
    paths: Paths | None = None,
) -> Path:
    paths = paths or get_paths()
    raw_path = str(source_path).strip()
    if not raw_path:
        raise ValueError("source_path is required.")
    if raw_path.startswith(VIRTUAL_PATH_PREFIX):
        return paths.resolve_virtual_path(_runtime_thread_id(runtime), raw_path)
    return Path(raw_path).expanduser().resolve()


def resolve_default_agent_source_dir(
    *,
    runtime: ToolRuntime[dict, ThreadState] | None,
    agent_name: str,
    paths: Paths | None = None,
) -> Path:
    paths = paths or get_paths()
    thread_id = _runtime_thread_id(runtime)
    normalized_agent_name = _normalize_agent_name(agent_name)
    thread_data = _thread_data(runtime)

    authoring_base = Path(thread_data.get("authoring_agents_path") or paths.sandbox_authoring_agents_dir(thread_id))
    runtime_agents_base = Path(thread_data.get("agents_path") or paths.sandbox_agents_dir(thread_id))
    candidates = (
        authoring_base / normalized_agent_name,
        runtime_agents_base / "dev" / normalized_agent_name,
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def resolve_default_skill_source_dir(
    *,
    runtime: ToolRuntime[dict, ThreadState] | None,
    skill_name: str,
    paths: Paths | None = None,
) -> Path:
    paths = paths or get_paths()
    thread_id = _runtime_thread_id(runtime)
    skill_path = _normalize_skill_path(skill_name)
    thread_data = _thread_data(runtime)
    authoring_base = Path(thread_data.get("authoring_skills_path") or paths.sandbox_authoring_skills_dir(thread_id))
    return authoring_base / Path(skill_path.as_posix())
