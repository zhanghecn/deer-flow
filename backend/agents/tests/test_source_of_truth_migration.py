from pathlib import Path

import pytest
import yaml

from src.config.paths import Paths
from src.config.source_of_truth_migration import migrate_source_of_truth_layout


def _write_skill(skill_dir: Path, *, name: str, description: str, body: str) -> None:
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_dir.joinpath("SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n{body}\n",
        encoding="utf-8",
    )


def _write_agent(agent_dir: Path, *, name: str, status: str, source_path: str) -> None:
    agent_dir.mkdir(parents=True, exist_ok=True)
    agent_dir.joinpath("config.yaml").write_text(
        yaml.dump(
            {
                "name": name,
                "status": status,
                "agents_md_path": "AGENTS.md",
                "skill_refs": [
                    {
                        "name": Path(source_path).name,
                        "source_path": source_path,
                    }
                ],
            },
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    agent_dir.joinpath("AGENTS.md").write_text(f"# {name}\n", encoding="utf-8")


def test_migrate_source_of_truth_layout_copies_legacy_assets_and_rewrites_source_paths(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir)

    _write_skill(
        base_dir / "skills" / "store" / "prod" / "bootstrap",
        name="bootstrap",
        description="bootstrap",
        body="bootstrap",
    )
    _write_skill(
        base_dir / "skills" / "store" / "dev" / "pptx-generator",
        name="pptx-generator",
        description="pptx-generator",
        body="pptx",
    )
    _write_agent(
        base_dir / "agents" / "dev" / "lead_agent",
        name="lead_agent",
        status="dev",
        source_path="store/prod/bootstrap",
    )
    _write_agent(
        base_dir / "agents" / "dev" / "reporter",
        name="reporter",
        status="dev",
        source_path="store/dev/pptx-generator",
    )

    result = migrate_source_of_truth_layout(paths=paths)

    assert result.copied_skills == 2
    assert result.copied_agents == 2
    assert result.rewritten_manifests == 2
    assert paths.system_dir.exists()
    assert paths.custom_dir.exists()
    assert paths.runtime_dir.exists()
    assert (paths.system_skill_dir("bootstrap") / "SKILL.md").exists()
    assert (paths.system_skill_dir("pptx-generator") / "SKILL.md").exists()
    assert (paths.system_agent_dir("lead_agent", "dev") / "config.yaml").exists()
    assert (paths.custom_agent_dir("reporter", "dev") / "config.yaml").exists()

    lead_config = yaml.safe_load((paths.system_agent_dir("lead_agent", "dev") / "config.yaml").read_text(encoding="utf-8"))
    reporter_config = yaml.safe_load((paths.custom_agent_dir("reporter", "dev") / "config.yaml").read_text(encoding="utf-8"))

    assert lead_config["skill_refs"] == [{"name": "bootstrap", "source_path": "system/skills/bootstrap"}]
    assert reporter_config["skill_refs"] == [{"name": "pptx-generator", "source_path": "system/skills/pptx-generator"}]


def test_migrate_source_of_truth_layout_accepts_identical_legacy_duplicates(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir)

    for scope in ("dev", "prod"):
        _write_skill(
            base_dir / "skills" / "store" / scope / "nda-clause-checker",
            name="nda-clause-checker",
            description="nda",
            body="same-body",
        )

    result = migrate_source_of_truth_layout(paths=paths)

    assert result.copied_skills == 1
    assert (paths.system_skill_dir("nda-clause-checker") / "SKILL.md").exists()


def test_migrate_source_of_truth_layout_skips_hidden_legacy_skill_directories(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir)

    _write_skill(
        base_dir / "skills" / "store" / "dev" / ".backups" / "ghost-skill",
        name="ghost-skill",
        description="ghost",
        body="ghost",
    )
    _write_skill(
        base_dir / "skills" / "store" / "dev" / "real-skill",
        name="real-skill",
        description="real",
        body="real",
    )

    result = migrate_source_of_truth_layout(paths=paths)

    assert result.copied_skills == 1
    assert (paths.system_skill_dir("real-skill") / "SKILL.md").exists()
    assert not (paths.system_skills_dir / ".backups").exists()


def test_migrate_source_of_truth_layout_rejects_conflicting_legacy_duplicates(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir)

    _write_skill(
        base_dir / "skills" / "store" / "prod" / "shared-skill",
        name="shared-skill",
        description="shared",
        body="prod",
    )
    _write_skill(
        base_dir / "skills" / "store" / "dev" / "shared-skill",
        name="shared-skill",
        description="shared",
        body="dev",
    )

    with pytest.raises(ValueError, match="conflicting definitions"):
        migrate_source_of_truth_layout(paths=paths)


def test_migrate_source_of_truth_layout_removes_deprecated_guard_fields(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    paths = Paths(base_dir=base_dir, skills_dir=base_dir)
    agent_dir = paths.custom_agent_dir("demo-agent", "dev")
    agent_dir.mkdir(parents=True)
    agent_dir.joinpath("config.yaml").write_text(
        yaml.dump(
            {
                "name": "demo-agent",
                "status": "prod",
                "subagent_defaults": {
                    "general_purpose_enabled": True,
                    "task_guard": {"violation_code": "WRONG_SUBAGENT"},
                },
                "skill_refs": [],
            },
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    agent_dir.joinpath("subagents.yaml").write_text(
        yaml.dump(
            {
                "version": 1,
                "subagents": {
                    "case-researcher": {
                        "description": "Research cases",
                        "system_prompt": "Return concise evidence.",
                        "task_guard": {"violation_code": "BAD_TASK"},
                        "result_guard": {"json_object": True},
                    }
                },
            },
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    result = migrate_source_of_truth_layout(paths=paths)

    assert result.rewritten_manifests == 1
    assert result.rewritten_subagents == 1
    migrated_config = yaml.safe_load(agent_dir.joinpath("config.yaml").read_text(encoding="utf-8"))
    migrated_subagents = yaml.safe_load(agent_dir.joinpath("subagents.yaml").read_text(encoding="utf-8"))

    assert migrated_config["status"] == "dev"
    assert migrated_config["subagent_defaults"] == {"general_purpose_enabled": True}
    case_researcher = migrated_subagents["subagents"]["case-researcher"]
    assert "task_guard" not in case_researcher
    assert "result_guard" not in case_researcher
