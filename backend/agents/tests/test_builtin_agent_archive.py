from pathlib import Path

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
    archived_skill_dir = base_dir / "system" / "skills" / "bootstrap"
    archived_skill_dir.mkdir(parents=True, exist_ok=True)
    (archived_skill_dir / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n\nbootstrap\n",
        encoding="utf-8",
    )

    paths = Paths(base_dir=base_dir, skills_dir=base_dir)
    agent_dir = paths.system_agent_dir("lead_agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "config.yaml").write_text(
        "name: lead_agent\nstatus: dev\nagents_md_path: AGENTS.md\nskills_mode: shared_all\nskill_refs: []\n",
        encoding="utf-8",
    )

    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="dev", paths=paths)

    system_agent_dir = paths.system_agent_dir("lead_agent", "dev")
    config_data = yaml.safe_load((system_agent_dir / "config.yaml").read_text(encoding="utf-8"))
    assert "skills_mode" not in config_data
    assert config_data["skill_refs"]
    assert config_data["skill_refs"][0] == {
        "name": "bootstrap",
        "source_path": "system/skills/bootstrap",
    }
    assert (paths.system_skill_dir("bootstrap") / "SKILL.md").read_text(encoding="utf-8").strip().endswith("bootstrap")


def test_ensure_builtin_agent_archive_preserves_archived_agents_md(tmp_path, monkeypatch):
    monkeypatch.setattr(builtin_agents, "_ENSURED_ARCHIVES", set())

    base_dir = tmp_path / ".openagents"
    archived_skill_dir = base_dir / "system" / "skills" / "bootstrap"
    archived_skill_dir.mkdir(parents=True, exist_ok=True)
    (archived_skill_dir / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n\nbootstrap\n",
        encoding="utf-8",
    )

    paths = Paths(base_dir=base_dir, skills_dir=base_dir)
    legacy_agent_dir = paths.system_agent_dir("lead_agent", "dev")
    legacy_agent_dir.mkdir(parents=True, exist_ok=True)
    customized_agents_md = "# Lead Agent\n\nCustom archived prompt.\n"
    (legacy_agent_dir / "AGENTS.md").write_text(customized_agents_md, encoding="utf-8")

    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="dev", paths=paths)

    assert (paths.system_agent_dir("lead_agent", "dev") / "AGENTS.md").read_text(encoding="utf-8") == customized_agents_md


def test_ensure_builtin_agent_archive_preserves_explicit_system_skill_refs_when_names_conflict(tmp_path, monkeypatch):
    monkeypatch.setattr(builtin_agents, "_ENSURED_ARCHIVES", set())

    base_dir = tmp_path / ".openagents"
    system_skill_dir = base_dir / "system" / "skills" / "frontend-design"
    system_skill_dir.mkdir(parents=True, exist_ok=True)
    (system_skill_dir / "SKILL.md").write_text(
        "---\nname: frontend-design\ndescription: system frontend design\n---\n\nsystem\n",
        encoding="utf-8",
    )
    custom_skill_dir = base_dir / "custom" / "skills" / "frontend-design"
    custom_skill_dir.mkdir(parents=True, exist_ok=True)
    (custom_skill_dir / "SKILL.md").write_text(
        "---\nname: frontend-design\ndescription: custom frontend design\n---\n\ncustom\n",
        encoding="utf-8",
    )

    paths = Paths(base_dir=base_dir, skills_dir=base_dir)
    agent_dir = paths.system_agent_dir("lead_agent", "dev")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "config.yaml").write_text(
        "name: lead_agent\n"
        "status: dev\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs:\n"
        "  - name: frontend-design\n"
        "    source_path: system/skills/frontend-design\n",
        encoding="utf-8",
    )

    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="dev", paths=paths)

    system_agent_dir = paths.system_agent_dir("lead_agent", "dev")
    config_data = yaml.safe_load((system_agent_dir / "config.yaml").read_text(encoding="utf-8"))
    assert config_data["skill_refs"] == [
        {
            "name": "frontend-design",
            "source_path": "system/skills/frontend-design",
        }
    ]
    assert (system_agent_dir / "skills" / "frontend-design" / "SKILL.md").read_text(encoding="utf-8").strip().endswith("system")


