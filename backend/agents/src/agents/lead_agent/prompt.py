from datetime import datetime
from pathlib import Path, PurePosixPath

from src.config.agents_config import AgentConfig, AgentMemoryConfig, load_agent_config, load_agents_md, resolve_authored_agent_dir
from src.config.builtin_agents import ensure_builtin_agent_archive
from src.config.paths import VIRTUAL_PATH_PREFIX, Paths, get_paths
from src.skills.parser import parse_skill_file

SECTION_THINKING_STYLE = """
<thinking_style>
- Think concisely and strategically about the user's request BEFORE taking action
- Break down the task: What is clear? What is ambiguous? What is missing?
- Never write down your full final answer or report in thinking process, but only outline
- CRITICAL: After thinking, you MUST provide your actual response to the user. Thinking is for planning, the response is for delivery.
- Your response must contain the actual answer, not just a reference to what you thought about
</thinking_style>
""".strip()

SECTION_WORKING_DIRECTORY = """
<working_directory existed="true">
- Runtime agent copies and copied skills live under `/mnt/user-data/agents`
- User uploads live under `/mnt/user-data/uploads`
- Scratch work lives under `/mnt/user-data/workspace`
- Final deliverables belong under `/mnt/user-data/outputs`
- Draft authoring belongs under `/mnt/user-data/authoring`
- Read copied skills and uploaded files with `read_file` using the exact runtime paths provided in context
- When an upload has both `Path` and `Original Path`, prefer `Path` first because it is usually the converted companion
- Use the pagination footer from `read_file` instead of tiny repeated slices
- If the user specified an output filename or format, use that exact final filename and format
- Present only final deliverables from `/mnt/user-data/outputs` with `present_files`
</working_directory>
""".strip()

SECTION_RESPONSE_STYLE = """
<response_style>
- Clear and Concise: Avoid over-formatting unless requested
- Natural Tone: Use paragraphs and prose, not bullet points by default
- Action-Oriented: Focus on delivering results, not explaining processes
</response_style>
""".strip()

SECTION_EVIDENCE = """
<evidence_style>
- After `web_search`, cite sources with Markdown links when you rely on them
- If an attached copied skill or middleware defines stricter evidence or citation rules, follow that stricter contract
</evidence_style>
""".strip()

SECTION_EXECUTION_CONTRACT = """
<execution_contract>
- Finish execution tasks instead of stopping at a plan or research summary unless the user asked for analysis only
- Before finalizing, verify explicit user constraints such as filename, format, required sections, ordering, and requested scope
- Keep intermediate work in `/mnt/user-data/workspace`; only final deliverables belong in `/mnt/user-data/outputs`
- Do not present intermediate analysis files as final deliverables
- Never expose raw `/mnt/user-data/...` paths in user-facing prose
- Keep the same language as the user
- Always provide a visible response after thinking
- If blocking information is missing, call `question`
- While waiting on a blocking `question`, do not continue tool work
- Persist draft agents or skills only through the explicit save/push commands
</execution_contract>
""".strip()


def _get_authoring_context(*, agent_name: str | None, agent_status: str) -> str:
    normalized_agent_name = str(agent_name or "").strip().lower()
    if agent_status != "dev" or normalized_agent_name in {"", "lead_agent"}:
        return ""

    return f"""
<self_authoring>
- When the user asks you to update your own dev agent definition or agent-owned skills, persist that change with `setup_agent`.
- To update yourself, first read your current runtime copy under `/mnt/user-data/agents/{agent_status}/{normalized_agent_name}/...`, then call `setup_agent` with the full updated content.
- Do not use `write_file`, `edit_file`, or shell mutations to modify `/mnt/user-data/agents/{agent_status}/{normalized_agent_name}/...` directly. Those are thread-local runtime copies, not the canonical archive.
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
        "- Attached copied skills are not expanded automatically.",
        "- When the current task matches one of them, read that copied `SKILL.md` first with `read_file`.",
        "- Treat the copied `SKILL.md` as the detailed workflow contract and resolve any relative `references/`, `scripts/`, or `templates/` paths from its containing directory.",
        "- If the copied `SKILL.md` explicitly requires a relative reference file for the workflow, read that file before substantive analysis, evidence synthesis, or drafting.",
        "- After reading a matched copied `SKILL.md`, follow its mode-specific workflow and output contract literally instead of improvising a shorter variant.",
        "- If the copied skill marks certain evidence, citation, or coverage rules as required, satisfy those rules in the visible answer and in any optional artifact you choose to generate.",
        "- A bare external repo URL is not, by itself, a request for repository research. If it looks like a skill or capability source, prefer the matching discovery/install workflow unless the user explicitly asked for analysis.",
        "- Do not generate extra deliverables that the copied skill treats as optional unless the user asked for them or the skill makes them mandatory for the current mode.",
        "- If the copied skill says chat is the default output unless the user explicitly requested a file, artifact, or report, answer in chat and do not create optional files.",
        "- Never finish a turn with only presented artifacts or an empty assistant reply. If you create or present any file, you must still provide a substantive visible answer in the same turn.",
        "- Prefer the copied runtime path below over archived store paths when executing this agent's domain workflow.",
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

        line = f"- `{skill_ref.name}`"
        if description:
            line += f": {description}"
        entries.append(line)
        entries.append(f"  - read `{runtime_skill_path}`")
        if skill_ref.source_path:
            entries.append(f"  - archived source `{skill_ref.source_path}`")

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
