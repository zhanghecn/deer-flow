from pathlib import Path


def test_archived_lead_agent_prompts_include_runtime_path_guardrails():
    repo_root = Path(__file__).resolve().parents[3]
    prompt_paths = [
        repo_root / ".openagents" / "agents" / "dev" / "lead_agent" / "AGENTS.md",
        repo_root / ".openagents" / "agents" / "prod" / "lead_agent" / "AGENTS.md",
    ]
    required_snippets = [
        "only use the runtime-visible `/mnt/user-data/...` contract",
        "Do not invent sibling directories such as `/mnt/user-data/agentz`",
        "verify them against the user's explicit checklist",
        "aim close to that target instead of overshooting it by a large margin",
        "required keywords, and requested scope",
        "put each choice into the structured `options` array",
        "do not search runtime paths to prove the target agent exists before calling `setup_agent`",
        "inspect exactly `/mnt/user-data/agents/{status}/{target_agent_name}/...`",
        "omit the `model` argument in `setup_agent`",
    ]

    for prompt_path in prompt_paths:
        content = prompt_path.read_text(encoding="utf-8")
        for snippet in required_snippets:
            assert snippet in content, f"Missing snippet in {prompt_path}: {snippet}"
