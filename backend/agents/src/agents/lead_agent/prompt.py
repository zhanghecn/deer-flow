from datetime import datetime
from pathlib import Path, PurePosixPath

from src.config.agents_config import AgentConfig, AgentMemoryConfig, load_agent_config, load_agents_md, resolve_authored_agent_dir
from src.config.builtin_agents import ensure_builtin_agent_archive
from src.config.paths import VIRTUAL_PATH_PREFIX, Paths, get_paths
from src.skills.parser import parse_skill_file

SECTION_THINKING_STYLE = """
<thinking_style>
- Think briefly before acting: note what is clear, missing, and risky.
- Keep thinking as an outline, not a drafted answer.
- After thinking, provide the actual response.
</thinking_style>
""".strip()

SECTION_WORKING_DIRECTORY = """
<working_directory existed="true">
- Runtime agent copies and copied skills live under `/mnt/user-data/agents`
- User uploads live under `/mnt/user-data/uploads`; scratch work under `/mnt/user-data/workspace`
- Shared temporary scratch lives under `/mnt/user-data/tmp` and is also available at `/tmp`
- Final deliverables belong under `/mnt/user-data/outputs`; draft authoring belongs under `/mnt/user-data/authoring`
- Read copied skills and uploads with the exact runtime paths provided in context
- When an upload has both `Path` and `Original Path`, prefer `Path` first
- Use `read_file` pagination for large files
- Treat the `read_file` footer as authoritative: if it says `(End of file - total N lines)`, do not invent more content or keep paginating past EOF
- If you must process a large file in chunks, pick one bounded chunking plan up front; do not recursively split remainders into smaller and smaller files unless the user explicitly asks for that workflow
- If the user specified an output filename or format, use it exactly
- Present only final deliverables from `/mnt/user-data/outputs` with `present_files`
</working_directory>
""".strip()

SECTION_RESPONSE_STYLE = """
<response_style>
- Be concise and natural.
- Prefer prose unless structure materially helps.
</response_style>
""".strip()

SECTION_EVIDENCE = """
<evidence_style>
- Cite sources after `web_search`; if a copied skill requires stricter evidence rules, follow them.
</evidence_style>
""".strip()

SECTION_EXECUTION_CONTRACT = """
<execution_contract>
- Finish execution tasks instead of stopping at a plan or research summary unless the user asked for analysis only
- Do not end an execution turn with progress-only text such as "next I will ..."; do the work, call `question` if blocked, or deliver the completed result
- Before finalizing, verify explicit user constraints such as filename, format, required sections, ordering, and requested scope
- Keep intermediate work in `/mnt/user-data/workspace`; only final deliverables belong in `/mnt/user-data/outputs`
- Never expose raw `/mnt/user-data/...` paths in user-facing prose
- Keep the same language as the user and always provide a visible response
- If blocking information is missing, call `question` and pause tool work
- Persist draft agents or skills only through the explicit save/push commands
- Do not inspect environment variables, secrets, or third-party API availability unless the user explicitly asked for that external system or provided credentials/instructions to use it
- Do not route work through ad-hoc external APIs just because credentials happen to exist in the runtime environment
</execution_contract>
""".strip()


def _get_authoring_context(*, agent_name: str | None, agent_status: str) -> str:
    normalized_agent_name = str(agent_name or "").strip().lower()
    if agent_status != "dev" or normalized_agent_name in {"", "lead_agent"}:
        return ""

    return f"""
<self_authoring>
- When the user asks you to update your own dev agent definition or agent-owned skills for future runs, persist that change with `setup_agent`.
- Read your current runtime copy under `/mnt/user-data/agents/{agent_status}/{normalized_agent_name}/...` as needed, then call `setup_agent` with the full updated content.
- For skill edits, first read `/mnt/user-data/agents/{agent_status}/{normalized_agent_name}/config.yaml` and the copied `SKILL.md` you plan to change.
- If you are only changing skills and your archived `AGENTS.md` plus one-line description stay unchanged, you may omit `agents_md` and `description`; `setup_agent` preserves those existing archived values for an update.
- Do not read `AGENTS.md` just to re-send it unchanged unless you actually need to inspect or edit it.
- `setup_agent(skills=...)` replaces the target skill set. Preserve every current skill explicitly: keep unchanged archived copied skills with their exact `source_path`, keep unchanged agent-owned skills as `{{name, content}}`, and pass each edited skill as `{{name, content: "<full updated SKILL.md>"}}`.
- Do not edit only the thread-local copied skill and then omit `skills`; that refreshes from archived sources and loses the skill change.
- When updating yourself as a non-`lead_agent` dev runtime, you may omit `agent_name` in `setup_agent`; it will resolve to the current agent.
</self_authoring>
"""


def _get_memory_context(
    *,
    user_id: str | None,
    agent_name: str | None,
    agent_status: str = "dev",
    memory_config: AgentMemoryConfig,
) -> str:
    """Get memory context for injection into system prompt."""
    from src.agents.memory import format_memory_for_injection, get_memory_data

    if not memory_config.enabled or not memory_config.injection_enabled:
        return ""
    if not user_id:
        raise ValueError("Agent memory is enabled but `user_id` is missing.")
    if not agent_name:
        raise ValueError("Agent memory is enabled but `agent_name` is missing.")

    memory_data = get_memory_data(
        user_id=user_id,
        agent_name=agent_name,
        agent_status=agent_status,
    )
    memory_content = format_memory_for_injection(memory_data, max_tokens=memory_config.max_injection_tokens)

    if not memory_content.strip():
        return ""

    return f"""<memory>
{memory_content}
</memory>
"""


