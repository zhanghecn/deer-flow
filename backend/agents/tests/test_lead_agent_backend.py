"""Tests for lead agent backend wiring and default path behavior."""

from pathlib import Path
from unittest.mock import patch

from src.agents.lead_agent import agent as lead_agent_module
from src.config.model_config import ModelConfig
from src.config.paths import Paths


def _make_paths(base_dir: Path) -> Paths:
    return Paths(base_dir=base_dir)


def test_build_backend_sets_thread_user_data_as_shell_cwd(tmp_path):
    base_dir = tmp_path / ".openagents"
    skills_public = tmp_path / "skills" / "public" / "dummy-skill"
    skills_public.mkdir(parents=True)
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    user_data_dir = paths.sandbox_user_data_dir("thread-1")
    assert backend.default.cwd == user_data_dir.resolve()


def test_build_backend_sets_default_user_data_as_shell_cwd_when_thread_missing(tmp_path):
    base_dir = tmp_path / ".openagents"
    (tmp_path / "skills" / "public" / "dummy-skill").mkdir(parents=True)
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend(None, agent_name=None)

    default_user_data_dir = base_dir / "threads" / "_default" / "user-data"
    assert backend.default.cwd == default_user_data_dir.resolve()


def test_build_backend_public_skills_prefers_skills_public_subdir(tmp_path):
    base_dir = tmp_path / ".openagents"
    public_root = tmp_path / "skills" / "public"
    (public_root / "dummy-skill").mkdir(parents=True)
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    route_backend = backend.routes["/public-skills/"]
    assert route_backend.cwd == public_root.resolve()


def test_build_backend_public_skills_falls_back_to_skills_root(tmp_path):
    base_dir = tmp_path / ".openagents"
    skills_root = tmp_path / "skills"
    skills_root.mkdir(parents=True)
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    route_backend = backend.routes["/public-skills/"]
    assert route_backend.cwd == skills_root.resolve()


def test_openagents_middlewares_include_artifacts_state():
    model_config = ModelConfig(
        name="test-model",
        use="langchain_openai.ChatOpenAI",
        model="gpt-test",
        supports_vision=False,
    )

    middlewares = lead_agent_module._build_openagents_middlewares(model_config)
    schemas = [getattr(mw.__class__, "state_schema", None) for mw in middlewares]
    assert any(
        schema is not None and "artifacts" in getattr(schema, "__annotations__", {})
        for schema in schemas
    )
