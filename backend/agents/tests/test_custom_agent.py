"""Tests for custom agent support."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_paths(base_dir: Path):
    """Return a Paths instance pointing to base_dir."""
    from src.config.paths import Paths

    return Paths(base_dir=base_dir)


def _write_agent(base_dir: Path, name: str, config: dict, soul: str = "You are helpful.") -> None:
    """Write an agent directory with config.yaml and AGENTS.md."""
    agent_dir = base_dir / "agents" / name
    agent_dir.mkdir(parents=True, exist_ok=True)

    config_copy = dict(config)
    if "name" not in config_copy:
        config_copy["name"] = name

    with open(agent_dir / "config.yaml", "w") as f:
        yaml.dump(config_copy, f)

    (agent_dir / "AGENTS.md").write_text(soul, encoding="utf-8")


# ===========================================================================
# 1. Paths class – agent path methods
# ===========================================================================


class TestPaths:
    def test_agents_dir(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.agents_dir == tmp_path / "agents"

    def test_agent_dir(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.agent_dir("code-reviewer") == tmp_path / "agents" / "dev" / "code-reviewer"
        assert paths.agent_dir("code-reviewer", "prod") == tmp_path / "agents" / "prod" / "code-reviewer"

    def test_agent_memory_file(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.agent_memory_file("code-reviewer") == tmp_path / "agents" / "dev" / "code-reviewer" / "memory.json"

    def test_user_md_file(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.user_md_file == tmp_path / "USER.md"

    def test_paths_are_different_from_global(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.memory_file != paths.agent_memory_file("my-agent")
        assert paths.memory_file == tmp_path / "memory.json"
        assert paths.agent_memory_file("my-agent") == tmp_path / "agents" / "dev" / "my-agent" / "memory.json"


# ===========================================================================
# 2. AgentConfig – Pydantic parsing
# ===========================================================================


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
            tool_groups=["file:read", "bash"],
        )
        assert cfg.name == "code-reviewer"
        assert cfg.model == "deepseek-v3"
        assert cfg.tool_groups == ["file:read", "bash"]

    def test_config_from_dict(self):
        from src.config.agents_config import AgentConfig

        data = {"name": "test-agent", "description": "A test", "model": "gpt-4"}
        cfg = AgentConfig(**data)
        assert cfg.name == "test-agent"
        assert cfg.model == "gpt-4"
        assert cfg.tool_groups is None


# ===========================================================================
# 3. load_agent_config
# ===========================================================================


class TestLoadAgentConfig:
    def test_load_valid_config(self, tmp_path):
        config_dict = {"name": "code-reviewer", "description": "Code review agent", "model": "deepseek-v3"}
        _write_agent(tmp_path, "code-reviewer", config_dict)

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
        # Create directory without config.yaml
        (tmp_path / "agents" / "broken-agent").mkdir(parents=True)

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            with pytest.raises(FileNotFoundError):
                load_agent_config("broken-agent")

    def test_load_config_infers_name_from_dir(self, tmp_path):
        """Config without 'name' field should use directory name."""
        agent_dir = tmp_path / "agents" / "inferred-name"
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text("description: My agent\n")
        (agent_dir / "AGENTS.md").write_text("Hello")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            cfg = load_agent_config("inferred-name")

        assert cfg.name == "inferred-name"

    def test_load_config_with_tool_groups(self, tmp_path):
        config_dict = {"name": "restricted", "tool_groups": ["file:read", "file:write"]}
        _write_agent(tmp_path, "restricted", config_dict)

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            cfg = load_agent_config("restricted")

        assert cfg.tool_groups == ["file:read", "file:write"]

    def test_legacy_prompt_file_field_ignored(self, tmp_path):
        """Unknown fields like the old prompt_file should be silently ignored."""
        agent_dir = tmp_path / "agents" / "legacy-agent"
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text("name: legacy-agent\nprompt_file: system.md\n")
        (agent_dir / "AGENTS.md").write_text("Agent content")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agent_config

            cfg = load_agent_config("legacy-agent")

        assert cfg.name == "legacy-agent"


# ===========================================================================
# 4. load_agents_md (and backward-compatible load_agent_soul alias)
# ===========================================================================


class TestLoadAgentsMd:
    def test_reads_agents_md_file(self, tmp_path):
        expected = "You are a specialized code review expert."
        _write_agent(tmp_path, "code-reviewer", {"name": "code-reviewer"}, soul=expected)

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import AgentConfig, load_agents_md

            cfg = AgentConfig(name="code-reviewer")
            content = load_agents_md(cfg.name)

        assert content == expected

    def test_backward_compat_load_agent_soul(self, tmp_path):
        """load_agent_soul alias should still work."""
        expected = "You are a specialized code review expert."
        _write_agent(tmp_path, "code-reviewer", {"name": "code-reviewer"}, soul=expected)

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import AgentConfig, load_agent_soul

            cfg = AgentConfig(name="code-reviewer")
            content = load_agent_soul(cfg.name)

        assert content == expected

    def test_falls_back_to_legacy_soul_md(self, tmp_path):
        """Should fall back to SOUL.md when AGENTS.md doesn't exist."""
        agent_dir = tmp_path / "agents" / "legacy"
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text("name: legacy\n")
        (agent_dir / "SOUL.md").write_text("Legacy soul content")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agents_md

            content = load_agents_md("legacy")

        assert content == "Legacy soul content"

    def test_missing_agents_md_returns_none(self, tmp_path):
        agent_dir = tmp_path / "agents" / "no-md"
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text("name: no-md\n")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agents_md

            content = load_agents_md("no-md")

        assert content is None

    def test_empty_agents_md_returns_none(self, tmp_path):
        agent_dir = tmp_path / "agents" / "empty-md"
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text("name: empty-md\n")
        (agent_dir / "AGENTS.md").write_text("   \n   ")

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import load_agents_md

            content = load_agents_md("empty-md")

        assert content is None

    def test_default_agent_prefers_openagents_home_agents_md(self, tmp_path):
        from src.config.paths import Paths

        openagents_home = tmp_path / ".openagents"
        openagents_home.mkdir(parents=True)
        (openagents_home / "AGENTS.md").write_text("openagents default", encoding="utf-8")

        repo_agents_root = tmp_path / "backend" / "agents"
        repo_agents_root.mkdir(parents=True)
        (repo_agents_root / "AGENTS.md").write_text("repo fallback", encoding="utf-8")

        with patch("src.config.agents_config.get_paths", return_value=Paths(base_dir=openagents_home)), patch(
            "src.config.agents_config.AGENTS_ROOT", repo_agents_root
        ):
            from src.config.agents_config import load_agents_md

            content = load_agents_md(None)

        assert content == "openagents default"

    def test_default_agent_falls_back_to_repo_agents_md(self, tmp_path):
        from src.config.paths import Paths

        openagents_home = tmp_path / ".openagents"
        openagents_home.mkdir(parents=True)

        repo_agents_root = tmp_path / "backend" / "agents"
        repo_agents_root.mkdir(parents=True)
        (repo_agents_root / "AGENTS.md").write_text("repo fallback", encoding="utf-8")

        with patch("src.config.agents_config.get_paths", return_value=Paths(base_dir=openagents_home)), patch(
            "src.config.agents_config.AGENTS_ROOT", repo_agents_root
        ):
            from src.config.agents_config import load_agents_md

            content = load_agents_md(None)

        assert content == "repo fallback"


