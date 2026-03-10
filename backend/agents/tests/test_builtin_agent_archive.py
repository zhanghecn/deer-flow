import yaml

from src.config import builtin_agents
from src.config.agent_runtime_seed import clear_agent_runtime_seed_cache
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
    clear_agent_runtime_seed_cache()
    monkeypatch.setattr(builtin_agents, "_ENSURED_ARCHIVES", set())

    base_dir = tmp_path / ".openagents"
    skill_dir = base_dir.parent / "skills" / "public" / "bootstrap"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n\nbootstrap\n",
        encoding="utf-8",
    )

    paths = Paths(base_dir=base_dir, skills_dir=base_dir.parent / "skills")
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
    assert config_data["skill_refs"][0]["name"] == "bootstrap"
