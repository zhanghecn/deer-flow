from pathlib import Path

from src.agents.lead_agent import agent as lead_agent_module
from src.config.agents_config import AgentMemoryConfig
from src.config.paths import Paths


class _FakeDBStore:
    def get_agent(self, name: str, status: str):
        raise AssertionError("agent definitions should no longer be read from DB")


def _write_agent(base_dir: Path, name: str, status: str = "dev") -> None:
    agent_dir = base_dir / "agents" / status / name
    (agent_dir / "skills" / "bootstrap").mkdir(parents=True, exist_ok=True)
    (agent_dir / "AGENTS.md").write_text("You are file-backed.", encoding="utf-8")
    (agent_dir / "skills" / "bootstrap" / "SKILL.md").write_text(
        "---\nname: bootstrap\ndescription: bootstrap\n---\n",
        encoding="utf-8",
    )
    (agent_dir / "config.yaml").write_text(
        "name: analyst\n"
        f"status: {status}\n"
        "description: file config\n"
        "model: model-from-file\n"
        "tool_groups:\n"
        "  - web\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs:\n"
        "  - name: bootstrap\n"
        "    source_path: shared/bootstrap\n",
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
        db_store=_FakeDBStore(),
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
            db_store=_FakeDBStore(),
        )
    except ValueError as exc:
        assert "not found in archive" in str(exc)
    else:
        raise AssertionError("expected missing archive to raise")
