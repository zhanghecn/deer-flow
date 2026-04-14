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
    assert 'Do not end an execution turn with progress-only text such as "next I will ..."' in rendered


def test_apply_prompt_template_keeps_knowledge_base_detail_out_of_base_prompt(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")

    rendered = prompt_module.apply_prompt_template()

    assert "<evidence_style>" in rendered
    assert "Cite sources after `web_search`" in rendered
    assert "stricter evidence rules" in rendered
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
    assert "for future runs" in rendered
    assert "read your current runtime copy" in rendered.lower()
    assert "/mnt/user-data/agents/dev/demo-agent/config.yaml" in rendered
    assert "omit `agents_md` and `description`" in rendered
    assert "Do not read `AGENTS.md` just to re-send it unchanged" in rendered
    assert "`setup_agent(skills=...)` replaces the target skill set" in rendered
    assert "edited skill as `{name, content: \"<full updated SKILL.md>\"}`" in rendered
    assert "omit `skills`" in rendered


def test_apply_prompt_template_documents_shared_tmp_alias(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")

    rendered = prompt_module.apply_prompt_template()

    assert "Shared temporary scratch lives under `/mnt/user-data/tmp`" in rendered
    assert "also available at `/tmp`" in rendered


def test_apply_prompt_template_lists_attached_copied_skills(monkeypatch, tmp_path):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )

    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir)
    agent_dir = paths.custom_agent_dir("demo-agent", "dev")
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
                        "source_path": "system/skills/contract-review",
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
    assert "Read `/mnt/user-data/agents/dev/demo-agent/skills/contract-review/SKILL.md`." in rendered
    assert "Source `system/skills/contract-review`." in rendered
    assert "If the copied skill requires other files, read them before substantive work." in rendered
    assert "A bare external repo URL is not, by itself, a request for repository research" in rendered
    assert "If the skill treats chat as the default output, stay in chat unless the user or the skill explicitly requires a file." in rendered
    assert "If you create a file, still send a substantive visible answer in the same turn." in rendered


def test_apply_prompt_template_keeps_runtime_prompt_compact(monkeypatch):
    monkeypatch.setattr(
        prompt_module,
        "ensure_builtin_agent_archive",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(prompt_module, "load_agents_md", lambda *args, **kwargs: "")
    rendered = prompt_module.apply_prompt_template(agent_name="lead_agent", agent_status="dev")

    # The default lead_agent prompt is paid on every turn, so keep a hard budget.
    assert len(rendered) < 16500
