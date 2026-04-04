from pathlib import Path

from src.config.agent_materialization import validate_skill_refs_for_status
from src.config.agents_config import AgentSkillRef
from src.config.paths import Paths


def _write_skill(base_dir: Path, scope: str, relative_path: str, name: str) -> None:
    skill_dir = base_dir / "skills" / Path(scope) / Path(relative_path)
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name} description\n---\n\n# {name}\n",
        encoding="utf-8",
    )


def test_validate_skill_refs_allows_explicit_prod_source_path_when_name_conflicts(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/prod", "frontend-design", "frontend-design")
    _write_skill(base_dir, "store/dev", "frontend-design", "frontend-design")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    validate_skill_refs_for_status(
        [
            AgentSkillRef(
                name="frontend-design",
                source_path="store/prod/frontend-design",
            )
        ],
        target_status="dev",
        paths=paths,
    )


def test_validate_skill_refs_allows_system_and_custom_skill_sources_for_prod_agents(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    system_skill_dir = base_dir / "system" / "skills" / "bootstrap"
    system_skill_dir.mkdir(parents=True, exist_ok=True)
    (system_skill_dir / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap description\n---\n\n# bootstrap\n",
        encoding="utf-8",
    )
    custom_skill_dir = base_dir / "custom" / "skills" / "pptx-generator"
    custom_skill_dir.mkdir(parents=True, exist_ok=True)
    (custom_skill_dir / "SKILL.md").write_text(
        "---\nname: pptx-generator\ndescription: pptx-generator description\n---\n\n# pptx-generator\n",
        encoding="utf-8",
    )
    paths = Paths(base_dir=base_dir, skills_dir=base_dir)

    validate_skill_refs_for_status(
        [
            AgentSkillRef(name="bootstrap", source_path="system/skills/bootstrap"),
            AgentSkillRef(name="pptx-generator", source_path="custom/skills/pptx-generator"),
        ],
        target_status="prod",
        paths=paths,
    )
