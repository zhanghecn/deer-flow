from pathlib import Path, PurePosixPath
import subprocess

import pytest

from src.config.paths import Paths
from src.tools.builtins.authoring_persistence import (
    RegistrySkippedSkill,
    install_registry_skill_to_store,
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


def _write_agent(agent_dir: Path, name: str, status: str = "dev", *, skill_source_path: str = "store/dev/bootstrap") -> None:
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


def test_install_registry_skill_to_store_downloads_into_dev_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    state: dict[str, str] = {}

    def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        home = str((kwargs.get("env") or {}).get("HOME"))
        state["home"] = home
        state["npm_config_yes"] = str((kwargs.get("env") or {}).get("npm_config_yes"))
        state["args"] = " ".join(args)
        _write_skill(Path(home) / ".agents" / "skills" / "copywriting", "copywriting", "Marketing copywriting")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr("src.tools.builtins.authoring_persistence.subprocess.run", fake_run)

    result = install_registry_skill_to_store(
        source="coreyhaines31/marketingskills@copywriting",
        paths=paths,
    )

    assert [skill.name for skill in result.installed_skills] == ["copywriting"]
    assert [skill.relative_path for skill in result.installed_skills] == [PurePosixPath("copywriting")]
    assert [skill.target_dir for skill in result.installed_skills] == [paths.store_dev_skills_dir / "copywriting"]
    assert result.skipped_skills == ()
    assert (paths.store_dev_skills_dir / "copywriting" / "SKILL.md").exists()
    assert state["home"]
    assert state["npm_config_yes"] == "true"
    assert state["args"].startswith("npx --yes skills add ")
    assert not Path(state["home"]).exists()


def test_install_registry_skill_to_store_rejects_existing_scope_conflicts(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    _write_skill(paths.store_prod_skills_dir / "copywriting", "copywriting")

    with pytest.raises(ValueError, match="store/prod"):
        install_registry_skill_to_store(
            source="coreyhaines31/marketingskills@copywriting",
            paths=paths,
        )


def test_install_registry_skill_to_store_reports_meaningful_cli_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")

    cli_output = """
\x1b[38;5;250m███████╗██╗  ██╗██╗██╗     ██╗     ███████╗\x1b[0m
│
■  No matching skills found for: playwright-best-practices
npm notice
npm notice New major version of npm available!
"""

    def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(
            args=args,
            returncode=1,
            stdout=cli_output,
            stderr="",
        )

    monkeypatch.setattr("src.tools.builtins.authoring_persistence.subprocess.run", fake_run)

    with pytest.raises(RuntimeError, match="No matching skills found for: playwright-best-practices"):
        install_registry_skill_to_store(
            source="vercel-labs/agent-skills@playwright-best-practices",
            paths=paths,
        )


def test_install_registry_skill_to_store_installs_all_skills_from_repo_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")

    def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        home = Path(str((kwargs.get("env") or {}).get("HOME")))
        _write_skill(home / ".agents" / "skills" / "alpha-skill", "alpha-skill", "Alpha")
        _write_skill(home / ".agents" / "skills" / "beta-skill", "beta-skill", "Beta")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr("src.tools.builtins.authoring_persistence.subprocess.run", fake_run)

    result = install_registry_skill_to_store(
        source="https://github.com/MiniMax-AI/skills.git",
        paths=paths,
    )

    assert [skill.name for skill in result.installed_skills] == ["alpha-skill", "beta-skill"]
    assert [skill.relative_path.as_posix() for skill in result.installed_skills] == ["alpha-skill", "beta-skill"]
    assert result.skipped_skills == ()
    assert (paths.store_dev_skills_dir / "alpha-skill" / "SKILL.md").exists()
    assert (paths.store_dev_skills_dir / "beta-skill" / "SKILL.md").exists()


def test_install_registry_skill_to_store_skips_existing_repo_root_skills(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    _write_skill(paths.store_prod_skills_dir / "alpha-skill", "alpha-skill", "Existing alpha")

    def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        home = Path(str((kwargs.get("env") or {}).get("HOME")))
        _write_skill(home / ".agents" / "skills" / "alpha-skill", "alpha-skill", "Alpha")
        _write_skill(home / ".agents" / "skills" / "beta-skill", "beta-skill", "Beta")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr("src.tools.builtins.authoring_persistence.subprocess.run", fake_run)

    result = install_registry_skill_to_store(
        source="https://github.com/MiniMax-AI/skills.git",
        paths=paths,
    )

    assert [skill.name for skill in result.installed_skills] == ["beta-skill"]
    assert result.skipped_skills == (
        RegistrySkippedSkill(relative_path=PurePosixPath("alpha-skill"), existing_scopes=("store/prod",)),
    )
    assert not (paths.store_dev_skills_dir / "alpha-skill").exists()
    assert (paths.store_dev_skills_dir / "beta-skill" / "SKILL.md").exists()


def test_save_agent_directory_to_store_accepts_runtime_agent_copy(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    source_dir = paths.sandbox_agents_dir("thread-1") / "dev" / "contract-review"
    _write_skill(paths.store_dev_skills_dir / "bootstrap", "bootstrap")
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
    _write_skill(paths.store_prod_skills_dir / "bootstrap", "bootstrap")
    _write_agent(dev_dir, "contract-review", status="dev", skill_source_path="store/prod/bootstrap")

    target_dir, backup_dir = push_agent_directory_to_prod("contract-review", paths=paths)

    assert backup_dir is None
    assert target_dir == paths.agent_dir("contract-review", "prod")
    assert "status: prod" in (target_dir / "config.yaml").read_text(encoding="utf-8")


def test_push_agent_directory_to_prod_rejects_store_dev_skill_refs(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    dev_dir = paths.agent_dir("contract-review", "dev")
    _write_skill(paths.store_dev_skills_dir / "bootstrap", "bootstrap")
    _write_agent(dev_dir, "contract-review", status="dev", skill_source_path="store/dev/bootstrap")

    with pytest.raises(ValueError, match="store/prod"):
        push_agent_directory_to_prod("contract-review", paths=paths)


def test_push_skill_directory_to_prod_requires_dev_source(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")

    with pytest.raises(FileNotFoundError, match="store/dev"):
        push_skill_directory_to_prod("missing-skill", paths=paths)
