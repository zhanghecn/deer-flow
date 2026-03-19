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


def test_validate_skill_refs_allows_explicit_shared_source_path_when_name_conflicts(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "shared", "frontend-design", "frontend-design")
    _write_skill(base_dir, "store/dev", "frontend-design", "frontend-design")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    validate_skill_refs_for_status(
        [
            AgentSkillRef(
                name="frontend-design",
                source_path="shared/frontend-design",
            )
        ],
        target_status="dev",
        paths=paths,
        allow_shared=True,
    )
