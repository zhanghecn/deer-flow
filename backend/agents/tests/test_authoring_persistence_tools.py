from pathlib import Path

import pytest

from src.config.paths import Paths
from src.tools.builtins.authoring_persistence import (
    promote_skill_directory_to_shared,
    push_agent_directory_to_prod,
    push_skill_directory_to_prod,
    save_agent_directory_to_store,
    save_skill_directory_to_store,
)


def _write_skill(skill_dir: Path, name: str, description: str = "skill") -> None:
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n",
        encoding="utf-8",
    )


def _write_agent(agent_dir: Path, name: str, status: str = "dev", *, skill_source_path: str = "shared/bootstrap") -> None:
    (agent_dir / "skills" / "bootstrap").mkdir(parents=True, exist_ok=True)
    (agent_dir / "AGENTS.md").write_text("You are an agent.", encoding="utf-8")
    (agent_dir / "skills" / "bootstrap" / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n",
        encoding="utf-8",
    )
    (agent_dir / "config.yaml").write_text(
        f"name: {name}\n"
        f"status: {status}\n"
        "description: test agent\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs:\n"
        "  - name: bootstrap\n"
        f"    source_path: {skill_source_path}\n",
        encoding="utf-8",
    )


def test_save_skill_directory_to_store_copies_authoring_skill(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    source_dir = paths.sandbox_authoring_skills_dir("thread-1") / "contract-risk-rating"
    _write_skill(source_dir, "contract-risk-rating", "Contract risk rating")

    target_dir, backup_dir = save_skill_directory_to_store(
        source_dir=source_dir,
        skill_name="contract-risk-rating",
        paths=paths,
    )

    assert backup_dir is None
    assert target_dir == paths.store_dev_skills_dir / "contract-risk-rating"
    assert (target_dir / "SKILL.md").exists()


def test_save_skill_directory_to_store_overwrite_creates_backup(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    source_dir = paths.sandbox_authoring_skills_dir("thread-1") / "contract-risk-rating"
    _write_skill(source_dir, "contract-risk-rating", "Contract risk rating v2")
    existing_target = paths.store_dev_skills_dir / "contract-risk-rating"
    _write_skill(existing_target, "contract-risk-rating", "Contract risk rating v1")

    target_dir, backup_dir = save_skill_directory_to_store(
        source_dir=source_dir,
        skill_name="contract-risk-rating",
        paths=paths,
    )

    assert target_dir == existing_target
    assert backup_dir is not None
    assert (backup_dir / "SKILL.md").exists()


def test_save_agent_directory_to_store_accepts_runtime_agent_copy(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    source_dir = paths.sandbox_agents_dir("thread-1") / "dev" / "contract-review"
    _write_agent(source_dir, "contract-review")

    target_dir, backup_dir = save_agent_directory_to_store(
        source_dir=source_dir,
        agent_name="contract-review",
        paths=paths,
    )

    assert backup_dir is None
    assert target_dir == paths.agent_dir("contract-review", "dev")
    assert (target_dir / "AGENTS.md").exists()
    assert (target_dir / "skills" / "bootstrap" / "SKILL.md").exists()


def test_save_agent_directory_to_store_rejects_invalid_manifest(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    source_dir = paths.sandbox_authoring_agents_dir("thread-1") / "broken-agent"
    source_dir.mkdir(parents=True, exist_ok=True)
    (source_dir / "config.yaml").write_text("name: broken-agent\nstatus: dev\n", encoding="utf-8")

    with pytest.raises(ValueError, match="AGENTS.md"):
        save_agent_directory_to_store(
            source_dir=source_dir,
            agent_name="broken-agent",
            paths=paths,
        )


def test_push_agent_directory_to_prod_updates_status(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    dev_dir = paths.agent_dir("contract-review", "dev")
    _write_agent(dev_dir, "contract-review", status="dev")

    target_dir, backup_dir = push_agent_directory_to_prod("contract-review", paths=paths)

    assert backup_dir is None
    assert target_dir == paths.agent_dir("contract-review", "prod")
    assert "status: prod" in (target_dir / "config.yaml").read_text(encoding="utf-8")


def test_push_skill_directory_to_prod_requires_dev_source(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")

    with pytest.raises(FileNotFoundError, match="store/dev"):
        push_skill_directory_to_prod("missing-skill", paths=paths)


def test_promote_skill_directory_to_shared_copies_prod_skill(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    prod_dir = paths.store_prod_skills_dir / "contract-risk-rating"
    _write_skill(prod_dir, "contract-risk-rating", "Contract risk rating")

    target_dir, backup_dir = promote_skill_directory_to_shared("contract-risk-rating", paths=paths)

    assert backup_dir is None
    assert target_dir == paths.shared_skills_dir / "contract-risk-rating"
    assert (target_dir / "SKILL.md").exists()
