import logging
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.prebuilt import ToolRuntime
from langgraph.types import Command
from pydantic import BaseModel, Field

from src.config.agent_materialization import materialize_agent_definition
from src.config.agent_runtime_seed import runtime_seed_targets
from src.config.agent_skill_preservation import (
    load_existing_agent_skill_input,
    load_existing_agent_skill_inputs,
)
from src.config.agents_config import AgentConfig, load_agent_config, load_agent_subagents, load_agents_md
from src.config.builtin_agents import LEAD_AGENT_NAME, normalize_effective_agent_name
from src.config.paths import get_paths
from src.config.runtime_db import get_runtime_db_store
from src.mcp.library import normalize_mcp_profile_name, write_mcp_profile
from src.runtime_backends import (
    REMOTE_EXECUTION_BACKEND,
    build_runtime_workspace_backend,
    resolve_runtime_backend_kind,
)
from src.skills import load_skills, skill_source_path
from src.utils.runtime_context import runtime_context_value

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _ExistingAgentUpdateState:
    """Archive-backed state used to preserve untouched agent fields on update."""

    config: AgentConfig
    agents_md: str | None
    subagents: list[Any]


@dataclass
class _NormalizedSetupAgentSkillEntry:
    """Single normalized setup_agent skill after duplicate entries are merged."""

    name: str
    source_path: str | None = None
    content: str | None = None


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


