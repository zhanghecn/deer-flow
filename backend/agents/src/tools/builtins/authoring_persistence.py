from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import UTC, datetime
from fcntl import LOCK_EX, LOCK_UN, flock
from pathlib import Path, PurePosixPath
import re

import yaml
from langgraph.prebuilt import ToolRuntime

from src.agents.thread_state import ThreadState
from src.config.agent_materialization import validate_skill_refs_for_status
from src.config.agents_config import AGENT_NAME_PATTERN, AGENTS_MD_FILENAME, AgentConfig
from src.config.paths import Paths, VIRTUAL_PATH_PREFIX, get_paths
from src.skills.parser import parse_skill_file
from src.utils.runtime_context import runtime_context_value


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


def _skill_install_lock_path(paths: Paths) -> Path:
    return paths.base_dir / ".locks" / "registry-skill-install.lock"


@contextmanager
def _acquire_skill_install_lock(paths: Paths):
    lock_path = _skill_install_lock_path(paths)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        flock(lock_file.fileno(), LOCK_EX)
        try:
            yield
        finally:
            flock(lock_file.fileno(), LOCK_UN)


def _load_agent_payload(
    source_dir: Path,
    *,
    target_status: str,
    paths: Paths | None = None,
) -> AgentConfig:
    config_file = source_dir / "config.yaml"
    if not config_file.exists():
        raise ValueError(f"Agent config.yaml is required: {config_file}")

    payload = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"Agent config must be a mapping: {config_file}")

    payload.setdefault("name", source_dir.name)
    payload["status"] = target_status
    payload.setdefault("agents_md_path", AGENTS_MD_FILENAME)
    agent_config = AgentConfig.model_validate(payload)
    validate_skill_refs_for_status(
        agent_config.skill_refs,
        target_status=target_status,
        paths=paths,
    )
    return agent_config


def validate_skill_directory(skill_dir: Path) -> None:
    _require_directory(skill_dir, label="skill source")
    skill_file = skill_dir / "SKILL.md"
    parsed = parse_skill_file(skill_file, category="store/dev", relative_path=Path(skill_dir.name))
    if parsed is None:
        raise ValueError(f"Valid SKILL.md is required: {skill_file}")


def _existing_skill_scopes(*, skill_name: PurePosixPath, paths: Paths) -> tuple[str, ...]:
    relative_path = Path(skill_name.as_posix())
    scopes: list[str] = []
    if (paths.store_dev_skills_dir / relative_path).is_dir():
        scopes.append("store/dev")
    if (paths.store_prod_skills_dir / relative_path).is_dir():
        scopes.append("store/prod")
    return tuple(scopes)


def _registry_skill_name(skill_source: str, explicit_skill_name: str | None = None) -> PurePosixPath:
    normalized_source = str(skill_source).strip()
    if not normalized_source:
        raise ValueError("source is required.")

    if explicit_skill_name is not None and str(explicit_skill_name).strip():
        return _normalize_skill_path(explicit_skill_name)

    if "@" not in normalized_source:
        raise ValueError("skill_name is required when source does not include '@skill-name'.")

    return _normalize_skill_path(normalized_source.rsplit("@", 1)[-1])


_ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
_CLI_NOISE_LINE_RE = re.compile(r"^[\s│┌└■●◇◒◐◓◑]+")
_FAILURE_MESSAGE_HINTS = (
    "error",
    "failed",
    "invalid",
    "not found",
    "no matching skills found",
    "unable",
    "cannot",
)


def _normalize_subprocess_output_line(line: str) -> str:
    cleaned = _ANSI_ESCAPE_RE.sub("", line).strip()
    cleaned = _CLI_NOISE_LINE_RE.sub("", cleaned).strip()
    return cleaned


def _subprocess_failure_message(result: subprocess.CompletedProcess[str]) -> str:
    meaningful_lines: list[str] = []
    for stream in (result.stderr, result.stdout):
        for raw_line in str(stream or "").splitlines():
            line = _normalize_subprocess_output_line(raw_line)
            if not line or line.lower().startswith("npm notice"):
                continue
            meaningful_lines.append(line)

    for line in meaningful_lines:
        lowered = line.lower()
        if any(hint in lowered for hint in _FAILURE_MESSAGE_HINTS):
            return line

    if meaningful_lines:
        return meaningful_lines[-1]
    return f"command exited with code {result.returncode}"


