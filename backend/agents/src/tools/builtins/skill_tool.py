from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from langgraph.typing import ContextT

from src.agents.middlewares.loaded_skills_middleware import LoadedSkillEntry
from src.agents.thread_state import ThreadState
from src.config.paths import get_paths
from src.runtime_backends import build_runtime_workspace_backend
from src.skills import load_skills
from src.skills.types import Skill
from src.utils.runtime_context import runtime_context_value

_SKILLS_ARCHIVE_PREFIX = "/mnt/skills/"
_SKILL_FILE_NAME = "SKILL.md"
_SKILL_FILE_SAMPLE_LIMIT = 10


def _normalize_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _runtime_thread_id(runtime: ToolRuntime[ContextT, ThreadState]) -> str:
    context = getattr(runtime, "context", None)
    thread_id = runtime_context_value(context, "thread_id") or runtime_context_value(context, "x-thread-id")
    if not thread_id:
        raise ValueError("thread_id is required in runtime context.")
    return str(thread_id)


def _runtime_agent_name(runtime: ToolRuntime[ContextT, ThreadState]) -> str:
    context = getattr(runtime, "context", None)
    agent_name = runtime_context_value(context, "agent_name") or runtime_context_value(context, "x-agent-name")
    if not agent_name:
        raise ValueError("agent_name is required in runtime context.")
    return str(agent_name).strip().lower()


def _runtime_agent_status(runtime: ToolRuntime[ContextT, ThreadState]) -> str:
    context = getattr(runtime, "context", None)
    return str(
        runtime_context_value(context, "agent_status")
        or runtime_context_value(context, "x-agent-status")
        or "dev"
    ).strip() or "dev"


def _runtime_execution_backend(runtime: ToolRuntime[ContextT, ThreadState]) -> str | None:
    context = getattr(runtime, "context", None)
    return _normalize_text(runtime_context_value(context, "execution_backend"))


def _runtime_remote_session_id(runtime: ToolRuntime[ContextT, ThreadState]) -> str | None:
    context = getattr(runtime, "context", None)
    return _normalize_text(runtime_context_value(context, "remote_session_id"))


def _loaded_skills_from_state(state: object) -> list[LoadedSkillEntry]:
    if not isinstance(state, dict):
        return []
    raw_entries = state.get("loaded_skills")
    if not isinstance(raw_entries, list):
        return []

    normalized: list[LoadedSkillEntry] = []
    seen: set[tuple[str, str | None]] = set()
    for entry in raw_entries:
        if not isinstance(entry, dict):
            continue
        name = _normalize_text(entry.get("name"))
        runtime_path = _normalize_text(entry.get("runtime_path"))
        source_path = _normalize_text(entry.get("source_path"))
        if name is None or runtime_path is None:
            continue
        key = (runtime_path, source_path)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "name": name,
                "runtime_path": runtime_path,
                "source_path": source_path,
            }
        )
    return normalized


def _skill_source_path(skill: Skill) -> str:
    return Path(skill.category, skill.skill_path or skill.skill_dir.name).as_posix()


def _archive_matches_for_name(name: str, agent_status: str) -> list[Skill]:
    allowed_scopes = {"store/prod"} if agent_status == "prod" else {"store/dev", "store/prod"}
    matches = [
        skill
        for skill in load_skills(enabled_only=False)
        if skill.name == name and skill.category in allowed_scopes
    ]
    matches.sort(key=lambda skill: _skill_source_path(skill))
    return matches


def _archive_match_for_source_path(source_path: str) -> Skill | None:
    normalized_source_path = PurePosixPath(source_path).as_posix().strip("/")
    for skill in load_skills(enabled_only=False):
        if _skill_source_path(skill) == normalized_source_path:
            return skill
    return None


