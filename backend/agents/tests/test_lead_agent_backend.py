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
    (skills_public / "SKILL.md").parent.mkdir(parents=True, exist_ok=True)
    (skills_public / "SKILL.md").write_text("dummy", encoding="utf-8")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    user_data_dir = paths.sandbox_user_data_dir("thread-1")
    assert backend.default.cwd == user_data_dir.resolve()
    assert backend.routes == {}


def test_build_backend_sets_default_user_data_as_shell_cwd_when_thread_missing(tmp_path):
    base_dir = tmp_path / ".openagents"
    skill_file = tmp_path / "skills" / "public" / "dummy-skill" / "SKILL.md"
    skill_file.parent.mkdir(parents=True)
    skill_file.write_text("dummy", encoding="utf-8")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend(None, agent_name=None)

    default_user_data_dir = base_dir / "threads" / "_default" / "user-data"
    assert backend.default.cwd == default_user_data_dir.resolve()


def test_build_backend_default_agent_seeds_full_skills_archive_into_thread_runtime(tmp_path):
    base_dir = tmp_path / ".openagents"
    public_root = tmp_path / "skills" / "public"
    custom_root = tmp_path / "skills" / "custom"
    (public_root / "dummy-skill").mkdir(parents=True)
    (custom_root / "team-skill").mkdir(parents=True)
    (public_root / "dummy-skill" / "SKILL.md").write_text("public skill", encoding="utf-8")
    (custom_root / "team-skill" / "SKILL.md").write_text("custom skill", encoding="utf-8")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    assert backend.routes == {}
    responses = backend.download_files(
        [
            f"{lead_agent_module.DEFAULT_RUNTIME_SKILLS_PATH}public/dummy-skill/SKILL.md",
            f"{lead_agent_module.DEFAULT_RUNTIME_SKILLS_PATH}custom/team-skill/SKILL.md",
        ]
    )
    assert responses[0].content == b"public skill"
    assert responses[1].content == b"custom skill"


def test_build_backend_named_agent_seeds_agent_definition_into_thread_runtime(tmp_path):
    base_dir = tmp_path / ".openagents"
    agent_dir = base_dir / "agents" / "prod" / "analyst"
    (agent_dir / "skills" / "data-analysis").mkdir(parents=True)
    (agent_dir / "AGENTS.md").write_text("You are an analyst.", encoding="utf-8")
    (agent_dir / "config.yaml").write_text("name: analyst\nstatus: prod\n", encoding="utf-8")
    (agent_dir / "skills" / "data-analysis" / "SKILL.md").write_text("Analyze data", encoding="utf-8")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name="analyst", status="prod")

    runtime_agent_root = lead_agent_module._runtime_agent_root("analyst", "prod")
    responses = backend.download_files(
        [
            f"{runtime_agent_root}/AGENTS.md",
            f"{runtime_agent_root}/config.yaml",
            f"{runtime_agent_root}/skills/data-analysis/SKILL.md",
        ]
    )
    assert responses[0].content == b"You are an analyst."
    assert responses[1].content == b"name: analyst\nstatus: prod\n"
    assert responses[2].content == b"Analyze data"


def test_resolve_execution_backend_defaults_to_local(monkeypatch):
    monkeypatch.delenv("OPENAGENTS_SANDBOX_PROVIDER", raising=False)
    monkeypatch.setattr(lead_agent_module.AppConfig, "resolve_config_path", classmethod(lambda cls, config_path=None: None))

    assert lead_agent_module._resolve_execution_backend() == "local"


def test_resolve_execution_backend_uses_env_sandbox_provider(monkeypatch):
    monkeypatch.setenv("OPENAGENTS_SANDBOX_PROVIDER", "src.community.aio_sandbox:AioSandboxProvider")

    assert lead_agent_module._resolve_execution_backend() == "sandbox"


def test_build_workspace_backend_uses_configured_sandbox_provider(monkeypatch):
    class DummyProvider:
        def __init__(self):
            self.thread_id = None
            self.sandbox = object()

        def acquire(self, thread_id):
            self.thread_id = thread_id
            return "sandbox-1"

        def get(self, sandbox_id):
            assert sandbox_id == "sandbox-1"
            return self.sandbox

    provider = DummyProvider()
    monkeypatch.setenv("OPENAGENTS_SANDBOX_PROVIDER", "src.community.aio_sandbox:AioSandboxProvider")
    monkeypatch.setattr(lead_agent_module, "_get_sandbox_provider", lambda provider_path: provider)

    backend = lead_agent_module._build_workspace_backend(
        user_data_dir="/tmp/runtime",
        thread_id="thread-1",
    )

    assert backend is provider.sandbox
    assert provider.thread_id == "thread-1"


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