# ===========================================================================
# 5. list_custom_agents
# ===========================================================================


class TestListCustomAgents:
    def test_empty_when_no_agents_dir(self, tmp_path):
        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert agents == []

    def test_discovers_multiple_agents(self, tmp_path):
        _write_agent(tmp_path, "agent-a", {"name": "agent-a"})
        _write_agent(tmp_path, "agent-b", {"name": "agent-b", "description": "B"})

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        names = [a.name for a in agents]
        assert "agent-a" in names
        assert "agent-b" in names

    def test_skips_dirs_without_config_yaml(self, tmp_path):
        # Valid agent
        _write_agent(tmp_path, "valid-agent", {"name": "valid-agent"})
        # Invalid dir (no config.yaml)
        (tmp_path / "agents" / "invalid-dir").mkdir(parents=True)

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert len(agents) == 1
        assert agents[0].name == "valid-agent"

    def test_skips_non_directory_entries(self, tmp_path):
        # Create the agents dir with a file (not a dir)
        agents_dir = tmp_path / "agents"
        agents_dir.mkdir(parents=True)
        (agents_dir / "not-a-dir.txt").write_text("hello")
        _write_agent(tmp_path, "real-agent", {"name": "real-agent"})

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert len(agents) == 1
        assert agents[0].name == "real-agent"

    def test_returns_sorted_by_name(self, tmp_path):
        _write_agent(tmp_path, "z-agent", {"name": "z-agent"})
        _write_agent(tmp_path, "a-agent", {"name": "a-agent"})
        _write_agent(tmp_path, "m-agent", {"name": "m-agent"})

        with patch("src.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from src.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        names = [a.name for a in agents]
        assert names == sorted(names)


# ===========================================================================
# 7. Memory isolation: _get_memory_file_path
# ===========================================================================


class TestMemoryFilePath:
    def test_global_memory_path(self, tmp_path):
        """None agent_name should return global memory file."""
        import src.agents.memory.updater as updater_mod

        with patch("src.agents.memory.updater.get_paths", return_value=_make_paths(tmp_path)):
            path = updater_mod._get_memory_file_path(None)
        assert path == tmp_path / "memory.json"

    def test_agent_memory_path(self, tmp_path):
        """Providing agent_name should return per-agent memory file."""
        import src.agents.memory.updater as updater_mod

        with patch("src.agents.memory.updater.get_paths", return_value=_make_paths(tmp_path)):
            path = updater_mod._get_memory_file_path("code-reviewer")
        assert path == tmp_path / "agents" / "dev" / "code-reviewer" / "memory.json"

    def test_different_paths_for_different_agents(self, tmp_path):
        import src.agents.memory.updater as updater_mod

        with patch("src.agents.memory.updater.get_paths", return_value=_make_paths(tmp_path)):
            path_global = updater_mod._get_memory_file_path(None)
            path_a = updater_mod._get_memory_file_path("agent-a")
            path_b = updater_mod._get_memory_file_path("agent-b")

        assert path_global != path_a
        assert path_global != path_b
        assert path_a != path_b


# ===========================================================================
# 8. Gateway API – Agents endpoints
# ===========================================================================


def _make_test_app(tmp_path: Path):
    """Create a FastAPI app with the agents router, patching paths to tmp_path."""
    from fastapi import FastAPI

    from src.gateway.routers.agents import router

    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture()
def agent_client(tmp_path):
    """TestClient with agents router, using tmp_path as base_dir."""
    paths_instance = _make_paths(tmp_path)

    with patch("src.config.agents_config.get_paths", return_value=paths_instance), patch("src.gateway.routers.agents.get_paths", return_value=paths_instance):
        app = _make_test_app(tmp_path)
        with TestClient(app) as client:
            client._tmp_path = tmp_path  # type: ignore[attr-defined]
            yield client


class TestAgentsAPI:
    def test_list_agents_empty(self, agent_client):
        response = agent_client.get("/api/agents")
        assert response.status_code == 200
        data = response.json()
        assert data["agents"] == []

    def test_create_agent(self, agent_client):
        payload = {
            "name": "code-reviewer",
            "description": "Reviews code",
            "agents_md": "You are a code reviewer.",
        }
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "code-reviewer"
        assert data["description"] == "Reviews code"
        assert data["agents_md"] == "You are a code reviewer."
        assert data["soul"] == "You are a code reviewer."  # backward compat

    def test_create_agent_legacy_soul_field(self, agent_client):
        """Legacy 'soul' field should still work for backward compatibility."""
        payload = {
            "name": "legacy-agent",
            "description": "Legacy",
            "soul": "Legacy soul content.",
        }
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["agents_md"] == "Legacy soul content."
        assert data["soul"] == "Legacy soul content."

    def test_create_agent_invalid_name(self, agent_client):
        payload = {"name": "Code Reviewer!", "agents_md": "test"}
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 422

    def test_create_duplicate_agent_409(self, agent_client):
        payload = {"name": "my-agent", "agents_md": "test"}
        agent_client.post("/api/agents", json=payload)

        # Second create should fail
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

    def test_update_agent_legacy_soul_field(self, agent_client):
        """Legacy 'soul' field should still work for updates."""
        agent_client.post("/api/agents", json={"name": "update-legacy", "agents_md": "original"})

        response = agent_client.put("/api/agents/update-legacy", json={"soul": "updated via soul"})
        assert response.status_code == 200
        assert response.json()["agents_md"] == "updated via soul"

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

        # Verify it's gone
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
            "tool_groups": ["file:read", "bash"],
            "agents_md": "You are specialized.",
        }
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["model"] == "deepseek-v3"
        assert data["tool_groups"] == ["file:read", "bash"]

    def test_create_persists_files_on_disk(self, agent_client, tmp_path):
        agent_client.post("/api/agents", json={"name": "disk-check", "agents_md": "disk content"})

        agent_dir = tmp_path / "agents" / "dev" / "disk-check"
        assert agent_dir.exists()
        assert (agent_dir / "config.yaml").exists()
        assert (agent_dir / "AGENTS.md").exists()
        assert (agent_dir / "AGENTS.md").read_text() == "disk content"

    def test_delete_removes_files_from_disk(self, agent_client, tmp_path):
        agent_client.post("/api/agents", json={"name": "remove-me", "agents_md": "bye"})
        agent_dir = tmp_path / "agents" / "dev" / "remove-me"
        assert agent_dir.exists()

        agent_client.delete("/api/agents/remove-me")
        assert not agent_dir.exists()