def _runtime_skill_matches_from_state(
    runtime: ToolRuntime[ContextT, ThreadState],
    name: str,
) -> list[dict[str, str]]:
    raw_state = getattr(runtime, "state", None)
    if not isinstance(raw_state, dict):
        return []
    raw_skills = raw_state.get("skills_metadata")
    if not isinstance(raw_skills, list):
        return []

    matches: list[dict[str, str]] = []
    for skill in raw_skills:
        if not isinstance(skill, dict):
            continue
        skill_name = _normalize_text(skill.get("name"))
        skill_path = _normalize_text(skill.get("path"))
        if skill_name != name or skill_path is None:
            continue
        if skill_path.startswith(_SKILLS_ARCHIVE_PREFIX):
            continue
        matches.append({"name": skill_name, "path": skill_path})
    return matches


def _runtime_loaded_skill_root(agent_name: str, agent_status: str, source_path: str) -> str:
    normalized_source_path = PurePosixPath(source_path).as_posix().strip("/")
    return f"/mnt/user-data/agents/{agent_status}/{agent_name}/loaded-skills/{normalized_source_path}"


def _materialize_archive_skill(
    *,
    runtime: ToolRuntime[ContextT, ThreadState],
    skill: Skill,
) -> str:
    thread_id = _runtime_thread_id(runtime)
    agent_name = _runtime_agent_name(runtime)
    agent_status = _runtime_agent_status(runtime)
    source_path = _skill_source_path(skill)
    target_root = _runtime_loaded_skill_root(agent_name, agent_status, source_path)

    targets: list[tuple[str, bytes]] = []
    for file_path in sorted(path for path in skill.skill_dir.rglob("*") if path.is_file()):
        relative_path = file_path.relative_to(skill.skill_dir).as_posix()
        targets.append((f"{target_root}/{relative_path}", file_path.read_bytes()))

    if not targets:
        raise ValueError(f"Skill '{skill.name}' has no files to materialize.")

    paths = get_paths()
    backend = build_runtime_workspace_backend(
        user_data_dir=str(paths.sandbox_user_data_dir(thread_id)),
        thread_id=thread_id,
        paths=paths,
        requested_backend=_runtime_execution_backend(runtime),
        remote_session_id=_runtime_remote_session_id(runtime),
    )
    upload_results = backend.upload_files(targets)
    errors = [f"{result.path}: {result.error}" for result in upload_results if result.error is not None]
    if errors:
        raise RuntimeError(f"Failed to materialize skill runtime files: {', '.join(errors)}")

    return target_root


def _runtime_skill_host_dir(
    *,
    runtime: ToolRuntime[ContextT, ThreadState],
    skill_file_path: str,
) -> Path:
    thread_id = _runtime_thread_id(runtime)
    paths = get_paths()
    return paths.resolve_virtual_path(thread_id, skill_file_path).parent


def _sample_skill_files(
    *,
    source_dir: Path,
    runtime_root: str,
) -> str:
    lines: list[str] = []
    for file_path in sorted(path for path in source_dir.rglob("*") if path.is_file()):
        relative_path = file_path.relative_to(source_dir).as_posix()
        lines.append(f"<file>{runtime_root}/{relative_path}</file>")
        if len(lines) >= _SKILL_FILE_SAMPLE_LIMIT:
            break
    return "\n".join(lines)


def _append_loaded_skill(
    *,
    runtime: ToolRuntime[ContextT, ThreadState],
    entry: LoadedSkillEntry,
) -> list[LoadedSkillEntry]:
    existing_entries = _loaded_skills_from_state(getattr(runtime, "state", None))
    filtered = [
        existing
        for existing in existing_entries
        if existing["runtime_path"] != entry["runtime_path"] or existing.get("source_path") != entry.get("source_path")
    ]
    filtered.append(entry)
    return filtered


def _skill_tool_error(tool_call_id: str, message: str) -> Command:
    return Command(update={"messages": [ToolMessage(content=f"Error: {message}", tool_call_id=tool_call_id)]})


