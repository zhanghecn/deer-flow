from pathlib import Path

import pytest

from src.config.agent_materialization import materialize_agent_skills, resolve_skill_refs
from src.config.agents_config import AgentSkillRef
from src.config.paths import Paths


def _write_skill(base_dir: Path, scope: str, relative_path: str, name: str) -> None:
    skill_dir = base_dir / "skills" / Path(scope) / Path(relative_path)
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name} description\n---\n\n# {name}\n",
        encoding="utf-8",
    )


def test_agent_skill_ref_derives_agent_materialized_path_from_shared_source():
    ref = AgentSkillRef(name="bootstrap", source_path="shared/bootstrap")

    assert ref.category == "shared"
    assert ref.materialized_path == "skills/bootstrap"


def test_agent_skill_ref_derives_agent_materialized_path_from_store_prod_source():
    ref = AgentSkillRef(name="contract-review", source_path="store/prod/contracts/review")

    assert ref.category == "store/prod"
    assert ref.materialized_path == "skills/contracts/review"


def test_resolve_skill_refs_prefers_shared_over_store_dev_for_name_only_lookup(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "shared", "bootstrap", "bootstrap")
    _write_skill(base_dir, "store/dev", "bootstrap", "bootstrap")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    skills = resolve_skill_refs(["bootstrap"], paths=paths)

    assert len(skills) == 1
    assert skills[0].category == "shared"


def test_materialize_agent_skills_copies_nested_store_prod_skill_into_agent_private_tree(tmp_path: Path):
    base_dir = tmp_path / ".openagents"
    _write_skill(base_dir, "store/prod", "contracts/review", "contract-review")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")
    materialized_root = base_dir / "agents" / "dev" / "reviewer" / "skills"

    refs = materialize_agent_skills(
        skills_dir=materialized_root,
        skill_names=["contract-review"],
        paths=paths,
    )

    assert refs == [
        AgentSkillRef(
            name="contract-review",
            category="store/prod",
            source_path="store/prod/contracts/review",
            materialized_path="skills/contracts/review",
        )
    ]
    assert (materialized_root / "contracts" / "review" / "SKILL.md").exists()


def test_agent_skill_ref_rejects_unsafe_source_path():
    with pytest.raises(ValueError, match="safe relative path"):
        AgentSkillRef(name="bad", source_path="../escape")