# ===========================================================================
# 9. Gateway API – Publish endpoint
# ===========================================================================


class TestPublishAPI:
    def test_publish_agent(self, agent_client, tmp_path):
        """Publish copies dev → prod and sets status=prod."""
        agent_client.post("/api/agents", json={"name": "pub-test", "agents_md": "Hello"})
        dev_dir = tmp_path / "agents" / "dev" / "pub-test"
        assert dev_dir.exists()

        response = agent_client.post("/api/agents/pub-test/publish")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "pub-test"
        assert data["status"] == "prod"
        assert data["agents_md"] == "Hello"

        # Verify prod directory exists on disk
        prod_dir = tmp_path / "agents" / "prod" / "pub-test"
        assert prod_dir.exists()
        assert (prod_dir / "AGENTS.md").read_text(encoding="utf-8") == "Hello"

        # Verify prod config.yaml has status=prod
        prod_config = yaml.safe_load((prod_dir / "config.yaml").read_text(encoding="utf-8"))
        assert prod_config["status"] == "prod"

    def test_publish_missing_agent_404(self, agent_client):
        response = agent_client.post("/api/agents/nonexistent/publish")
        assert response.status_code == 404

    def test_publish_overwrites_existing_prod(self, agent_client, tmp_path):
        """Publishing again overwrites existing prod directory."""
        agent_client.post("/api/agents", json={"name": "re-pub", "agents_md": "v1"})
        agent_client.post("/api/agents/re-pub/publish")

        # Update dev and re-publish
        agent_client.put("/api/agents/re-pub", json={"agents_md": "v2"})
        response = agent_client.post("/api/agents/re-pub/publish")
        assert response.status_code == 200

        prod_dir = tmp_path / "agents" / "prod" / "re-pub"
        assert (prod_dir / "AGENTS.md").read_text(encoding="utf-8") == "v2"

    def test_publish_agent_appears_in_list(self, agent_client):
        """Published agent should appear in list with status=prod."""
        agent_client.post("/api/agents", json={"name": "listed-pub", "agents_md": "Hi"})
        agent_client.post("/api/agents/listed-pub/publish")

        response = agent_client.get("/api/agents")
        agents = response.json()["agents"]
        # Should have both dev and prod entries, or at least the agent appears
        names = [a["name"] for a in agents]
        assert "listed-pub" in names


# ===========================================================================
# 10. Gateway API – User Profile endpoints
# ===========================================================================


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

        # File should be written to disk
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
