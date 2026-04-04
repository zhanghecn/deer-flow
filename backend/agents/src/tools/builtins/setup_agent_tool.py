import logging
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command
from pydantic import BaseModel, Field

from src.config.builtin_agents import LEAD_AGENT_NAME, normalize_effective_agent_name
from src.config.agent_runtime_seed import runtime_seed_targets
from src.config.agent_materialization import materialize_agent_definition
from src.config.agent_skill_preservation import (
    load_existing_agent_owned_skill_content,
    load_existing_agent_skill_inputs,
)
from src.config.agents_config import AGENT_NAME_PATTERN, AgentConfig
from src.config.paths import get_paths
from src.runtime_backends import (
    REMOTE_EXECUTION_BACKEND,
    build_runtime_workspace_backend,
    resolve_runtime_backend_kind,
)
from src.skills import load_skills, skill_source_path
from src.utils.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


class SetupAgentSkillInput(BaseModel):
    """Single skill entry for setup_agent."""

    name: str | None = Field(
        default=None,
        description=(
            "Skill name. When copying an existing archived store skill, use the existing skill name. "
            "When creating a brand-new agent-owned skill, use the target local skill name."
        )
    )
    source_path: str | None = Field(
        default=None,
        description=(
            "Optional explicit skill source path such as 'system/skills/my-skill' or "
            "'custom/skills/team/my-skill'. Use this when the same skill name exists in multiple roots "
            "and the source must be explicit."
        ),
    )
    content: str | None = Field(
        default=None,
        description=(
            "Optional full SKILL.md markdown for a brand-new agent-owned skill. "
            "Omit this field when copying an existing archived store skill by name."
        ),
    )


def _skill_entry_field(skill_entry: SetupAgentSkillInput | dict[str, Any], key: str) -> Any:
    if isinstance(skill_entry, SetupAgentSkillInput):
        return getattr(skill_entry, key, None)
    if isinstance(skill_entry, dict):
        return skill_entry.get(key)
    return getattr(skill_entry, key, None)


