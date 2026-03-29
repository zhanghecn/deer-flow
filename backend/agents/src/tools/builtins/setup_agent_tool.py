import logging
from pathlib import Path
from typing import Any

import yaml

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command
from pydantic import BaseModel, Field

from src.config.agent_runtime_seed import runtime_seed_targets
from src.config.agent_materialization import materialize_agent_definition
from src.config.agents_config import AGENT_NAME_PATTERN, AGENTS_MD_FILENAME, AgentConfig
from src.config.paths import get_paths
from src.runtime_backends import (
    REMOTE_EXECUTION_BACKEND,
    build_runtime_workspace_backend,
    resolve_runtime_backend_kind,
)
from src.utils.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


class SetupAgentSkillInput(BaseModel):
    """Single skill entry for setup_agent."""

    name: str = Field(
        description=(
            "Skill name. When copying an existing shared/store skill, use the existing skill name. "
            "When creating a brand-new agent-owned skill, use the target local skill name."
        )
    )
    source_path: str | None = Field(
        default=None,
        description=(
            "Optional explicit shared skill source path such as 'store/prod/my-skill' or "
            "'store/dev/team/my-skill'. Use this when the same skill name exists in multiple scopes "
            "and the source must be explicit."
        ),
    )
    content: str | None = Field(
        default=None,
        description=(
            "Optional full SKILL.md markdown for a brand-new agent-owned skill. "
            "Omit this field when copying an existing shared/store skill by name."
        ),
    )


def _skill_entry_field(skill_entry: SetupAgentSkillInput | dict[str, Any], key: str) -> Any:
    if isinstance(skill_entry, SetupAgentSkillInput):
        return getattr(skill_entry, key, None)
    if isinstance(skill_entry, dict):
        return skill_entry.get(key)
    return getattr(skill_entry, key, None)


