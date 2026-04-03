from pathlib import Path

import yaml

from src.config.paths import Paths
from src.agents.lead_agent import prompt as prompt_module


def test_apply_prompt_template_keeps_base_prompt_free_of_runtime_command_blocks(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")

    rendered = prompt_module.apply_prompt_template()

    assert "<runtime_command>" not in rendered
    assert "<runtime_command_instruction>" not in rendered
    assert "<working_directory existed=\"true\">" in rendered
    assert "<execution_contract>" in rendered
    assert "Never expose raw `/mnt/user-data/...` paths" in rendered
    assert "verify explicit user constraints" in rendered
    assert "If blocking information is missing, call `question`" in rendered


def test_apply_prompt_template_keeps_knowledge_base_detail_out_of_base_prompt(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")

    rendered = prompt_module.apply_prompt_template()

    assert "<evidence_style>" in rendered
    assert "After `web_search`, cite sources with Markdown links" in rendered
    assert "stricter evidence or citation rules" in rendered
    assert "Knowledge Base Sources" not in rendered
    assert "Knowledge Base Output Contract" not in rendered
    assert "Knowledge Base Tree Window Rule" not in rendered


def test_apply_prompt_template_includes_self_authoring_context_for_non_lead_dev_agents(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")

    rendered = prompt_module.apply_prompt_template(agent_name="demo-agent", agent_status="dev")

    assert "<self_authoring>" in rendered
    assert "/mnt/user-data/agents/dev/demo-agent/..." in rendered
    assert "persist that change with `setup_agent`" in rendered
    assert "Do not use `write_file`, `edit_file`, or shell mutations" in rendered


def test_apply_prompt_template_lists_attached_copied_skills(monkeypatch, tmp_path):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )

    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")
    agent_dir = paths.agent_dir("demo-agent", "dev")
    skill_dir = agent_dir / "skills" / "contract-review"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "AGENTS.md").write_text("# Demo Agent\n", encoding="utf-8")
    (agent_dir / "config.yaml").write_text(
        yaml.dump(
            {
                "name": "demo-agent",
                "status": "dev",
                "agents_md_path": "AGENTS.md",
                "skill_refs": [
                    {
                        "name": "contract-review",
                        "source_path": "store/dev/contract-review",
                    }
                ],
            },
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (skill_dir / "SKILL.md").write_text(
        "---\nname: contract-review\ndescription: review contracts with copied workflow\n---\n\n# Contract Review\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(prompt_module, "get_paths", lambda: paths)
    monkeypatch.setattr(
        prompt_module,
        "load_agents_md",
        lambda *args, **kwargs: Path(agent_dir / "AGENTS.md").read_text(encoding="utf-8"),
    )

    rendered = prompt_module.apply_prompt_template(agent_name="demo-agent", agent_status="dev")

    assert "<attached_skills>" in rendered
    assert "contract-review" in rendered
    assert "review contracts with copied workflow" in rendered
    assert "/mnt/user-data/agents/dev/demo-agent/skills/contract-review/SKILL.md" in rendered
    assert "store/dev/contract-review" in rendered
    assert "read that file before substantive analysis" in rendered
    assert "A bare external repo URL is not, by itself, a request for repository research" in rendered
    assert "chat is the default output unless the user explicitly requested a file" in rendered
    assert "Never finish a turn with only presented artifacts" in rendered
