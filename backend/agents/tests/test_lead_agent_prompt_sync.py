from pathlib import Path


def test_archived_lead_agent_prompts_include_runtime_path_guardrails():
    repo_root = Path(__file__).resolve().parents[3]
    prompt_paths = [
        # Built-in lead_agent archives now live under `.openagents/system/agents`.
        # Keep this sync test pinned to the canonical archived prompt copies that
        # runtime materialization reads from for new threads.
        repo_root / ".openagents" / "system" / "agents" / "dev" / "lead_agent" / "AGENTS.md",
        repo_root / ".openagents" / "system" / "agents" / "prod" / "lead_agent" / "AGENTS.md",
    ]
    required_snippets = [
        "You are the default system lead agent for OpenAgents",
        "If a task matches an attached copied skill, read its copied `SKILL.md`",
        "Skill discovery is local-first",
        "Persist agent changes for future runs with `setup_agent`.",
        "Keep generated domain-agent `AGENTS.md` thin",
    ]

    for prompt_path in prompt_paths:
        content = prompt_path.read_text(encoding="utf-8")
        for snippet in required_snippets:
            assert snippet in content, f"Missing snippet in {prompt_path}: {snippet}"
