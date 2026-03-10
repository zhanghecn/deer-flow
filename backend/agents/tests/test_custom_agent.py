"""Tests for archived agent definitions and CRUD APIs."""

from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient


def _make_paths(base_dir: Path):
    from src.config.paths import Paths

    return Paths(base_dir=base_dir, skills_dir=base_dir.parent / "skills")


def _write_agent(
    base_dir: Path,
    name: str,
    config: dict,
    *,
    status: str = "dev",
    agents_md: str = "You are helpful.",
) -> None:
    agent_dir = base_dir / "agents" / status / name
    agent_dir.mkdir(parents=True, exist_ok=True)

    config_copy = dict(config)
    config_copy.setdefault("name", name)
    config_copy.setdefault("status", status)

    with open(agent_dir / "config.yaml", "w", encoding="utf-8") as handle:
        yaml.dump(config_copy, handle)

    (agent_dir / "AGENTS.md").write_text(agents_md, encoding="utf-8")


def _write_shared_skill(
    base_dir: Path,
    skill_name: str,
    *,
    category: str = "public",
    relative_path: str | None = None,
) -> None:
    skills_root = _make_paths(base_dir).skills_dir
    skill_dir = skills_root / category / Path(relative_path or skill_name)
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_dir.joinpath("SKILL.md").write_text(
        f"---\nname: {skill_name}\ndescription: {skill_name} description\n---\n\n# {skill_name}\n",
        encoding="utf-8",
    )


