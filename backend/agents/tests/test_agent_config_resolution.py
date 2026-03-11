from pathlib import Path

from src.agents.lead_agent import agent as lead_agent_module
from src.config.agents_config import AgentMemoryConfig
from src.config.paths import Paths


def _write_agent(base_dir: Path, name: str, status: str = "dev") -> None:
    agent_dir = base_dir / "agents" / status / name
    (agent_dir / "skills" / "bootstrap").mkdir(parents=True, exist_ok=True)
    (agent_dir / "AGENTS.md").write_text("You are file-backed.", encoding="utf-8")
    (agent_dir / "skills" / "bootstrap" / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n",
        encoding="utf-8",
    )
    (agent_dir / "config.yaml").write_text(
        f"name: analyst\nstatus: {status}\ndescription: file config\nmodel: model-from-file\ntool_groups:\n  - web\nagents_md_path: AGENTS.md\nskill_refs:\n  - name: bootstrap\n    source_path: shared/bootstrap\n",
        encoding="utf-8",
    )


def test_load_agent_runtime_config_prefers_filesystem_archive(monkeypatch, tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_agent(base_dir, "analyst")
    paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")

    monkeypatch.setattr(lead_agent_module, "get_paths", lambda: paths)

    resolved = lead_agent_module._load_agent_runtime_config(
        agent_name="analyst",
        agent_status="dev",
    )

    assert resolved is not None
    assert resolved.name == "analyst"
    assert resolved.model == "model-from-file"
    assert resolved.tool_groups == ["web"]
    assert resolved.memory == AgentMemoryConfig()


def test_load_agent_runtime_config_raises_when_archive_missing(monkeypatch, tmp_path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    monkeypatch.setattr(lead_agent_module, "get_paths", lambda: paths)

    try:
        lead_agent_module._load_agent_runtime_config(
            agent_name="missing-agent",
            agent_status="dev",
        )
    except ValueError as exc:
        assert "not found in archive" in str(exc)
    else:
        raise AssertionError("expected missing archive to raise")
