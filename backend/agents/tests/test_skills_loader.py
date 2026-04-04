"""Tests for recursive skills loading."""

from pathlib import Path

from src.skills.loader import load_skills


def _write_skill(skill_dir: Path, name: str, description: str) -> None:
    """Write a minimal SKILL.md for tests."""

    skill_dir.mkdir(parents=True, exist_ok=True)
    content = f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n"
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")


def test_load_skills_discovers_system_and_custom_authored_roots(tmp_path: Path):
    base_dir = tmp_path / ".openagents"

    _write_skill(base_dir / "system" / "skills" / "bootstrap", "bootstrap", "Bootstrap skill")
    _write_skill(base_dir / "custom" / "skills" / "pptx-generator", "pptx-generator", "PPTX generator")
    _write_skill(base_dir / "custom" / "skills" / "office" / "docx", "minimax-docx", "DOCX generator")

    skills = load_skills(skills_path=base_dir, use_config=False, enabled_only=False)
    by_name = {skill.name: skill for skill in skills}

    assert {"bootstrap", "pptx-generator", "minimax-docx"} <= set(by_name)

    bootstrap = by_name["bootstrap"]
    pptx = by_name["pptx-generator"]
    docx = by_name["minimax-docx"]

    assert bootstrap.category == "system"
    assert bootstrap.skill_path == "bootstrap"
    assert bootstrap.source_path == "system/skills/bootstrap"
    assert bootstrap.get_container_file_path() == "/mnt/skills/system/skills/bootstrap/SKILL.md"

    assert pptx.category == "custom"
    assert pptx.skill_path == "pptx-generator"
    assert pptx.source_path == "custom/skills/pptx-generator"
    assert pptx.get_container_file_path() == "/mnt/skills/custom/skills/pptx-generator/SKILL.md"

    assert docx.category == "custom"
    assert docx.skill_path == "office/docx"
    assert docx.source_path == "custom/skills/office/docx"
    assert docx.get_container_file_path() == "/mnt/skills/custom/skills/office/docx/SKILL.md"


def test_load_skills_accepts_legacy_skills_root_argument_during_layout_migration(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    legacy_skills_root = base_dir / "skills"

    _write_skill(base_dir / "system" / "skills" / "bootstrap", "bootstrap", "Bootstrap skill")
    _write_skill(base_dir / "custom" / "skills" / "pptx-generator", "pptx-generator", "PPTX generator")

    skills = load_skills(skills_path=legacy_skills_root, use_config=False, enabled_only=False)

    assert {skill.name for skill in skills} == {"bootstrap", "pptx-generator"}


def test_load_skills_discovers_legacy_store_scopes_during_migration(tmp_path: Path):
    skills_root = tmp_path / "skills"

    _write_skill(skills_root / "store" / "prod" / "root-skill", "root-skill", "Root skill")
    _write_skill(skills_root / "store" / "prod" / "parent" / "child-skill", "child-skill", "Child skill")
    _write_skill(skills_root / "store" / "dev" / "team" / "helper", "team-helper", "Team helper")

    skills = load_skills(skills_path=skills_root, use_config=False, enabled_only=False)
    by_name = {skill.name: skill for skill in skills}

    assert {"root-skill", "child-skill", "team-helper"} <= set(by_name)

    root_skill = by_name["root-skill"]
    child_skill = by_name["child-skill"]
    team_skill = by_name["team-helper"]

    assert root_skill.category == "store/prod"
    assert root_skill.source_path == "store/prod/root-skill"
    assert root_skill.get_container_file_path() == "/mnt/skills/store/prod/root-skill/SKILL.md"

    assert child_skill.category == "store/prod"
    assert child_skill.source_path == "store/prod/parent/child-skill"
    assert child_skill.get_container_file_path() == "/mnt/skills/store/prod/parent/child-skill/SKILL.md"

    assert team_skill.category == "store/dev"
    assert team_skill.source_path == "store/dev/team/helper"
    assert team_skill.get_container_file_path() == "/mnt/skills/store/dev/team/helper/SKILL.md"


def test_load_skills_skips_hidden_directories(tmp_path: Path):
    """Hidden directories should be excluded from recursive discovery."""

    skills_root = tmp_path / "skills"

    _write_skill(skills_root / "store" / "prod" / "visible" / "ok-skill", "ok-skill", "Visible skill")
    _write_skill(
        skills_root / "store" / "prod" / "visible" / ".hidden" / "secret-skill",
        "secret-skill",
        "Hidden skill",
    )

    skills = load_skills(skills_path=skills_root, use_config=False, enabled_only=False)
    names = {skill.name for skill in skills}

    assert "ok-skill" in names
    assert "secret-skill" not in names
