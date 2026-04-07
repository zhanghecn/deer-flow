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
        "Runtime executes against a per-thread materialized copy of the archived agent files.",
        "Attached copied skills live under `/mnt/user-data/agents/{status}/{agent}/skills/...`.",
        "When creating or updating an agent for future runs, persist through `setup_agent`.",
        "When `lead_agent` creates a new agent from normal chat, it must still choose and pass an explicit short kebab-case `agent_name`",
        "When reusing an archived skill, pass it explicitly in `setup_agent(..., skills=[{source_path: \"...\"}])`.",
    ]

    for prompt_path in prompt_paths:
        content = prompt_path.read_text(encoding="utf-8")
        for snippet in required_snippets:
            assert snippet in content, f"Missing snippet in {prompt_path}: {snippet}"
