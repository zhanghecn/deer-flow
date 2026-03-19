import yaml

from src.config import builtin_agents
from src.config.paths import Paths


def test_ensure_builtin_agent_archive_is_cached_per_status(monkeypatch):
    calls: list[str] = []

    monkeypatch.setattr(builtin_agents, "_ENSURED_ARCHIVES", set())
    monkeypatch.setattr(
        builtin_agents,
        "_ensure_lead_agent_archive_for_status",
        lambda *, status, paths: calls.append(status),
    )

    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="dev", paths=object())
    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="dev", paths=object())
    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="prod", paths=object())

    assert calls == ["dev", "prod"]


def test_ensure_builtin_agent_archive_rewrites_legacy_skills_mode(tmp_path, monkeypatch):
    monkeypatch.setattr(builtin_agents, "_ENSURED_ARCHIVES", set())

    base_dir = tmp_path / ".openagents"
    shared_skill_dir = base_dir / "skills" / "shared" / "bootstrap"
    shared_skill_dir.mkdir(parents=True, exist_ok=True)
    (shared_skill_dir / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n\nbootstrap\n",
        encoding="utf-8",
    )

    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")
    agent_dir = paths.agent_dir("lead_agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "config.yaml").write_text(
        "name: lead_agent\nstatus: dev\nagents_md_path: AGENTS.md\nskills_mode: shared_all\nskill_refs: []\n",
        encoding="utf-8",
    )

    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="dev", paths=paths)

    config_data = yaml.safe_load((agent_dir / "config.yaml").read_text(encoding="utf-8"))
    assert "skills_mode" not in config_data
    assert config_data["skill_refs"]
    assert config_data["skill_refs"][0] == {
        "name": "bootstrap",
        "source_path": "shared/bootstrap",
    }
    assert (paths.shared_skills_dir / "bootstrap" / "SKILL.md").read_text(encoding="utf-8").strip().endswith("bootstrap")


def test_ensure_builtin_agent_archive_preserves_archived_agents_md(tmp_path, monkeypatch):
    monkeypatch.setattr(builtin_agents, "_ENSURED_ARCHIVES", set())

    base_dir = tmp_path / ".openagents"
    shared_skill_dir = base_dir / "skills" / "shared" / "bootstrap"
    shared_skill_dir.mkdir(parents=True, exist_ok=True)
    (shared_skill_dir / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n\nbootstrap\n",
        encoding="utf-8",
    )

    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")
    agent_dir = paths.agent_dir("lead_agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    customized_agents_md = "# Lead Agent\n\nCustom archived prompt.\n"
    (agent_dir / "AGENTS.md").write_text(customized_agents_md, encoding="utf-8")

    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="dev", paths=paths)

    assert (agent_dir / "AGENTS.md").read_text(encoding="utf-8") == customized_agents_md


def test_ensure_builtin_agent_archive_preserves_explicit_shared_skill_refs_when_names_conflict(tmp_path, monkeypatch):
    monkeypatch.setattr(builtin_agents, "_ENSURED_ARCHIVES", set())

    base_dir = tmp_path / ".openagents"
    shared_skill_dir = base_dir / "skills" / "shared" / "frontend-design"
    shared_skill_dir.mkdir(parents=True, exist_ok=True)
    (shared_skill_dir / "SKILL.md").write_text(
        "---\nname: frontend-design\ndescription: shared frontend design\n---\n\nshared\n",
        encoding="utf-8",
    )
    dev_skill_dir = base_dir / "skills" / "store" / "dev" / "frontend-design"
    dev_skill_dir.mkdir(parents=True, exist_ok=True)
    (dev_skill_dir / "SKILL.md").write_text(
        "---\nname: frontend-design\ndescription: dev frontend design\n---\n\ndev\n",
        encoding="utf-8",
    )

    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")
    agent_dir = paths.agent_dir("lead_agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "config.yaml").write_text(
        "name: lead_agent\n"
        "status: dev\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs:\n"
        "  - name: frontend-design\n"
        "    source_path: shared/frontend-design\n",
        encoding="utf-8",
    )

    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="dev", paths=paths)

    config_data = yaml.safe_load((agent_dir / "config.yaml").read_text(encoding="utf-8"))
    assert config_data["skill_refs"] == [
        {
            "name": "frontend-design",
            "source_path": "shared/frontend-design",
        }
    ]
    assert (agent_dir / "skills" / "frontend-design" / "SKILL.md").read_text(encoding="utf-8").strip().endswith("shared")
