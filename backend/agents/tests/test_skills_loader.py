"""Tests for recursive skills loading."""

from pathlib import Path

from src.skills.loader import load_skills


def _write_skill(skill_dir: Path, name: str, description: str) -> None:
    """Write a minimal SKILL.md for tests."""
    skill_dir.mkdir(parents=True, exist_ok=True)
    content = f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n"
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")


def test_load_skills_discovers_openagents_skill_scopes_and_sets_container_paths(tmp_path: Path):
    """Nested skills should be discovered recursively with correct container paths."""
    skills_root = tmp_path / "skills"

    _write_skill(skills_root / "store" / "prod" / "root-skill", "root-skill", "Root skill")
    _write_skill(skills_root / "store" / "prod" / "parent" / "child-skill", "child-skill", "Child skill")
    _write_skill(skills_root / "store" / "dev" / "team" / "helper", "team-helper", "Team helper")
    _write_skill(skills_root / "store" / "prod" / "contracts" / "review", "contract-review", "Contract review")

    skills = load_skills(skills_path=skills_root, use_config=False, enabled_only=False)
    by_name = {skill.name: skill for skill in skills}

    assert {"root-skill", "child-skill", "team-helper", "contract-review"} <= set(by_name)

    root_skill = by_name["root-skill"]
    child_skill = by_name["child-skill"]
    team_skill = by_name["team-helper"]
    review_skill = by_name["contract-review"]

    assert root_skill.skill_path == "root-skill"
    assert root_skill.category == "store/prod"
    assert root_skill.get_container_file_path() == "/mnt/skills/store/prod/root-skill/SKILL.md"

    assert child_skill.skill_path == "parent/child-skill"
    assert child_skill.category == "store/prod"
    assert child_skill.get_container_file_path() == "/mnt/skills/store/prod/parent/child-skill/SKILL.md"

    assert team_skill.skill_path == "team/helper"
    assert team_skill.category == "store/dev"
    assert team_skill.get_container_file_path() == "/mnt/skills/store/dev/team/helper/SKILL.md"

    assert review_skill.skill_path == "contracts/review"
    assert review_skill.category == "store/prod"
    assert review_skill.get_container_file_path() == "/mnt/skills/store/prod/contracts/review/SKILL.md"
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