def get_agents_md_section(agent_name: str | None, agent_status: str = "dev") -> str:
    """Return the AGENTS.md content wrapped in XML tags for the system prompt."""
    ensure_builtin_agent_archive(agent_name, status=agent_status)
    content = load_agents_md(agent_name, status=agent_status)
    if content:
        return f"<agents_md>\n{content}\n</agents_md>\n"
    return ""


def _skill_runtime_file_path(
    *,
    agent_name: str,
    agent_status: str,
    materialized_path: str,
) -> str | None:
    relative_path = PurePosixPath(str(materialized_path).strip())
    if (
        relative_path.is_absolute()
        or ".." in relative_path.parts
        or not relative_path.parts
        or relative_path.parts[0] != "skills"
    ):
        return None
    return PurePosixPath(
        VIRTUAL_PATH_PREFIX,
        "agents",
        agent_status,
        agent_name.lower(),
        *relative_path.parts,
        "SKILL.md",
    ).as_posix()


def _load_attached_skills_section(
    *,
    agent_name: str | None,
    agent_status: str,
    agent_config: AgentConfig | None,
    paths: Paths | None = None,
) -> str:
    """Expose attached copied skills as runtime paths without inlining their bodies.

    This keeps the system prompt thin: prompt code points the model at the
    agent-owned copied `SKILL.md`, while the copied skill itself remains the
    single detailed workflow contract.
    """
    normalized_agent_name = str(agent_name or "").strip().lower()
    if not normalized_agent_name:
        return ""

    resolved_paths = paths or get_paths()
    resolved_config = agent_config
    if resolved_config is None:
        try:
            resolved_config = load_agent_config(
                normalized_agent_name,
                status=agent_status,
                paths=resolved_paths,
            )
        except FileNotFoundError:
            resolved_config = None
    if resolved_config is None or not resolved_config.skill_refs:
        return ""

    agent_root = resolve_authored_agent_dir(normalized_agent_name, agent_status, paths=resolved_paths)
    if agent_root is None:
        return ""
    entries: list[str] = [
        "<attached_skills>",
        "- Attached copied skills are listed below; they are not expanded automatically.",
        "- When a task matches one, read its copied `SKILL.md` first and resolve relative `references/`, `scripts/`, or `templates/` from that skill directory.",
        "- If the copied skill requires other files, read them before substantive work.",
        "- Then follow the skill's workflow/output contract and honor any required evidence or coverage rules.",
        "- If the skill treats chat as the default output, stay in chat unless the user or the skill explicitly requires a file.",
        "- If you create a file, still send a substantive visible answer in the same turn.",
        "- A bare external repo URL is not, by itself, a request for repository research. If it looks like a skill source, prefer discovery/install unless the user explicitly asked for analysis.",
        "- Prefer the runtime copied path below over archived store paths.",
        "",
        "Available attached skills:",
    ]

    for skill_ref in resolved_config.skill_refs:
        materialized_path = str(skill_ref.materialized_path or "").strip()
        if not materialized_path:
            continue

        runtime_skill_path = _skill_runtime_file_path(
            agent_name=normalized_agent_name,
            agent_status=agent_status,
            materialized_path=materialized_path,
        )
        if runtime_skill_path is None:
            continue

        host_skill_path = agent_root / Path(materialized_path) / "SKILL.md"
        description = None
        if host_skill_path.is_file():
            parsed_skill = parse_skill_file(
                host_skill_path,
                category="agent",
                relative_path=Path(materialized_path),
            )
            if parsed_skill is not None:
                description = parsed_skill.description

        # Keep each attached skill on one line to preserve prompt budget while
        # still exposing the runtime path the model must read before use.
        line = f"- `{skill_ref.name}`"
        if description:
            line += f": {description}"
        line += f" Read `{runtime_skill_path}`."
        if skill_ref.source_path:
            line += f" Source `{skill_ref.source_path}`."
        entries.append(line)

    if entries[-1] == "Available attached skills:":
        return ""

    entries.append("</attached_skills>")
    return "\n".join(entries)


def apply_prompt_template(
    *,
    user_id: str | None = None,
    agent_name: str | None = None,
    agent_status: str = "dev",
    memory_config: AgentMemoryConfig | None = None,
    agent_config: AgentConfig | None = None,
) -> str:
    """Render the base runtime system prompt without per-turn command state."""

    memory_context = _get_memory_context(
        user_id=user_id,
        agent_name=agent_name,
        agent_status=agent_status,
        memory_config=memory_config or AgentMemoryConfig(),
    )

    sections = [
        f"<role>\nYou are {agent_name or 'OpenAgents'}, an open-source super agent.\n</role>",
        get_agents_md_section(agent_name, agent_status).strip(),
        _load_attached_skills_section(
            agent_name=agent_name,
            agent_status=agent_status,
            agent_config=agent_config,
        ).strip(),
        memory_context.strip(),
        SECTION_THINKING_STYLE,
        SECTION_WORKING_DIRECTORY,
        SECTION_RESPONSE_STYLE,
        SECTION_EVIDENCE,
        SECTION_EXECUTION_CONTRACT,
        _get_authoring_context(agent_name=agent_name, agent_status=agent_status).strip(),
        f"<current_date>{datetime.now().strftime('%Y-%m-%d, %A')}</current_date>",
    ]
    return "\n\n".join(section for section in sections if section)
