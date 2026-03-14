"""Tests for lead agent backend wiring and runtime seeding."""

from pathlib import Path
from unittest.mock import patch

from deepagents.backends import CompositeBackend

from src.agents.lead_agent import agent as lead_agent_module
from src.config import builtin_agents
from src.config.agent_runtime_seed import runtime_seed_targets
from src.config.builtin_agents import LEAD_AGENT_NAME
from src.config.model_config import ModelConfig
from src.config.paths import Paths


def setup_function() -> None:
    builtin_agents._ENSURED_ARCHIVES.clear()


def _make_paths(base_dir: Path) -> Paths:
    return Paths(base_dir=base_dir, skills_dir=base_dir / "skills")


def _write_shared_skill(base_dir: Path, name: str, *, category: str = "shared", body: str = "skill") -> None:
    skill_file = base_dir / "skills" / Path(category) / name / "SKILL.md"
    skill_file.parent.mkdir(parents=True, exist_ok=True)
    skill_file.write_text(
        f"---\nname: {name}\ndescription: {name} description\n---\n\n{body}\n",
        encoding="utf-8",
    )


def test_build_backend_sets_thread_user_data_as_shell_cwd(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_shared_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    user_data_dir = paths.sandbox_user_data_dir("thread-1")
    assert isinstance(backend, CompositeBackend)
    assert backend.default.cwd == user_data_dir.resolve()
    assert "/mnt/skills/" in backend.routes


def test_build_backend_sets_default_user_data_as_shell_cwd_when_thread_missing(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_shared_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend(None, agent_name=None)

    default_user_data_dir = base_dir / "threads" / "_default" / "user-data"
    assert isinstance(backend, CompositeBackend)
    assert backend.default.cwd == default_user_data_dir.resolve()


def test_build_backend_default_agent_seeds_archived_agent_tree_into_thread_runtime(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_shared_skill(base_dir, "bootstrap", body="bootstrap skill")
    _write_shared_skill(base_dir, "surprise-me", body="surprise skill")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    runtime_agent_root = lead_agent_module._runtime_agent_root(LEAD_AGENT_NAME, "dev")
    responses = backend.download_files(
        [
            f"{runtime_agent_root}/AGENTS.md",
            f"{runtime_agent_root}/config.yaml",
            f"{runtime_agent_root}/skills/bootstrap/SKILL.md",
            f"{runtime_agent_root}/skills/surprise-me/SKILL.md",
        ]
    )
    assert b"Lead Agent" in responses[0].content
    assert b"skill_refs" in responses[1].content
    assert b"bootstrap skill" in responses[2].content
    assert b"surprise skill" in responses[3].content


def test_build_backend_routes_shared_skills_into_local_debug_backend(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_shared_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    shared_skill = backend.download_files(["/mnt/skills/shared/bootstrap/SKILL.md"])[0]

    assert shared_skill.error is None
    assert shared_skill.content is not None
    assert b"bootstrap" in shared_skill.content


def test_build_backend_named_agent_seeds_agent_definition_into_thread_runtime(tmp_path):
    base_dir = tmp_path / ".openagents"
    agent_dir = base_dir / "agents" / "prod" / "analyst"
    (agent_dir / "skills" / "data-analysis").mkdir(parents=True)
    (agent_dir / "AGENTS.md").write_text("You are an analyst.", encoding="utf-8")
    (agent_dir / "config.yaml").write_text(
        "name: analyst\n"
        "status: prod\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs:\n"
        "  - name: data-analysis\n"
        "    materialized_path: skills/data-analysis\n",
        encoding="utf-8",
    )
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
    assert responses[1].content is not None
    assert b"name: analyst" in responses[1].content
    assert b"status: prod" in responses[1].content
    assert b"skill_refs" in responses[1].content
    assert responses[2].content == b"Analyze data"


def test_build_backend_supports_store_prod_skill_refs(tmp_path):
    base_dir = tmp_path / ".openagents"
    agent_dir = base_dir / "agents" / "prod" / "reviewer"
    (agent_dir / "skills" / "contracts" / "review").mkdir(parents=True)
    (agent_dir / "AGENTS.md").write_text("You review contracts.", encoding="utf-8")
    (agent_dir / "config.yaml").write_text(
        "name: reviewer\n"
        "status: prod\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs:\n"
        "  - name: contract-review\n"
        "    source_path: store/prod/contracts/review\n",
        encoding="utf-8",
    )
    (agent_dir / "skills" / "contracts" / "review" / "SKILL.md").write_text("Review contracts", encoding="utf-8")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name="reviewer", status="prod")

    runtime_agent_root = lead_agent_module._runtime_agent_root("reviewer", "prod")
    response = backend.download_files([f"{runtime_agent_root}/skills/contracts/review/SKILL.md"])[0]

    assert response.content == b"Review contracts"


def test_runtime_seed_targets_reads_latest_archive_contents(tmp_path):
    base_dir = tmp_path / ".openagents"
    agent_dir = base_dir / "agents" / "dev" / "analyst"
    (agent_dir / "skills" / "data-analysis").mkdir(parents=True)
    (agent_dir / "AGENTS.md").write_text("v1", encoding="utf-8")
    (agent_dir / "config.yaml").write_text(
        "name: analyst\nstatus: dev\nagents_md_path: AGENTS.md\n"
        "skill_refs:\n  - name: data-analysis\n    materialized_path: skills/data-analysis/SKILL.md\n",
        encoding="utf-8",
    )
    (agent_dir / "skills" / "data-analysis" / "SKILL.md").write_text("skill-v1", encoding="utf-8")
    paths = _make_paths(base_dir)

    first_targets = runtime_seed_targets(
        "analyst",
        status="dev",
        target_root=lead_agent_module._runtime_agent_root("analyst", "dev"),
        paths=paths,
    )

    (agent_dir / "AGENTS.md").write_text("v2", encoding="utf-8")
    second_targets = runtime_seed_targets(
        "analyst",
        status="dev",
        target_root=lead_agent_module._runtime_agent_root("analyst", "dev"),
        paths=paths,
    )

    first_agents_md = dict(first_targets)[f"{lead_agent_module._runtime_agent_root('analyst', 'dev')}/AGENTS.md"]
    second_agents_md = dict(second_targets)[f"{lead_agent_module._runtime_agent_root('analyst', 'dev')}/AGENTS.md"]
    assert first_agents_md == b"v1"
    assert second_agents_md == b"v2"


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