def test_ensure_builtin_agent_archive_rewrites_legacy_prod_manifest_to_canonical_system_skills(tmp_path, monkeypatch):
    monkeypatch.setattr(builtin_agents, "_ENSURED_ARCHIVES", set())

    base_dir = tmp_path / ".openagents"
    prod_skill_dir = base_dir / "system" / "skills" / "bootstrap"
    prod_skill_dir.mkdir(parents=True, exist_ok=True)
    (prod_skill_dir / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n\nbootstrap\n",
        encoding="utf-8",
    )
    dev_skill_dir = base_dir / "system" / "skills" / "android-native-dev"
    dev_skill_dir.mkdir(parents=True, exist_ok=True)
    (dev_skill_dir / "SKILL.md").write_text(
        "---\nname: android-native-dev\ndescription: android native dev\n---\n\nandroid\n",
        encoding="utf-8",
    )

    paths = Paths(base_dir=base_dir, skills_dir=base_dir)
    agent_dir = paths.system_agent_dir("lead_agent", "prod")
    agent_dir.mkdir(parents=True, exist_ok=True)
    (agent_dir / "config.yaml").write_text(
        "name: lead_agent\n"
        "status: prod\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs:\n"
        "  - name: bootstrap\n"
        "    source_path: store/prod/bootstrap\n"
        "  - name: android-native-dev\n"
        "    source_path: store/dev/android-native-dev\n",
        encoding="utf-8",
    )

    builtin_agents.ensure_builtin_agent_archive("lead_agent", status="prod", paths=paths)

    system_agent_dir = paths.system_agent_dir("lead_agent", "prod")
    config_data = yaml.safe_load((system_agent_dir / "config.yaml").read_text(encoding="utf-8"))
    assert config_data["skill_refs"] == [
        {
            "name": "bootstrap",
            "source_path": "system/skills/bootstrap",
        },
        {
            "name": "android-native-dev",
            "source_path": "system/skills/android-native-dev",
        }
    ]
    assert (system_agent_dir / "skills" / "bootstrap" / "SKILL.md").read_text(encoding="utf-8").strip().endswith("bootstrap")
    assert (system_agent_dir / "skills" / "android-native-dev" / "SKILL.md").read_text(encoding="utf-8").strip().endswith("android")


def test_builtin_lead_agent_prompt_keeps_skill_discovery_local_first():
    repo_root = Path(__file__).resolve().parents[3]
    agents_md = (repo_root / "backend/agents/src/agents/lead_agent/AGENTS.md").read_text(encoding="utf-8")

    assert "find-skills" in agents_md
    assert "/mnt/skills/system/skills" in agents_md
    assert "/mnt/skills/custom/skills" in agents_md
    assert "Skill discovery is local-first" in agents_md


def test_system_lead_agent_prod_manifest_keeps_default_skill_set_in_sync_with_dev():
    repo_root = Path(__file__).resolve().parents[3]
    dev_config = yaml.safe_load((repo_root / ".openagents/system/agents/dev/lead_agent/config.yaml").read_text(encoding="utf-8"))
    prod_config = yaml.safe_load((repo_root / ".openagents/system/agents/prod/lead_agent/config.yaml").read_text(encoding="utf-8"))

    dev_skill_refs = dev_config["skill_refs"]
    prod_skill_refs = prod_config["skill_refs"]

    assert [ref["source_path"] for ref in prod_skill_refs] == [ref["source_path"] for ref in dev_skill_refs]


def test_system_lead_agent_manifests_do_not_pin_vision_only_tools():
    repo_root = Path(__file__).resolve().parents[3]
    dev_config = yaml.safe_load((repo_root / ".openagents/system/agents/dev/lead_agent/config.yaml").read_text(encoding="utf-8"))
    prod_config = yaml.safe_load((repo_root / ".openagents/system/agents/prod/lead_agent/config.yaml").read_text(encoding="utf-8"))

    # Built-in lead_agent should inherit the default runtime tool surface. If
    # the archive pins an explicit main-tool allowlist, newly added configured
    # tools silently disappear from prod until someone edits the manifest again.
    assert "tool_names" not in dev_config
    assert "tool_names" not in prod_config
    assert "tool_groups" not in dev_config
    assert "tool_groups" not in prod_config