class SetupAgentMCPProfileInput(BaseModel):
    """Single MCP library item for setup_agent."""

    name: str = Field(
        ...,
        description=(
            "Target reusable MCP profile name, for example `customer-docs` or "
            "`support/customer-docs.json`. This writes to the custom MCP library."
        ),
    )
    config_json: dict[str, object] = Field(
        ...,
        description=(
            "Canonical MCP profile JSON using the Claude Code-style `mcpServers` "
            "shape. The payload must define exactly one server entry."
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
    matching_name = normalized_source_path.rsplit("/", 1)[-1]
    available_sources_for_name: list[str] = []
    seen_sources: set[str] = set()
    for archived_skill in load_skills(
        skills_path=paths.skills_dir,
        use_config=False,
        enabled_only=False,
    ):
        resolved_source_path = skill_source_path(archived_skill)
        if archived_skill.name == matching_name and resolved_source_path not in seen_sources:
            available_sources_for_name.append(resolved_source_path)
            seen_sources.add(resolved_source_path)
        if resolved_source_path != normalized_source_path:
            continue
        return archived_skill.name
    if available_sources_for_name:
        available_sources = ", ".join(f"'{candidate}'" for candidate in available_sources_for_name)
        # Keep the tool strict about the requested source_path, but surface the
        # exact archived alternatives so the model can retry in the same turn
        # instead of guessing `system` vs `custom` again.
        raise ValueError(
            f"setup_agent skill source_path '{source_path}' was not found. "
            f"Available source_path for skill '{matching_name}': {available_sources}. "
            "Retry with one of those exact values."
        )
    raise ValueError(f"setup_agent skill source_path '{source_path}' was not found.")


def _normalize_setup_agent_skill_inputs(
    skills: list[SetupAgentSkillInput | dict[str, Any]] | None,
    *,
    paths: Any,
) -> list[_NormalizedSetupAgentSkillEntry]:
    normalized_entries: list[_NormalizedSetupAgentSkillEntry] = []
    entries_by_name: dict[str, _NormalizedSetupAgentSkillEntry] = {}

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

        existing_entry = entries_by_name.get(name)
        if existing_entry is None:
            existing_entry = _NormalizedSetupAgentSkillEntry(name=name)
            entries_by_name[name] = existing_entry
            normalized_entries.append(existing_entry)

        if source_path is not None:
            if existing_entry.source_path is None:
                existing_entry.source_path = source_path
            elif existing_entry.source_path != source_path:
                raise ValueError(
                    f"setup_agent skill '{name}' duplicates conflicting `source_path` values."
                )

        if raw_content is None:
            continue

        content = str(raw_content)
        if not content.strip():
            raise ValueError(
                f"setup_agent skill '{name}' provided empty `content`. "
                "Omit `content` to copy an existing skill, or provide the full SKILL.md."
            )
        if existing_entry.content is None:
            existing_entry.content = content
            continue
        if existing_entry.content != content:
            raise ValueError(
                f"setup_agent skill '{name}' duplicates conflicting `content` values."
            )

    return normalized_entries


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

    for skill_entry in _normalize_setup_agent_skill_inputs(skills, paths=paths):
        # Models sometimes retry the same skill twice in one tool call, for
        # example once with `source_path` and once name-only. Collapse those
        # duplicates before preservation so a thread-local edited copied skill
        # can win as one inline update instead of being rematerialized from the
        # archived reusable source.
        if skill_entry.content is None:
            preserved_copied_ref, preserved_inline_skill = load_existing_agent_skill_input(
                skill_name=skill_entry.name,
                expected_source_path=skill_entry.source_path,
                agent_name=agent_name,
                agent_status=agent_status,
                thread_id=thread_id,
                paths=paths,
            )
            if preserved_inline_skill is not None:
                inline_skills.append(preserved_inline_skill)
                continue
            if preserved_copied_ref is not None:
                copied_skill_refs.append(preserved_copied_ref)
                continue
            copied_ref = {"name": skill_entry.name}
            if skill_entry.source_path is not None:
                copied_ref["source_path"] = skill_entry.source_path
            copied_skill_refs.append(copied_ref)
            continue

        inline_skills.append({"name": skill_entry.name, "content": skill_entry.content})

    return copied_skill_refs, inline_skills


def _normalize_optional_agents_md(agents_md: str | None) -> str | None:
    if agents_md is None:
        return None
    rendered = str(agents_md)
    if not rendered.strip():
        raise ValueError("setup_agent `agents_md` cannot be empty.")
    return rendered


def _normalize_optional_description(description: str | None) -> str | None:
    if description is None:
        return None
    rendered = str(description).strip()
    if not rendered:
        raise ValueError("setup_agent `description` cannot be empty.")
    return rendered


def _merge_mcp_server_bindings(*binding_sets: list[str] | None) -> list[str] | None:
    merged: list[str] = []
    seen: set[str] = set()
    for values in binding_sets:
        for raw_value in values or []:
            value = str(raw_value or "").strip()
            if not value or value in seen:
                continue
            merged.append(value)
            seen.add(value)
    return merged or None


def _write_requested_mcp_profiles(
    *,
    mcp_profiles: list[SetupAgentMCPProfileInput | dict[str, Any]] | None,
    paths: Any,
) -> tuple[list[str], list[tuple[Path, bytes | None]]]:
    """Write custom MCP library items requested by setup_agent.

    Returns the canonical profile refs that should be bound to the target agent
    plus rollback data for any files touched in this call.
    """

    written_refs: list[str] = []
    rollback_items: list[tuple[Path, bytes | None]] = []

    for raw_entry in mcp_profiles or []:
        parsed = (
            raw_entry
            if isinstance(raw_entry, SetupAgentMCPProfileInput)
            else SetupAgentMCPProfileInput.model_validate(raw_entry)
        )
        normalized_name = normalize_mcp_profile_name(parsed.name)
        target_file = paths.custom_mcp_profile_file(normalized_name)
        previous_content = target_file.read_bytes() if target_file.exists() else None
        rollback_items.append((target_file, previous_content))
        source_path = write_mcp_profile(
            scope="custom",
            name=normalized_name,
            config_json=parsed.config_json,
            paths=paths,
        )
        written_refs.append(source_path)

    return written_refs, rollback_items


def _rollback_mcp_profile_writes(rollback_items: list[tuple[Path, bytes | None]]) -> None:
    for profile_file, previous_content in reversed(rollback_items):
        if previous_content is None:
            profile_file.unlink(missing_ok=True)
            continue
        profile_file.parent.mkdir(parents=True, exist_ok=True)
        profile_file.write_bytes(previous_content)


def _load_existing_agent_update_state(
    *,
    agent_name: str,
    agent_status: str,
    paths: Any,
) -> _ExistingAgentUpdateState | None:
    try:
        existing_config = load_agent_config(agent_name, status=agent_status, paths=paths)
    except FileNotFoundError:
        return None

    existing_agents_md = load_agents_md(agent_name, status=agent_status, paths=paths)
    existing_subagents = load_agent_subagents(agent_name, status=agent_status, paths=paths)
    return _ExistingAgentUpdateState(
        config=existing_config,
        agents_md=existing_agents_md,
        subagents=list(existing_subagents.subagents),
    )


def _resolve_manifest_update_inputs(
    *,
    agent_name: str,
    agent_status: str,
    paths: Any,
    owner_user_id: str | None,
    agents_md: str | None,
    description: str | None,
    tool_groups: list[str] | None,
    mcp_servers: list[str] | None,
) -> tuple[
    _ExistingAgentUpdateState | None,
    str,
    str,
    str | None,
    list[str] | None,
    list[str] | None,
    list[str] | None,
    Any,
    Any,
    list[Any] | None,
]:
    """Resolve the full manifest inputs expected by materialization.

    `setup_agent` only exposes a subset of agent fields, but updates must keep
    archive-owned fields such as tool routing, memory, and subagents intact.
    Otherwise a skill-only edit would silently strip unrelated runtime policy.
    """

    existing_state = _load_existing_agent_update_state(
        agent_name=agent_name,
        agent_status=agent_status,
        paths=paths,
    )
    explicit_agents_md = _normalize_optional_agents_md(agents_md)
    explicit_description = _normalize_optional_description(description)

    if existing_state is None:
        if explicit_agents_md is None or explicit_description is None:
            raise ValueError(
                "setup_agent requires non-empty `agents_md` and `description` when creating a new agent. "
                "For an existing archived agent update, you may omit unchanged fields and they will be preserved."
            )
        return (
            None,
            explicit_agents_md,
            explicit_description,
            owner_user_id,
            tool_groups,
            None,
            mcp_servers,
            None,
            None,
            None,
        )

    resolved_tool_groups = tool_groups if tool_groups is not None else existing_state.config.tool_groups
    resolved_mcp_servers = mcp_servers if mcp_servers is not None else existing_state.config.mcp_servers
    if explicit_agents_md is None and existing_state.agents_md is None:
        raise ValueError(
            f"setup_agent could not load existing AGENTS.md for '{agent_name}'. "
            "Pass explicit `agents_md` or repair the archived agent definition first."
        )
    resolved_owner_user_id = existing_state.config.owner_user_id or owner_user_id
    return (
        existing_state,
        explicit_agents_md if explicit_agents_md is not None else existing_state.agents_md,
        explicit_description if explicit_description is not None else existing_state.config.description,
        resolved_owner_user_id,
        resolved_tool_groups,
        existing_state.config.tool_names,
        resolved_mcp_servers,
        existing_state.config.memory,
        existing_state.config.subagent_defaults,
        existing_state.subagents,
    )


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


def _runtime_thread_id(runtime: ToolRuntime | None) -> str | None:
    runtime_context = getattr(runtime, "context", None)
    for key in ("x-thread-id", "thread_id"):
        raw_value = runtime_context_value(runtime_context, key)
        normalized = str(raw_value or "").strip()
        if normalized:
            return normalized

    runtime_config = getattr(runtime, "config", None)
    configurable = runtime_config.get("configurable") if isinstance(runtime_config, Mapping) else None
    if not isinstance(configurable, Mapping):
        return None

    # LangGraph can keep the canonical thread binding in `configurable` even
    # when the tool runtime context omits it. `setup_agent` must honor that
    # same thread id so self-edits read the live runtime copied skill instead
    # of silently falling back to the archived reusable source.
    for key in ("x-thread-id", "thread_id"):
        raw_value = configurable.get(key)
        normalized = str(raw_value or "").strip()
        if normalized:
            return normalized
    return None


def _resolve_owner_user_id(*, runtime: ToolRuntime | None, thread_id: str | None) -> str | None:
    runtime_context = getattr(runtime, "context", None)
    direct_user_id = str(runtime_context_value(runtime_context, "user_id") or "").strip()
    if direct_user_id:
        return direct_user_id

    if not thread_id:
        return None

    try:
        owner_user_id = str(get_runtime_db_store().get_thread_owner(thread_id) or "").strip()
    except Exception:
        return None
    return owner_user_id or None


def _resolve_setup_agent_name(*, runtime_context: object, explicit_agent_name: str | None) -> str | None:
    normalized_explicit = str(explicit_agent_name or "").strip().lower()
    if normalized_explicit:
        return normalized_explicit

    current_agent_name = normalize_effective_agent_name(runtime_context_value(runtime_context, "agent_name"))
    if current_agent_name == LEAD_AGENT_NAME:
        return None
    return current_agent_name


def _current_runtime_agent_name(runtime_context: object) -> str:
    return normalize_effective_agent_name(runtime_context_value(runtime_context, "agent_name"))


def _missing_agent_name_error(*, runtime_context: object) -> str:
    # `agent_name` remains a model-owned authoring choice for lead_agent. Do not
    # silently derive it from natural language or ambient runtime state here.
    # Instead, return a stronger retry contract so the model can correct the
    # tool call in the same turn without prompt-specific glue.
    explicit_target = str(runtime_context_value(runtime_context, "target_agent_name") or "").strip().lower()
    lines = [
        "setup_agent requires explicit `agent_name` when called by `lead_agent`.",
        "Only a non-`lead_agent` runtime may omit `agent_name` to update itself.",
    ]
    if explicit_target:
        lines.append(
            f"This turn already provides structured `target_agent_name=\"{explicit_target}\"`; "
            "retry immediately with that exact value in `agent_name`."
        )
        example_name = explicit_target
    else:
        lines.append(
            "If the user did not provide a name, choose a short descriptive kebab-case "
            "`agent_name` yourself and retry immediately in the same turn instead of "
            "asking only for naming."
        )
        example_name = "pr-review-agent"
    lines.append(
        "Call `setup_agent` again with explicit `agent_name`, `agents_md`, and `description`, "
        "for example "
        f"`setup_agent(agent_name=\"{example_name}\", description=\"Reviews pull requests\", "
        "agents_md=\"# PR Review Agent\\n...\")`."
    )
    return " ".join(lines)


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


@tool("setup_agent", parse_docstring=True)
def setup_agent(
    runtime: ToolRuntime,
    agents_md: str | None = None,
    description: str | None = None,
    agent_name: str | None = None,
    model: str | None = None,
    tool_groups: list[str] | None = None,
    mcp_servers: list[str] | None = None,
    mcp_profiles: list[SetupAgentMCPProfileInput] | None = None,
    skills: list[SetupAgentSkillInput] | None = None,
) -> Command:
    """Create or update a dev agent definition with copied and/or inline skills.

    Args:
        runtime: LangGraph tool runtime injected by the agent harness.
        agents_md: Full AGENTS.md markdown content for the target agent. Pass the actual
            file body, not a path or a partial diff. Required when creating a new
            agent. When updating an existing archived agent and AGENTS.md is
            unchanged, omit this field to preserve the current archived content.
        description: One-line summary of what the agent does. Required when
            creating a new agent. When updating an existing archived agent and
            the description is unchanged, omit this field to preserve the
            current archived value.
        agent_name: Explicit target agent archive name. Required when the current runtime
            agent is `lead_agent`. When creating a new agent, choose a short kebab-case
            archive name such as `pr-review-agent`. If the user did not provide one,
            `lead_agent` must still choose one explicitly instead of omitting the field.
            Only a non-`lead_agent` runtime may omit this field to update itself.
        model: Optional model override for the agent (e.g. "openai/gpt-4o").
            When omitted, setup_agent persists the current runtime model selection.
        tool_groups: Optional list of runtime tool groups to enable for the agent.
        mcp_servers: Optional list of MCP library refs or legacy MCP names to bind to
            the agent. Canonical refs look like `custom/mcp-profiles/customer-docs.json`
            or `system/mcp-profiles/slack.json`. When omitted, preserve the existing
            archived agent MCP bindings.
        mcp_profiles: Optional custom MCP library items to create or update before
            binding. Each entry uses canonical `mcpServers` JSON and is written into
            the custom MCP library. Newly written profile refs are automatically bound
            to the target agent for this call.
        skills: Optional list of skill entries. Use a skill `source_path` or existing
            skill `name` to copy an archived skill. Use both a new skill `name` and full
            `content` to create or replace an agent-owned skill.
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
            raise ValueError(_missing_agent_name_error(runtime_context=runtime.context))

        paths = get_paths()
        written_mcp_refs, rollback_mcp_profile_items = _write_requested_mcp_profiles(
            mcp_profiles=mcp_profiles,
            paths=paths,
        )
        agent_status = str(runtime_context_value(runtime.context, "agent_status", "dev")).strip() or "dev"
        runtime_thread_id = _runtime_thread_id(runtime)
        owner_user_id = _resolve_owner_user_id(runtime=runtime, thread_id=runtime_thread_id)
        execution_backend = str(runtime_context_value(runtime.context, "execution_backend") or "").strip() or None
        remote_session_id = str(runtime_context_value(runtime.context, "remote_session_id") or "").strip() or None
        (
            existing_state,
            resolved_agents_md,
            resolved_description,
            resolved_owner_user_id,
            resolved_tool_groups,
            resolved_tool_names,
            resolved_mcp_servers,
            resolved_memory,
            resolved_subagent_defaults,
            resolved_subagents,
        ) = _resolve_manifest_update_inputs(
            agent_name=resolved_agent_name,
            agent_status=agent_status,
            paths=paths,
            owner_user_id=owner_user_id,
            agents_md=agents_md,
            description=description,
            tool_groups=tool_groups,
            mcp_servers=_merge_mcp_server_bindings(mcp_servers, written_mcp_refs),
        )
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
        agent_dir = paths.custom_agent_dir(resolved_agent_name, agent_status)
        archive_existed = existing_state is not None
        materialized = materialize_agent_definition(
            name=resolved_agent_name,
            status=agent_status,
            agents_md=resolved_agents_md,
            owner_user_id=resolved_owner_user_id,
            description=resolved_description,
            model=resolved_model,
            tool_groups=resolved_tool_groups,
            tool_names=resolved_tool_names,
            mcp_servers=resolved_mcp_servers,
            skill_refs=copied_skill_refs,
            inline_skills=inline_skills,
            memory=resolved_memory,
            subagent_defaults=resolved_subagent_defaults,
            subagents=resolved_subagents,
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
        current_runtime_agent = _current_runtime_agent_name(runtime.context)
        parts = [f"Agent '{resolved_agent_name}' {verb} successfully!"]
        if materialized_skills:
            parts.append(f"Skills materialized: {', '.join(materialized_skills)}")
        if current_runtime_agent != resolved_agent_name:
            parts.append(
                "If the user's same-turn request still needs this new agent to do real work now, "
                f"delegate with `task(subagent_type=\"{resolved_agent_name}\", description=\"short label\", prompt=\"full task briefing\")` "
                "instead of continuing in assistant prose as if you already switched agents."
            )

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
        if "rollback_mcp_profile_items" in locals():
            _rollback_mcp_profile_writes(rollback_mcp_profile_items)
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