@tool("skill", parse_docstring=True)
def skill_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    tool_call_id: Annotated[str, InjectedToolCallId],
    name: str | None = None,
    source_path: str | None = None,
) -> Command:
    """Load a skill's full instructions for the current run.

    Use this tool when the task matches an available skill and you need the
    complete SKILL.md instructions plus a runtime path for bundled helper files.

    Args:
        name: Skill name from the available skill list. Omit this when
            `source_path` already identifies the skill uniquely.
        source_path: Optional explicit archive source such as
            `store/prod/contracts/review`. Use this when the same skill name may
            exist in multiple archive scopes and you must select one exactly.
    """

    normalized_name = _normalize_text(name)
    normalized_source_path = _normalize_text(source_path)

    if normalized_name is None and normalized_source_path is None:
        return _skill_tool_error(tool_call_id, "Provide either `name` or `source_path`.")

    try:
        if normalized_source_path is not None:
            archive_skill = _archive_match_for_source_path(normalized_source_path)
            if archive_skill is None:
                raise ValueError(f"Skill source_path '{normalized_source_path}' was not found.")

            runtime_root = _materialize_archive_skill(runtime=runtime, skill=archive_skill)
            source_dir = archive_skill.skill_dir
            skill_name = archive_skill.name
            resolved_source_path = _skill_source_path(archive_skill)
            content = archive_skill.skill_file.read_text(encoding="utf-8")
        else:
            assert normalized_name is not None
            runtime_matches = _runtime_skill_matches_from_state(runtime, normalized_name)
            archive_matches = _archive_matches_for_name(normalized_name, _runtime_agent_status(runtime))

            if len(archive_matches) > 1:
                available_sources = ", ".join(_skill_source_path(skill) for skill in archive_matches)
                raise ValueError(
                    f"Skill '{normalized_name}' exists in multiple archive sources: {available_sources}. "
                    "Call `skill` again with an explicit `source_path`."
                )

            if runtime_matches and archive_matches:
                raise ValueError(
                    f"Skill '{normalized_name}' is ambiguous between a runtime-copied skill and an archived store skill. "
                    f"Use `source_path=\"{_skill_source_path(archive_matches[0])}\"` if you need the archived skill."
                )

            if runtime_matches:
                if len(runtime_matches) > 1:
                    runtime_paths = ", ".join(match["path"] for match in runtime_matches)
                    raise ValueError(
                        f"Skill '{normalized_name}' resolved to multiple runtime copies: {runtime_paths}. "
                        "Use a more specific workflow or inspect the target agent's copied skills directly."
                    )

                matched_runtime_skill = runtime_matches[0]
                skill_file_path = matched_runtime_skill["path"]
                source_dir = _runtime_skill_host_dir(runtime=runtime, skill_file_path=skill_file_path)
                runtime_root = str(PurePosixPath(skill_file_path).parent)
                skill_name = matched_runtime_skill["name"]
                resolved_source_path = None
                content = (source_dir / _SKILL_FILE_NAME).read_text(encoding="utf-8")
            elif archive_matches:
                archive_skill = archive_matches[0]
                runtime_root = _materialize_archive_skill(runtime=runtime, skill=archive_skill)
                source_dir = archive_skill.skill_dir
                skill_name = archive_skill.name
                resolved_source_path = _skill_source_path(archive_skill)
                content = archive_skill.skill_file.read_text(encoding="utf-8")
            else:
                raise ValueError(f"Skill '{normalized_name}' was not found in the current runtime or allowed archive scopes.")

        sampled_files = _sample_skill_files(source_dir=source_dir, runtime_root=runtime_root)
        loaded_entry: LoadedSkillEntry = {
            "name": skill_name,
            "runtime_path": runtime_root,
            "source_path": resolved_source_path,
        }
        payload_lines = [
            f'<skill_content name="{skill_name}">',
            f"# Skill: {skill_name}",
            "",
            content.strip(),
            "",
            f"Runtime base directory for this skill: {runtime_root}",
            "Resolve any relative paths mentioned by the skill from that runtime base directory.",
        ]
        if resolved_source_path is not None:
            payload_lines.append(f"Archived source path: {resolved_source_path}")
        payload_lines.extend(
            [
                "",
                "<skill_files>",
                sampled_files,
                "</skill_files>",
                "</skill_content>",
            ]
        )
        return Command(
            update={
                "loaded_skills": _append_loaded_skill(runtime=runtime, entry=loaded_entry),
                "messages": [ToolMessage(content="\n".join(payload_lines), tool_call_id=tool_call_id)],
            }
        )
    except Exception as exc:
        return _skill_tool_error(tool_call_id, str(exc))