def install_registry_skill_to_store(
    *,
    source: str,
    skill_name: str | None = None,
    paths: Paths | None = None,
) -> tuple[str, Path]:
    paths = paths or get_paths()
    normalized_source = str(source).strip()
    resolved_skill_name = _registry_skill_name(normalized_source, skill_name)

    existing_scopes = _existing_skill_scopes(skill_name=resolved_skill_name, paths=paths)
    runtime_scopes = tuple(
        scope for scope in existing_scopes if scope in {"store/dev", "store/prod"}
    )
    if runtime_scopes:
        scopes = ", ".join(runtime_scopes)
        raise ValueError(f"Skill '{resolved_skill_name.as_posix()}' already exists in {scopes}.")

    with _acquire_skill_install_lock(paths):
        with tempfile.TemporaryDirectory(prefix="openagents-skill-install-") as temp_home:
            temp_home_path = Path(temp_home)
            env = os.environ.copy()
            env["HOME"] = str(temp_home_path)
            env.setdefault("XDG_CONFIG_HOME", str(temp_home_path / ".config"))
            env.setdefault("XDG_CACHE_HOME", str(temp_home_path / ".cache"))
            env.setdefault("XDG_DATA_HOME", str(temp_home_path / ".local" / "share"))
            env["npm_config_yes"] = "true"

            result = subprocess.run(
                ["npx", "--yes", "skills", "add", normalized_source, "--yes", "--global"],
                capture_output=True,
                text=True,
                check=False,
                timeout=300,
                env=env,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"Failed to install registry skill '{normalized_source}': {_subprocess_failure_message(result)}"
                )

            downloaded_dir = temp_home_path / ".agents" / "skills" / Path(resolved_skill_name.as_posix())
            validate_skill_directory(downloaded_dir)

            parsed = parse_skill_file(
                downloaded_dir / "SKILL.md",
                category="store/dev",
                relative_path=Path(resolved_skill_name.as_posix()),
            )
            if parsed is None:
                raise ValueError(f"Valid SKILL.md is required: {downloaded_dir / 'SKILL.md'}")
            if parsed.name != resolved_skill_name.name:
                raise ValueError(
                    f"Installed skill name mismatch: expected '{resolved_skill_name.name}', got '{parsed.name}'."
                )

            target_dir, _backup_dir = _copy_directory(
                downloaded_dir,
                paths.store_dev_skills_dir / Path(resolved_skill_name.as_posix()),
            )
            return parsed.name, target_dir


def validate_agent_directory(
    source_dir: Path,
    *,
    target_status: str,
    paths: Paths | None = None,
) -> AgentConfig:
    _require_directory(source_dir, label="agent source")
    agent_config = _load_agent_payload(
        source_dir,
        target_status=target_status,
        paths=paths,
    )

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
    validate_agent_directory(source_dir, target_status="dev", paths=paths)
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


def push_agent_directory_to_prod(
    agent_name: str,
    *,
    paths: Paths | None = None,
) -> tuple[Path, Path | None]:
    paths = paths or get_paths()
    normalized_agent_name = _normalize_agent_name(agent_name)
    source_dir = paths.agent_dir(normalized_agent_name, "dev")
    validate_agent_directory(source_dir, target_status="prod", paths=paths)
    target_dir = paths.agent_dir(normalized_agent_name, "prod")
    saved_target_dir, backup_dir = _copy_directory(source_dir, target_dir)
    _rewrite_agent_status(saved_target_dir, status="prod")
    return saved_target_dir, backup_dir


def _runtime_thread_id(runtime: ToolRuntime | None) -> str:
    context = getattr(runtime, "context", None)
    thread_id = runtime_context_value(context, "thread_id") or runtime_context_value(context, "x-thread-id")
    if not thread_id:
        raise ValueError("thread_id is required in runtime context.")
    return str(thread_id)


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

    authoring_base = paths.sandbox_authoring_agents_dir(thread_id)
    runtime_agents_base = paths.sandbox_agents_dir(thread_id)
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
    authoring_base = paths.sandbox_authoring_skills_dir(thread_id)
    return authoring_base / Path(skill_path.as_posix())