class TestPaths:
    def test_agents_dir(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.agents_dir == tmp_path / "agents"

    def test_agent_dir(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.agent_dir("code-reviewer") == tmp_path / "agents" / "dev" / "code-reviewer"
        assert paths.agent_dir("code-reviewer", "prod") == tmp_path / "agents" / "prod" / "code-reviewer"

    def test_user_agent_memory_file(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.user_agent_memory_file("user-1", "code-reviewer") == (
            tmp_path / "users" / "user-1" / "agents" / "dev" / "code-reviewer" / "memory.json"
        )

    def test_user_md_file(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.user_md_file == tmp_path / "USER.md"

    def test_user_agent_memory_path_respects_status(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.user_agent_memory_file("user-1", "my-agent", "dev") == (
            tmp_path / "users" / "user-1" / "agents" / "dev" / "my-agent" / "memory.json"
        )
        assert paths.user_agent_memory_file("user-1", "my-agent", "prod") == (
            tmp_path / "users" / "user-1" / "agents" / "prod" / "my-agent" / "memory.json"
        )


class TestAgentConfig:
    def test_minimal_config(self):
        from src.config.agents_config import AgentConfig

        cfg = AgentConfig(name="my-agent")
        assert cfg.name == "my-agent"
        assert cfg.description == ""
        assert cfg.model is None
        assert cfg.tool_groups is None

    def test_full_config(self):
        from src.config.agents_config import AgentConfig

        cfg = AgentConfig(
            name="code-reviewer",
            description="Specialized for code review",
            model="deepseek-v3",
            tool_groups=["web"],
        )
        assert cfg.name == "code-reviewer"
        assert cfg.model == "deepseek-v3"
        assert cfg.tool_groups == ["web"]

    def test_config_with_skill_refs(self):
        from src.config.agents_config import AgentConfig

        cfg = AgentConfig(
            name="industry-analyst",
            skill_refs=[
                {
                    "name": "data-analysis",
                    "category": "public",
                    "source_path": "public/data-analysis",
                    "materialized_path": "skills/data-analysis",
                }
            ],
        )
        assert cfg.skill_refs[0].name == "data-analysis"

    def test_config_with_memory_policy(self):
        from src.config.agents_config import AgentConfig

        cfg = AgentConfig(
            name="industry-analyst",
            memory={
                "enabled": True,
                "model_name": "memory-model",
                "max_facts": 50,
            },
        )
        assert cfg.memory.enabled is True
        assert cfg.memory.model_name == "memory-model"
        assert cfg.memory.max_facts == 50

    def test_config_rejects_enabled_memory_without_model(self):
        from src.config.agents_config import AgentConfig

        with pytest.raises(ValueError, match="memory.model_name"):
            AgentConfig(name="industry-analyst", memory={"enabled": True})

    def test_config_rejects_scope_field(self):
        from src.config.agents_config import AgentConfig

        with pytest.raises(ValueError, match="scope"):
            AgentConfig(
                name="industry-analyst",
                memory={"enabled": True, "model_name": "memory-model", "scope": "user"},
            )


class TestLoadAgentConfig:
    def test_load_valid_config(self, tmp_path):
        _write_agent(
            tmp_path,
            "code-reviewer",
            {"name": "code-reviewer", "description": "Code review agent", "model": "deepseek-v3"},
        )

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            cfg = load_agent_config("code-reviewer")

        assert cfg.name == "code-reviewer"
        assert cfg.description == "Code review agent"
        assert cfg.model == "deepseek-v3"

    def test_load_missing_agent_raises(self, tmp_path):
        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            with pytest.raises(FileNotFoundError):
                load_agent_config("nonexistent-agent")

    def test_load_missing_config_yaml_raises(self, tmp_path):
        (tmp_path / "agents" / "dev" / "broken-agent").mkdir(parents=True)

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            with pytest.raises(FileNotFoundError):
                load_agent_config("broken-agent")

    def test_load_config_infers_name_from_dir(self, tmp_path):
        agent_dir = tmp_path / "agents" / "dev" / "inferred-name"
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text("description: My agent\n", encoding="utf-8")
        (agent_dir / "AGENTS.md").write_text("Hello", encoding="utf-8")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            cfg = load_agent_config("inferred-name")

        assert cfg.name == "inferred-name"

    def test_load_config_with_skill_refs(self, tmp_path):
        _write_agent(
            tmp_path,
            "industry-analyst",
            {
                "skill_refs": [
                    {
                        "name": "data-analysis",
                        "category": "public",
                        "source_path": "public/data-analysis",
                        "materialized_path": "skills/data-analysis",
                    }
                ]
            },
        )

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            cfg = load_agent_config("industry-analyst")

        assert len(cfg.skill_refs) == 1
        assert cfg.skill_refs[0].name == "data-analysis"

    def test_unknown_fields_are_ignored(self, tmp_path):
        agent_dir = tmp_path / "agents" / "dev" / "legacy-agent"
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text("name: legacy-agent\nprompt_file: system.md\n", encoding="utf-8")
        (agent_dir / "AGENTS.md").write_text("Agent content", encoding="utf-8")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            cfg = load_agent_config("legacy-agent")

        assert cfg.name == "legacy-agent"


class TestLoadAgentsMd:
    def test_reads_agents_md_file(self, tmp_path):
        expected = "You are a specialized code review expert."
        _write_agent(tmp_path, "code-reviewer", {"name": "code-reviewer"}, agents_md=expected)

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agents_md

            content = load_agents_md("code-reviewer")

        assert content == expected

    def test_missing_agents_md_returns_none(self, tmp_path):
        agent_dir = tmp_path / "agents" / "dev" / "no-md"
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text("name: no-md\n", encoding="utf-8")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agents_md

            content = load_agents_md("no-md")

        assert content is None

    def test_load_agents_md_respects_status_directory(self, tmp_path):
        _write_agent(tmp_path, "status-agent", {"name": "status-agent"}, status="dev", agents_md="dev instructions")
        _write_agent(tmp_path, "status-agent", {"name": "status-agent"}, status="prod", agents_md="prod instructions")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agents_md

            assert load_agents_md("status-agent", status="dev") == "dev instructions"
            assert load_agents_md("status-agent", status="prod") == "prod instructions"

    def test_empty_agents_md_returns_none(self, tmp_path):
        _write_agent(tmp_path, "empty-md", {"name": "empty-md"}, agents_md="   \n   ")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agents_md

            content = load_agents_md("empty-md")

        assert content is None

    def test_load_agents_md_requires_explicit_agent(self, tmp_path):
        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agents_md

            assert load_agents_md(None) is None


class TestListCustomAgents:
    def test_empty_when_no_agents_dir(self, tmp_path):
        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert agents == []

    def test_discovers_multiple_agents(self, tmp_path):
        _write_agent(tmp_path, "agent-a", {"name": "agent-a"}, status="dev")
        _write_agent(tmp_path, "agent-b", {"name": "agent-b", "description": "B"}, status="prod")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        names = [a.name for a in agents]
        assert "agent-a" in names
        assert "agent-b" in names

    def test_skips_dirs_without_config_yaml(self, tmp_path):
        _write_agent(tmp_path, "valid-agent", {"name": "valid-agent"})
        (tmp_path / "agents" / "dev" / "invalid-dir").mkdir(parents=True)

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert len(agents) == 1
        assert agents[0].name == "valid-agent"

    def test_skips_reserved_builtin_agent(self, tmp_path):
        _write_agent(tmp_path, "lead_agent", {"name": "lead_agent"}, status="dev")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert agents == []


class TestMemoryFilePath:
    def test_user_agent_memory_path(self, tmp_path):
        import src.agents.memory.updater as updater_mod

        with patch("src.agents.memory.updater.get_paths", return_value=_make_paths(tmp_path)):
            path = updater_mod._get_memory_file_path(user_id="user-1", agent_name="code-reviewer")
        assert path == tmp_path / "users" / "user-1" / "agents" / "dev" / "code-reviewer" / "memory.json"

    def test_user_agent_memory_path_respects_status(self, tmp_path):
        import src.agents.memory.updater as updater_mod

        with patch("src.agents.memory.updater.get_paths", return_value=_make_paths(tmp_path)):
            dev_path = updater_mod._get_memory_file_path(user_id="user-1", agent_name="status-agent", agent_status="dev")
            prod_path = updater_mod._get_memory_file_path(user_id="user-1", agent_name="status-agent", agent_status="prod")

        assert dev_path == tmp_path / "users" / "user-1" / "agents" / "dev" / "status-agent" / "memory.json"
        assert prod_path == tmp_path / "users" / "user-1" / "agents" / "prod" / "status-agent" / "memory.json"

    def test_memory_path_requires_user_id(self, tmp_path):
        import src.agents.memory.updater as updater_mod

        with patch("src.agents.memory.updater.get_paths", return_value=_make_paths(tmp_path)):
            with pytest.raises(ValueError, match="user_id"):
                updater_mod._get_memory_file_path(user_id="", agent_name="status-agent")


def _make_test_app():
    from fastapi import FastAPI

    from src.gateway.routers.agents import router

    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture()
def agent_client(tmp_path):
    paths_instance = _make_paths(tmp_path)
    shutil.rmtree(paths_instance.skills_dir, ignore_errors=True)

    with patch("src.config.agents_config.get_paths", return_value=paths_instance), patch(
        "src.gateway.routers.agents.get_paths", return_value=paths_instance
    ):
        app = _make_test_app()
        with TestClient(app) as client:
            client._tmp_path = tmp_path  # type: ignore[attr-defined]
            yield client


class TestAgentsAPI:
    def test_list_agents_empty(self, agent_client):
        response = agent_client.get("/api/agents")
        assert response.status_code == 200
        assert response.json()["agents"] == []

    def test_create_agent(self, agent_client):
        payload = {
            "name": "code-reviewer",
            "description": "Reviews code",
            "memory": {"enabled": True, "model_name": "memory-model"},
            "agents_md": "You are a code reviewer.",
        }
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "code-reviewer"
        assert data["description"] == "Reviews code"
        assert data["memory"]["enabled"] is True
        assert data["memory"]["model_name"] == "memory-model"
        assert data["agents_md"] == "You are a code reviewer."

    def test_create_agent_rejects_reserved_lead_agent_name(self, agent_client):
        response = agent_client.post("/api/agents", json={"name": "lead_agent", "agents_md": "reserved"})
        assert response.status_code == 409

    def test_create_agent_invalid_name(self, agent_client):
        response = agent_client.post("/api/agents", json={"name": "Code Reviewer!", "agents_md": "test"})
        assert response.status_code == 422

    def test_create_duplicate_agent_409(self, agent_client):
        payload = {"name": "my-agent", "agents_md": "test"}
        agent_client.post("/api/agents", json=payload)

        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 409

    def test_list_agents_after_create(self, agent_client):
        agent_client.post("/api/agents", json={"name": "agent-one", "agents_md": "p1"})
        agent_client.post("/api/agents", json={"name": "agent-two", "agents_md": "p2"})

        response = agent_client.get("/api/agents")
        assert response.status_code == 200
        names = [a["name"] for a in response.json()["agents"]]
        assert "agent-one" in names
        assert "agent-two" in names

    def test_get_agent(self, agent_client):
        agent_client.post("/api/agents", json={"name": "test-agent", "agents_md": "Hello world"})

        response = agent_client.get("/api/agents/test-agent")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "test-agent"
        assert data["agents_md"] == "Hello world"

    def test_get_missing_agent_404(self, agent_client):
        response = agent_client.get("/api/agents/nonexistent")
        assert response.status_code == 404

    def test_update_agent_agents_md(self, agent_client):
        agent_client.post("/api/agents", json={"name": "update-me", "agents_md": "original"})

        response = agent_client.put("/api/agents/update-me", json={"agents_md": "updated"})
        assert response.status_code == 200
        assert response.json()["agents_md"] == "updated"

    def test_update_agent_description(self, agent_client):
        agent_client.post("/api/agents", json={"name": "desc-agent", "description": "old desc", "agents_md": "p"})

        response = agent_client.put("/api/agents/desc-agent", json={"description": "new desc"})
        assert response.status_code == 200
        assert response.json()["description"] == "new desc"

    def test_update_missing_agent_404(self, agent_client):
        response = agent_client.put("/api/agents/ghost-agent", json={"agents_md": "new"})
        assert response.status_code == 404

    def test_delete_agent(self, agent_client):
        agent_client.post("/api/agents", json={"name": "del-me", "agents_md": "bye"})

        response = agent_client.delete("/api/agents/del-me")
        assert response.status_code == 204

        response = agent_client.get("/api/agents/del-me")
        assert response.status_code == 404

    def test_delete_missing_agent_404(self, agent_client):
        response = agent_client.delete("/api/agents/does-not-exist")
        assert response.status_code == 404

    def test_create_agent_with_model_and_tool_groups(self, agent_client):
        payload = {
            "name": "specialized",
            "description": "Specialized agent",
            "model": "deepseek-v3",
            "tool_groups": ["web"],
            "agents_md": "You are specialized.",
        }
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["model"] == "deepseek-v3"
        assert data["tool_groups"] == ["web"]

    def test_create_agent_with_selected_skills_copies_library_skill(self, agent_client, tmp_path):
        _write_shared_skill(tmp_path, "data-analysis", category="public")
        _write_shared_skill(tmp_path, "deep-research", category="custom")

        payload = {
            "name": "industry-analyst",
            "description": "Vertical analyst",
            "skills": ["data-analysis", "deep-research"],
            "agents_md": "You are an industry analyst.",
        }
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 201

        data = response.json()
        assert [skill["name"] for skill in data["skills"]] == ["data-analysis", "deep-research"]

        agent_dir = tmp_path / "agents" / "dev" / "industry-analyst"
        assert (agent_dir / "skills" / "data-analysis" / "SKILL.md").exists()
        assert (agent_dir / "skills" / "deep-research" / "SKILL.md").exists()

        config = yaml.safe_load((agent_dir / "config.yaml").read_text(encoding="utf-8"))
        assert config["agents_md_path"] == "AGENTS.md"
        assert [skill["name"] for skill in config["skill_refs"]] == ["data-analysis", "deep-research"]
        assert config["memory"]["enabled"] is False
        assert "skills_mode" not in config

    def test_update_agent_replaces_materialized_skills(self, agent_client, tmp_path):
        _write_shared_skill(tmp_path, "data-analysis", category="public")
        _write_shared_skill(tmp_path, "deep-research", category="public")

        agent_client.post(
            "/api/agents",
            json={"name": "skill-switcher", "skills": ["data-analysis"], "agents_md": "v1"},
        )

        response = agent_client.put(
            "/api/agents/skill-switcher",
            json={"skills": ["deep-research"], "agents_md": "v2"},
        )
        assert response.status_code == 200
        data = response.json()
        assert [skill["name"] for skill in data["skills"]] == ["deep-research"]

        agent_dir = tmp_path / "agents" / "dev" / "skill-switcher"
        assert not (agent_dir / "skills" / "data-analysis").exists()
        assert (agent_dir / "skills" / "deep-research" / "SKILL.md").exists()
        assert (agent_dir / "AGENTS.md").read_text(encoding="utf-8") == "v2"


class TestPublishAPI:
    def test_publish_agent(self, agent_client, tmp_path):
        _write_shared_skill(tmp_path, "data-analysis", category="public")
        agent_client.post("/api/agents", json={"name": "pub-test", "agents_md": "Hello", "skills": ["data-analysis"]})

        response = agent_client.post("/api/agents/pub-test/publish")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "pub-test"
        assert data["status"] == "prod"
        assert data["agents_md"] == "Hello"
        assert [skill["name"] for skill in data["skills"]] == ["data-analysis"]

        prod_dir = tmp_path / "agents" / "prod" / "pub-test"
        assert prod_dir.exists()
        assert (prod_dir / "AGENTS.md").read_text(encoding="utf-8") == "Hello"
        assert (prod_dir / "skills" / "data-analysis" / "SKILL.md").exists()

        prod_config = yaml.safe_load((prod_dir / "config.yaml").read_text(encoding="utf-8"))
        assert prod_config["status"] == "prod"
        assert "skills_mode" not in prod_config

    def test_publish_missing_agent_404(self, agent_client):
        response = agent_client.post("/api/agents/nonexistent/publish")
        assert response.status_code == 404

    def test_publish_overwrites_existing_prod(self, agent_client):
        agent_client.post("/api/agents", json={"name": "re-pub", "agents_md": "v1"})
        agent_client.post("/api/agents/re-pub/publish")

        agent_client.put("/api/agents/re-pub", json={"agents_md": "v2"})
        response = agent_client.post("/api/agents/re-pub/publish")
        assert response.status_code == 200

        prod_dir = agent_client._tmp_path / "agents" / "prod" / "re-pub"  # type: ignore[attr-defined]
        assert (prod_dir / "AGENTS.md").read_text(encoding="utf-8") == "v2"

    def test_get_agent_can_target_prod_status(self, agent_client):
        agent_client.post("/api/agents", json={"name": "status-agent", "agents_md": "dev version"})
        agent_client.post("/api/agents/status-agent/publish")
        agent_client.put("/api/agents/status-agent", json={"agents_md": "dev changed later"})

        prod_response = agent_client.get("/api/agents/status-agent", params={"status": "prod"})
        assert prod_response.status_code == 200
        assert prod_response.json()["status"] == "prod"
        assert prod_response.json()["agents_md"] == "dev version"

        dev_response = agent_client.get("/api/agents/status-agent", params={"status": "dev"})
        assert dev_response.status_code == 200
        assert dev_response.json()["status"] == "dev"
        assert dev_response.json()["agents_md"] == "dev changed later"


class TestUserProfileAPI:
    def test_get_user_profile_empty(self, agent_client):
        response = agent_client.get("/api/user-profile")
        assert response.status_code == 200
        assert response.json()["content"] is None

    def test_put_user_profile(self, agent_client, tmp_path):
        content = "# User Profile\n\nI am a developer."
        response = agent_client.put("/api/user-profile", json={"content": content})
        assert response.status_code == 200
        assert response.json()["content"] == content

        user_md = tmp_path / "USER.md"
        assert user_md.exists()
        assert user_md.read_text(encoding="utf-8") == content

    def test_get_user_profile_after_put(self, agent_client):
        content = "# Profile\n\nI work on data science."
        agent_client.put("/api/user-profile", json={"content": content})

        response = agent_client.get("/api/user-profile")
        assert response.status_code == 200
        assert response.json()["content"] == content

    def test_put_empty_user_profile_returns_none(self, agent_client):
        response = agent_client.put("/api/user-profile", json={"content": ""})
        assert response.status_code == 200
        assert response.json()["content"] is None
