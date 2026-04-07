"""Tests for lead agent backend wiring and runtime seeding."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from unittest.mock import patch

import pytest
from deepagents.backends import CompositeBackend

from src.agents.lead_agent import agent as lead_agent_module
from src.config import builtin_agents
from src.config.agent_runtime_seed import runtime_seed_targets
from src.config.builtin_agents import LEAD_AGENT_NAME
from src.config.model_config import ModelConfig
from src.config.paths import Paths


def setup_function() -> None:
    builtin_agents._ENSURED_ARCHIVES.clear()
    lead_agent_module._clear_lead_agent_graph_cache()


@pytest.fixture(autouse=True)
def _default_to_local_execution_backend(monkeypatch):
    monkeypatch.setenv("OPENAGENTS_SANDBOX_PROVIDER", "src.sandbox.local:LocalSandboxProvider")


def _make_paths(base_dir: Path) -> Paths:
    return Paths(base_dir=base_dir, skills_dir=base_dir)


def _write_archived_skill(base_dir: Path, name: str, *, category: str = "system", body: str = "skill") -> None:
    if category in {"system", "custom"}:
        skill_file = base_dir / category / "skills" / name / "SKILL.md"
    else:
        skill_file = base_dir / "skills" / Path(category) / name / "SKILL.md"
    skill_file.parent.mkdir(parents=True, exist_ok=True)
    skill_file.write_text(
        f"---\nname: {name}\ndescription: {name} description\n---\n\n{body}\n",
        encoding="utf-8",
    )


def _make_lead_agent_request(
    *,
    agent_status: str = "dev",
) -> lead_agent_module.LeadAgentRequest:
    return lead_agent_module.LeadAgentRequest(
        thinking_enabled=None,
        reasoning_effort=None,
        requested_model_name=None,
        is_plan_mode=None,
        subagent_enabled=None,
        max_concurrent_subagents=None,
        command_name=None,
        command_kind=None,
        command_args=None,
        command_prompt=None,
        authoring_actions=(),
        target_agent_name=None,
        agent_name=LEAD_AGENT_NAME,
        agent_status=agent_status,
        thread_id="thread-1",
        user_id=None,
        runtime_model_name=None,
        header_model_name=None,
        execution_backend=None,
        remote_session_id=None,
    )


class _FakeDeepAgentGraph:
    def with_config(self, _config):
        return self


def test_build_backend_sets_thread_user_data_as_shell_cwd(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    user_data_dir = paths.sandbox_user_data_dir("thread-1")
    assert isinstance(backend, CompositeBackend)
    assert backend.default.cwd == user_data_dir.resolve()
    assert "/mnt/skills/" in backend.routes
    assert "/large_tool_results/" in backend.routes
    assert "/conversation_history/" in backend.routes
    assert "/mnt/user-data/tmp" in backend.routes


def test_build_backend_sets_default_user_data_as_shell_cwd_when_thread_missing(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend(None, agent_name=None)

    default_user_data_dir = base_dir / "threads" / "_default" / "user-data"
    assert isinstance(backend, CompositeBackend)
    assert backend.default.cwd == default_user_data_dir.resolve()


def test_build_backend_default_agent_seeds_archived_agent_tree_into_thread_runtime(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap skill")
    _write_archived_skill(base_dir, "surprise-me", body="surprise skill")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    runtime_agent_root = lead_agent_module._runtime_agent_root(LEAD_AGENT_NAME, "dev")
    responses = backend.download_files(
        [
            f"{runtime_agent_root}/AGENTS.md",
            f"{runtime_agent_root}/config.yaml",
            f"{runtime_agent_root}/skills/bootstrap/SKILL.md",
        ]
    )
    assert b"Lead Agent" in responses[0].content
    assert b"skill_refs" in responses[1].content
    assert b"bootstrap skill" in responses[2].content
    assert b"surprise-me" not in responses[1].content


def test_build_backend_routes_shared_skills_into_local_debug_backend(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    shared_skill = backend.download_files(["/mnt/skills/system/skills/bootstrap/SKILL.md"])[0]

    assert shared_skill.error is None
    assert shared_skill.content is not None
    assert b"bootstrap" in shared_skill.content


def test_build_backend_execute_rewrites_runtime_skill_aliases(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    assert isinstance(backend, CompositeBackend)
    result = backend.default.execute("test -f /agents/dev/lead_agent/skills/bootstrap/SKILL.md && echo ok")

    assert result.exit_code == 0, result.output
    assert "ok" in result.output


def test_build_backend_named_agent_seeds_agent_definition_into_thread_runtime(tmp_path):
    base_dir = tmp_path / ".openagents"
    agent_dir = base_dir / "custom" / "agents" / "prod" / "analyst"
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


def test_create_agent_request_seeds_existing_target_archive_into_thread_runtime(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    target_agent_dir = base_dir / "custom" / "agents" / "dev" / "landing-copy-agent-0318"
    target_agent_dir.mkdir(parents=True, exist_ok=True)
    (target_agent_dir / "AGENTS.md").write_text("You write landing page copy.", encoding="utf-8")
    (target_agent_dir / "config.yaml").write_text(
        "name: landing-copy-agent-0318\n"
        "status: dev\n"
        "description: Writes landing page copy\n"
        "agents_md_path: AGENTS.md\n"
        "skill_refs: []\n",
        encoding="utf-8",
    )
    paths = _make_paths(base_dir)

    request = lead_agent_module.LeadAgentRequest(
        thinking_enabled=None,
        reasoning_effort=None,
        requested_model_name=None,
        is_plan_mode=None,
        subagent_enabled=None,
        max_concurrent_subagents=None,
        command_name="create-agent",
        command_kind="soft",
        command_args="请更新 landing-copy-agent-0318",
        command_prompt="先检查已有归档，再修复。",
        authoring_actions=("setup_agent",),
        target_agent_name="landing-copy-agent-0318",
        agent_name=LEAD_AGENT_NAME,
        agent_status="dev",
        thread_id="thread-1",
        user_id=None,
        runtime_model_name=None,
        header_model_name=None,
        execution_backend=None,
        remote_session_id=None,
    )

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)
        lead_agent_module._seed_create_agent_target_runtime_materials_if_available(
            backend,
            request=request,
        )

    runtime_agent_root = lead_agent_module._runtime_agent_root("landing-copy-agent-0318", "dev")
    response = backend.download_files([f"{runtime_agent_root}/AGENTS.md"])[0]

    assert response.content == b"You write landing page copy."


def test_create_agent_request_ignores_missing_target_archive_for_new_agent(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    request = lead_agent_module.LeadAgentRequest(
        thinking_enabled=None,
        reasoning_effort=None,
        requested_model_name=None,
        is_plan_mode=None,
        subagent_enabled=None,
        max_concurrent_subagents=None,
        command_name="create-agent",
        command_kind="soft",
        command_args="请创建 pw-new-agent",
        command_prompt="创建新 agent。",
        authoring_actions=("setup_agent",),
        target_agent_name="pw-new-agent",
        agent_name=LEAD_AGENT_NAME,
        agent_status="dev",
        thread_id="thread-1",
        user_id=None,
        runtime_model_name=None,
        header_model_name=None,
        execution_backend=None,
        remote_session_id=None,
    )

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)
        lead_agent_module._seed_create_agent_target_runtime_materials_if_available(
            backend,
            request=request,
        )

    runtime_agent_root = lead_agent_module._runtime_agent_root("pw-new-agent", "dev")
    response = backend.download_files([f"{runtime_agent_root}/AGENTS.md"])[0]

    assert response.error == "file_not_found"


def test_build_backend_dev_lead_agent_does_not_seed_store_skills_without_explicit_references(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    _write_archived_skill(base_dir, "surprise-me", body="surprise")
    _write_archived_skill(base_dir, "copywriting", category="store/dev", body="copywriting")
    _write_archived_skill(base_dir, "contract-review", category="store/prod", body="review")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    runtime_agent_root = lead_agent_module._runtime_agent_root(LEAD_AGENT_NAME, "dev")
    responses = backend.download_files(
        [
            f"{runtime_agent_root}/skills/surprise-me/SKILL.md",
            f"{runtime_agent_root}/skills/copywriting/SKILL.md",
            f"{runtime_agent_root}/skills/contract-review/SKILL.md",
        ]
    )

    assert responses[0].error == "file_not_found"
    assert responses[1].error == "file_not_found"
    assert responses[2].error == "file_not_found"


def test_build_backend_supports_store_prod_skill_refs(tmp_path):
    base_dir = tmp_path / ".openagents"
    agent_dir = base_dir / "custom" / "agents" / "prod" / "reviewer"
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
    agent_dir = base_dir / "custom" / "agents" / "dev" / "analyst"
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
    monkeypatch.setattr("src.runtime_backends.sandbox.resolve_config_sandbox_provider", lambda: None)

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
    paths = Paths(base_dir="/tmp/openagents", skills_dir="/tmp/openagents")
    monkeypatch.setenv("OPENAGENTS_SANDBOX_PROVIDER", "src.community.aio_sandbox:AioSandboxProvider")
    monkeypatch.setattr("src.runtime_backends.sandbox.get_sandbox_provider", lambda provider_path: provider)

    backend = lead_agent_module._build_workspace_backend(
        user_data_dir="/tmp/runtime",
        thread_id="thread-1",
        paths=paths,
    )

    assert isinstance(backend, CompositeBackend)
    assert backend.default is provider.sandbox
    assert provider.thread_id == "thread-1"
    assert backend.routes["/large_tool_results/"].cwd == Path("/tmp/runtime/outputs/.large_tool_results").resolve()
    assert backend.routes["/conversation_history/"].cwd == Path("/tmp/runtime/outputs/.conversation_history").resolve()
    assert backend.routes["/mnt/user-data/tmp"].cwd == paths.runtime_tmp_dir.resolve()


def test_build_backend_routes_internal_agent_spill_files_into_thread_outputs(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend("thread-1", agent_name=None)

    large_result = backend.write("/large_tool_results/tool-1", "large result payload")
    history_result = backend.write("/conversation_history/thread-1.md", "history payload")

    user_data_dir = paths.sandbox_user_data_dir("thread-1")
    assert large_result.error is None
    assert history_result.error is None
    assert (user_data_dir / "outputs" / ".large_tool_results" / "tool-1").read_text(encoding="utf-8") == "large result payload"
    assert (user_data_dir / "outputs" / ".conversation_history" / "thread-1.md").read_text(encoding="utf-8") == "history payload"


def test_build_backend_uses_remote_backend_when_requested(monkeypatch, tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)
    captured: dict[str, str] = {}

    class DummyRemoteBackend:
        def download_files(self, requested_paths):
            return [type("Response", (), {"path": path, "content": None, "error": "file_not_found"})() for path in requested_paths]

        def upload_files(self, files):
            return [type("Response", (), {"path": path, "error": None})() for path, _ in files]

    remote_backend = DummyRemoteBackend()

    def fake_build_remote_workspace_backend(*, session_id: str, paths: Paths | None = None):
        captured["session_id"] = session_id
        assert paths is not None
        return remote_backend

    monkeypatch.setattr(
        "src.runtime_backends.factory.build_remote_workspace_backend",
        fake_build_remote_workspace_backend,
    )

    with patch("src.agents.lead_agent.agent.get_paths", return_value=paths):
        backend = lead_agent_module.build_backend(
            "thread-1",
            agent_name=None,
            execution_backend="remote",
            remote_session_id="remote-session-1",
        )

    assert getattr(backend, "__wrapped_backend__", backend) is remote_backend
    assert captured["session_id"] == "remote-session-1"


def test_build_backend_remote_requires_session_id(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)

    with (
        patch("src.agents.lead_agent.agent.get_paths", return_value=paths),
        patch("src.runtime_backends.factory.build_remote_workspace_backend"),
    ):
        try:
            lead_agent_module.build_backend(
                "thread-1",
                agent_name=None,
                execution_backend="remote",
            )
        except ValueError as exc:
            assert "remote_session_id" in str(exc)
        else:
            raise AssertionError("Expected ValueError when remote_session_id is missing.")


def test_openagents_middlewares_include_artifacts_state():
    model_config = ModelConfig(
        name="test-model",
        use="langchain_openai.ChatOpenAI",
        model="gpt-test",
        supports_thinking=True,
        supports_vision=False,
    )

    middlewares = lead_agent_module._build_openagents_middlewares(model_config)
    schemas = [getattr(mw.__class__, "state_schema", None) for mw in middlewares]
    assert any(
        schema is not None and "artifacts" in getattr(schema, "__annotations__", {})
        for schema in schemas
    )


def test_create_lead_agent_deduplicates_concurrent_graph_builds(tmp_path):
    base_dir = tmp_path / ".openagents"
    _write_archived_skill(base_dir, "bootstrap", body="bootstrap")
    paths = _make_paths(base_dir)
    model_config = ModelConfig(
        name="test-model",
        use="langchain_openai.ChatOpenAI",
        model="gpt-test",
        supports_thinking=True,
        supports_vision=False,
    )

    class DummyDBStore:
        def get_thread_binding(self, thread_id):
            return None

        def get_model(self, name):
            assert name == "test-model"
            return model_config

    build_started = Event()
    allow_finish = Event()
    created_graphs: list[object] = []

    def fake_create_deep_agent(**kwargs):
        graph = _FakeDeepAgentGraph()
        created_graphs.append(graph)
        build_started.set()
        assert allow_finish.wait(timeout=5)
        return graph

    config = {"configurable": {"agent_status": "dev", "model_name": "test-model"}}

    with (
        patch("src.agents.lead_agent.agent.get_paths", return_value=paths),
        patch("src.agents.lead_agent.agent.get_runtime_db_store", return_value=DummyDBStore()),
        patch("src.agents.lead_agent.agent._build_openagents_middlewares", return_value=[]),
        patch("src.agents.lead_agent.agent._load_agent_tools", return_value=[]),
        patch("src.agents.lead_agent.agent.create_chat_model", return_value=object()),
        patch("src.agents.lead_agent.agent.create_deep_agent", side_effect=fake_create_deep_agent),
    ):
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(
                lead_agent_module._create_lead_agent,
                config,
                None,
                prepare_runtime_resources=False,
            )
            assert build_started.wait(timeout=5)

            second = pool.submit(
                lead_agent_module._create_lead_agent,
                config,
                None,
                prepare_runtime_resources=False,
            )

            allow_finish.set()
            first_graph = first.result(timeout=5)
            second_graph = second.result(timeout=5)

    assert len(created_graphs) == 1
    assert first_graph is second_graph


def test_non_lead_dev_request_allows_setup_agent_for_self_updates():
    request = lead_agent_module.LeadAgentRequest(
        thinking_enabled=None,
        reasoning_effort=None,
        requested_model_name=None,
        is_plan_mode=None,
        subagent_enabled=None,
        max_concurrent_subagents=None,
        command_name=None,
        command_kind=None,
        command_args=None,
        command_prompt=None,
        authoring_actions=(),
        target_agent_name=None,
        agent_name="contract-reviewer",
        agent_status="dev",
        thread_id="thread-1",
        user_id=None,
        runtime_model_name=None,
        header_model_name=None,
        execution_backend=None,
        remote_session_id=None,
    )

    assert request.allows_agent_setup() is True


def test_lead_agent_dev_request_allows_setup_agent_for_generic_authoring():
    request = lead_agent_module.LeadAgentRequest(
        thinking_enabled=None,
        reasoning_effort=None,
        requested_model_name=None,
        is_plan_mode=None,
        subagent_enabled=None,
        max_concurrent_subagents=None,
        command_name=None,
        command_kind=None,
        command_args=None,
        command_prompt=None,
        authoring_actions=(),
        target_agent_name=None,
        agent_name="lead_agent",
        agent_status="dev",
        thread_id="thread-1",
        user_id=None,
        runtime_model_name=None,
        header_model_name=None,
        execution_backend=None,
        remote_session_id=None,
    )

    assert request.allows_agent_setup() is True
    assert request.always_available_tool_names() == (
        "install_skill_from_registry",
        "save_skill_to_store",
        "setup_agent",
    )
    assert request.always_available_authoring_actions() == ("save_skill_to_store",)


def test_prod_agent_request_does_not_allow_self_setup_agent():
    request = lead_agent_module.LeadAgentRequest(
        thinking_enabled=None,
        reasoning_effort=None,
        requested_model_name=None,
        is_plan_mode=None,
        subagent_enabled=None,
        max_concurrent_subagents=None,
        command_name=None,
        command_kind=None,
        command_args=None,
        command_prompt=None,
        authoring_actions=(),
        target_agent_name=None,
        agent_name="contract-reviewer",
        agent_status="prod",
        thread_id="thread-1",
        user_id=None,
        runtime_model_name=None,
        header_model_name=None,
        execution_backend=None,
        remote_session_id=None,
    )

    assert request.allows_agent_setup() is False