def _resolve_archive_skill_name(*, source_path: str, paths: Any) -> str:
    normalized_source_path = str(source_path).strip().strip("/")
    for archived_skill in load_skills(
        skills_path=paths.skills_dir,
        use_config=False,
        enabled_only=False,
    ):
        if skill_source_path(archived_skill) != normalized_source_path:
            continue
        return archived_skill.name
    raise ValueError(f"setup_agent skill source_path '{source_path}' was not found.")


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

        source_path = str(raw_source_path).strip() if raw_source_path is not None else None
        if source_path == "":
            source_path = None

        name = str(raw_name).strip() if raw_name is not None else ""
        if not name and source_path is not None:
            name = _resolve_archive_skill_name(source_path=source_path, paths=paths)

        if not name:
            if raw_content is None and source_path is None:
                continue
            raise ValueError("setup_agent skill entries with `content` must provide `name`.")

        if source_path is not None and raw_content is not None:
            raise ValueError(
                f"setup_agent skill '{name}' cannot provide both `source_path` and `content`."
            )

        if raw_content is None:
            if source_path is None:
                existing_content = load_existing_agent_owned_skill_content(
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


def _resolve_default_setup_agent_skills(
    *,
    agent_name: str,
    agent_status: str,
    thread_id: str | None,
    paths: Any,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Build default skill inputs when the model omits `setup_agent.skills`.

    Omitting `skills` means "preserve the target agent's current skill setup".
    Keep archived copied skills as copied refs with their existing `source_path`,
    and keep agent-owned skills as inline `content`.
    """

    return load_existing_agent_skill_inputs(
        agent_name=agent_name,
        agent_status=agent_status,
        thread_id=thread_id,
        paths=paths,
    )


def _runtime_agent_root(*, agent_name: str, agent_status: str) -> str:
    return f"/mnt/user-data/agents/{agent_status}/{agent_name.lower()}"


def _runtime_thread_id(runtime_context: object) -> str | None:
    for key in ("x-thread-id", "thread_id"):
        raw_value = runtime_context_value(runtime_context, key)
        normalized = str(raw_value or "").strip()
        if normalized:
            return normalized
    return None


def _resolve_setup_agent_name(*, runtime_context: object, explicit_agent_name: str | None) -> str | None:
    normalized_explicit = str(explicit_agent_name or "").strip().lower()
    if normalized_explicit:
        return normalized_explicit

    current_agent_name = normalize_effective_agent_name(runtime_context_value(runtime_context, "agent_name"))
    if current_agent_name == LEAD_AGENT_NAME:
        return None
    return current_agent_name


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
    agent_name: str | None = None,
    model: str | None = None,
    tool_groups: list[str] | None = None,
    skills: list[SetupAgentSkillInput] | None = None,
) -> Command:
    """Create or update a dev agent definition with copied and/or inline skills.

    Args:
        agents_md: Full AGENTS.md content defining the agent's personality and behavior.
        description: One-line description of what the agent does.
        agent_name: Explicit target agent archive name. Required for `lead_agent`.
            When omitted, only a non-`lead_agent` runtime may update itself.
        model: Optional model override for the agent (e.g. "openai/gpt-4o").
            When omitted, setup_agent persists the current runtime model selection.
        tool_groups: Optional list of tool groups the agent can use.
        skills: Optional list of skill entries.
            Use {"name": "..."} to copy an existing archived store skill by name.
            Use {"name": "...", "content": "...full SKILL.md..."} to create a new agent-owned skill.
    """

    resolved_agent_name = _resolve_setup_agent_name(
        runtime_context=runtime.context,
        explicit_agent_name=agent_name,
    )
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
        if not resolved_agent_name:
            raise ValueError(
                "setup_agent requires explicit `agent_name` when called by `lead_agent`. "
                "Only a non-`lead_agent` runtime may omit `agent_name` to update itself."
            )

        paths = get_paths()
        agent_status = str(runtime_context_value(runtime.context, "agent_status", "dev")).strip() or "dev"
        runtime_thread_id = _runtime_thread_id(runtime.context)
        execution_backend = str(runtime_context_value(runtime.context, "execution_backend") or "").strip() or None
        remote_session_id = str(runtime_context_value(runtime.context, "remote_session_id") or "").strip() or None
        if skills is None:
            copied_skill_refs, inline_skills = _resolve_default_setup_agent_skills(
                agent_name=resolved_agent_name,
                agent_status=agent_status,
                thread_id=runtime_thread_id,
                paths=paths,
            )
        else:
            copied_skill_refs, inline_skills = _split_skill_inputs(
                skills,
                agent_name=resolved_agent_name,
                agent_status=agent_status,
                thread_id=runtime_thread_id,
                paths=paths,
            )
        if hasattr(paths, "custom_agent_dir"):
            agent_dir = paths.custom_agent_dir(resolved_agent_name, agent_status)
        else:
            agent_dir = paths.agent_dir(resolved_agent_name, agent_status)
        archive_existed = agent_dir.is_dir()
        materialized = materialize_agent_definition(
            name=resolved_agent_name,
            status=agent_status,
            agents_md=agents_md,
            description=description,
            model=resolved_model,
            tool_groups=tool_groups,
            skill_refs=copied_skill_refs,
            inline_skills=inline_skills,
            paths=paths,
        )
        _refresh_thread_runtime_materials(
            agent_name=resolved_agent_name,
            agent_status=agent_status,
            thread_id=runtime_thread_id,
            requested_backend=execution_backend,
            remote_session_id=remote_session_id,
            manifest=materialized,
            paths=paths,
        )
        materialized_skills = [skill_ref.name for skill_ref in materialized.skill_refs]

        verb = "updated" if archive_existed else "created"
        parts = [f"Agent '{resolved_agent_name}' {verb} successfully!"]
        if materialized_skills:
            parts.append(f"Skills materialized: {', '.join(materialized_skills)}")

        logger.info(
            "[agent_creator] Created agent '%s' at %s (skills: %s)",
            resolved_agent_name,
            agent_dir,
            materialized_skills,
        )
        return Command(
            update={
                "created_agent_name": resolved_agent_name,
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
        logger.error(f"[agent_creator] Failed to create agent '{resolved_agent_name}': {error_message}", exc_info=True)
        return Command(
            update={"messages": [ToolMessage(content=f"Error: {error_message}", tool_call_id=runtime.tool_call_id)]}
        )