def _split_skill_inputs(
    skills: list[SetupAgentSkillInput | dict[str, Any]] | None,
    *,
    agent_name: str | None = None,
    agent_status: str = "dev",
    thread_id: str | None = None,
    paths: Any = None,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    copied_skill_refs: list[dict[str, str]] = []
    inline_skills: list[dict[str, str]] = []

    for skill_entry in skills or []:
        raw_name = _skill_entry_field(skill_entry, "name")
        raw_source_path = _skill_entry_field(skill_entry, "source_path")
        raw_content = _skill_entry_field(skill_entry, "content")

        if raw_name is None:
            if raw_content is None:
                continue
            raise ValueError("setup_agent skill entries with `content` must also provide `name`.")

        name = str(raw_name).strip()
        if not name:
            if raw_content is None:
                continue
            raise ValueError("setup_agent skill entries require a non-empty `name`.")

        source_path = str(raw_source_path).strip() if raw_source_path is not None else None
        if source_path == "":
            source_path = None

        if source_path is not None and raw_content is not None:
            raise ValueError(
                f"setup_agent skill '{name}' cannot provide both `source_path` and `content`."
            )

        if raw_content is None:
            if source_path is None:
                existing_content = _load_existing_agent_owned_skill_content(
                    skill_name=name,
                    agent_name=agent_name,
                    agent_status=agent_status,
                    thread_id=thread_id,
                    paths=paths,
                )
                if existing_content is not None:
                    inline_skills.append({"name": name, "content": existing_content})
                    continue
            copied_ref = {"name": name}
            if source_path is not None:
                copied_ref["source_path"] = source_path
            copied_skill_refs.append(copied_ref)
            continue

        content = str(raw_content)
        if not content.strip():
            raise ValueError(
                f"setup_agent skill '{name}' provided empty `content`. "
                "Omit `content` to copy an existing skill, or provide the full SKILL.md."
            )
        inline_skills.append({"name": name, "content": content})

    return copied_skill_refs, inline_skills


def _name_only_skill_names(
    skills: list[SetupAgentSkillInput | dict[str, Any]] | None,
) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    for skill_entry in skills or []:
        raw_name = _skill_entry_field(skill_entry, "name")
        raw_source_path = _skill_entry_field(skill_entry, "source_path")
        raw_content = _skill_entry_field(skill_entry, "content")
        if raw_name is None or raw_content is not None:
            continue
        if str(raw_source_path or "").strip():
            continue

        name = str(raw_name).strip()
        if not name or name in seen:
            continue
        names.append(name)
        seen.add(name)

    return names


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


def _load_existing_agent_owned_skill_content(
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
    if hasattr(paths, "agent_dir"):
        agent_root = paths.agent_dir(normalized_agent_name, agent_status)
        candidate_roots.append(Path(agent_root))

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


def _load_existing_agent_skill_inputs(
    *,
    agent_name: str | None,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> list[dict[str, str]]:
    normalized_agent_name = str(agent_name or "").strip().lower()
    if not normalized_agent_name or paths is None:
        return []
    if not AGENT_NAME_PATTERN.match(normalized_agent_name):
        return []

    candidate_roots: list[Path] = []
    if hasattr(paths, "agent_dir"):
        candidate_roots.append(Path(paths.agent_dir(normalized_agent_name, agent_status)))
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

        preserved_skills: list[dict[str, str]] = []
        for skill_ref in agent_config.skill_refs:
            if not skill_ref.materialized_path:
                continue
            skill_file = _skill_file_for_ref(agent_root, materialized_path=skill_ref.materialized_path)
            if not skill_file.is_file():
                continue
            preserved_skills.append(
                {
                    "name": skill_ref.name,
                    "content": skill_file.read_text(encoding="utf-8"),
                }
            )
        if preserved_skills:
            return preserved_skills

    return []


def _normalize_loaded_skill_refs(runtime_state: object) -> list[dict[str, str]]:
    if not isinstance(runtime_state, dict):
        return []

    raw_entries = runtime_state.get("loaded_skills")
    if not isinstance(raw_entries, list):
        return []

    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for entry in raw_entries:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        source_path = str(entry.get("source_path") or "").strip()
        if not name or not source_path:
            continue
        key = (name, source_path)
        if key in seen:
            continue
        seen.add(key)
        normalized.append({"name": name, "source_path": source_path})
    return normalized


def _resolve_default_setup_agent_skills(
    *,
    runtime_context: object,
    runtime_state: object,
    agent_name: str,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Build default skill inputs when the model omits `setup_agent.skills`.

    Omitted skills historically meant "preserve the current archive's copied or
    agent-owned skills". Keep that behavior, and additionally inherit archived
    skills that were explicitly loaded through the canonical `skill` tool during
    the current `/create-agent` run.
    """

    preserved_inline_skills = _load_existing_agent_skill_inputs(
        agent_name=agent_name,
        agent_status=agent_status,
        thread_id=thread_id,
        paths=paths,
    )
    preserved_names = {
        str(skill_input.get("name") or "").strip()
        for skill_input in preserved_inline_skills
        if isinstance(skill_input, dict)
    }
    command_name = str(runtime_context_value(runtime_context, "command_name") or "").strip()
    inherited_skill_refs = [
        skill_ref
        for skill_ref in _normalize_loaded_skill_refs(runtime_state)
        if command_name == "create-agent"
        if skill_ref["name"] not in preserved_names
    ]
    return inherited_skill_refs, preserved_inline_skills


def _runtime_agent_root(*, agent_name: str, agent_status: str) -> str:
    return f"/mnt/user-data/agents/{agent_status}/{agent_name.lower()}"


def _runtime_thread_id(runtime_context: object) -> str | None:
    for key in ("x-thread-id", "thread_id"):
        raw_value = runtime_context_value(runtime_context, key)
        normalized = str(raw_value or "").strip()
        if normalized:
            return normalized
    return None


def _refresh_thread_runtime_materials(
    *,
    agent_name: str,
    agent_status: str,
    thread_id: str | None,
    requested_backend: str | None,
    remote_session_id: str | None,
    manifest: AgentConfig,
    paths: Any,
) -> None:
    normalized_thread_id = str(thread_id or "").strip()
    if not normalized_thread_id:
        return

    paths.ensure_thread_dirs(normalized_thread_id)
    runtime_targets = runtime_seed_targets(
        agent_name,
        status=agent_status,
        target_root=_runtime_agent_root(agent_name=agent_name, agent_status=agent_status),
        paths=paths,
        manifest=manifest,
    )

    for virtual_path, content in runtime_targets:
        actual_path = paths.resolve_virtual_path(normalized_thread_id, virtual_path)
        actual_path.parent.mkdir(parents=True, exist_ok=True)
        actual_path.write_bytes(content)

    if resolve_runtime_backend_kind(requested_backend) != REMOTE_EXECUTION_BACKEND:
        return

    runtime_backend = build_runtime_workspace_backend(
        user_data_dir=str(paths.sandbox_user_data_dir(normalized_thread_id)),
        thread_id=normalized_thread_id,
        paths=paths,
        requested_backend=requested_backend,
        remote_session_id=remote_session_id,
    )
    upload_results = runtime_backend.upload_files(runtime_targets)
    errors = [f"{result.path}: {result.error}" for result in upload_results if result.error is not None]
    if errors:
        raise RuntimeError(f"Failed to refresh target agent runtime files: {', '.join(errors)}")


@tool
def setup_agent(
    agents_md: str,
    description: str,
    runtime: ToolRuntime,
    model: str | None = None,
    tool_groups: list[str] | None = None,
    skills: list[SetupAgentSkillInput] | None = None,
) -> Command:
    """Create or update a dev agent definition with copied and/or inline skills.

    Args:
        agents_md: Full AGENTS.md content defining the agent's personality and behavior.
        description: One-line description of what the agent does.
        model: Optional model override for the agent (e.g. "openai/gpt-4o").
            When omitted, setup_agent persists the current runtime model selection.
        tool_groups: Optional list of tool groups the agent can use.
        skills: Optional list of skill entries.
            Use {"name": "..."} to copy an existing shared/store skill by name.
            Use {"name": "...", "content": "...full SKILL.md..."} to create a new agent-owned skill.
    """

    target_agent_name = runtime_context_value(runtime.context, "target_agent_name") or runtime_context_value(
        runtime.context,
        "agent_name",
    )
    agent_name = str(target_agent_name).strip() if target_agent_name is not None else None
    resolved_model = model
    if resolved_model is None:
        runtime_model = runtime_context_value(runtime.context, "model_name") or runtime_context_value(
            runtime.context,
            "model",
        )
        if runtime_model is not None:
            normalized_model = str(runtime_model).strip()
            resolved_model = normalized_model or None

    try:
        if not agent_name:
            raise ValueError("setup_agent requires `agent_name` or `target_agent_name` in runtime context.")

        paths = get_paths()
        agent_status = str(runtime_context_value(runtime.context, "agent_status", "dev")).strip() or "dev"
        runtime_thread_id = _runtime_thread_id(runtime.context)
        execution_backend = str(runtime_context_value(runtime.context, "execution_backend") or "").strip() or None
        remote_session_id = str(runtime_context_value(runtime.context, "remote_session_id") or "").strip() or None
        if skills is None:
            copied_skill_refs, inline_skills = _resolve_default_setup_agent_skills(
                runtime_context=runtime.context,
                runtime_state=getattr(runtime, "state", None),
                agent_name=agent_name,
                agent_status=agent_status,
                thread_id=runtime_thread_id,
                paths=paths,
            )
        else:
            copied_skill_refs, inline_skills = _split_skill_inputs(
                skills,
                agent_name=agent_name,
                agent_status=agent_status,
                thread_id=runtime_thread_id,
                paths=paths,
            )
        materialized = materialize_agent_definition(
            name=agent_name,
            status=agent_status,
            agents_md=agents_md,
            description=description,
            model=resolved_model,
            tool_groups=tool_groups,
            skill_refs=copied_skill_refs,
            inline_skills=inline_skills,
            paths=paths,
            allow_shared_skills=True,
        )
        _refresh_thread_runtime_materials(
            agent_name=agent_name,
            agent_status=agent_status,
            thread_id=runtime_thread_id,
            requested_backend=execution_backend,
            remote_session_id=remote_session_id,
            manifest=materialized,
            paths=paths,
        )
        materialized_skills = [skill_ref.name for skill_ref in materialized.skill_refs]
        agent_dir = paths.agent_dir(agent_name, agent_status)

        parts = [f"Agent '{agent_name}' created successfully!"]
        if materialized_skills:
            parts.append(f"Skills materialized: {', '.join(materialized_skills)}")

        logger.info(
            "[agent_creator] Created agent '%s' at %s (skills: %s)",
            agent_name,
            agent_dir,
            materialized_skills,
        )
        return Command(
            update={
                "created_agent_name": agent_name,
                "messages": [ToolMessage(content=" ".join(parts), tool_call_id=runtime.tool_call_id)],
            }
        )

    except Exception as e:
        error_message = str(e)
        unresolved_name_only_skills = _name_only_skill_names(skills)
        if "not found in allowed scopes:" in error_message and unresolved_name_only_skills:
            hinted_skills = ", ".join(unresolved_name_only_skills)
            error_message = (
                f"{error_message} If {hinted_skills} should be a new or recovered agent-owned skill, "
                "call `setup_agent` with `skills: [{name: \"...\", content: \"...full SKILL.md...\"}]` "
                "instead of name-only skill entries."
            )
        logger.error(f"[agent_creator] Failed to create agent '{agent_name}': {error_message}", exc_info=True)
        return Command(
            update={"messages": [ToolMessage(content=f"Error: {error_message}", tool_call_id=runtime.tool_call_id)]}
        )
