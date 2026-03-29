"""Tests for lead agent runtime model resolution behavior."""

from __future__ import annotations

import asyncio

import pytest

from src.agents.lead_agent import agent as lead_agent_module
from src.config.builtin_agents import LEAD_AGENT_NAME
from src.config.model_config import ModelConfig
from src.config.paths import Paths


class _FakeDBStore:
    def __init__(
        self,
        *,
        models: dict[str, ModelConfig],
        thread_models: dict[tuple[str, str], str] | None = None,
        thread_owners: dict[str, str] | None = None,
    ):
        self.models = models
        self.thread_models = thread_models or {}
        self.thread_owners = thread_owners or {}
        self.saved: list[tuple[str, str, str, str | None]] = []

    def get_model(self, name: str) -> ModelConfig | None:
        return self.models.get(name)

    def get_any_enabled_model(self) -> ModelConfig | None:
        for name in sorted(self.models):
            return self.models[name]
        return None

    def list_enabled_model_names(self) -> list[str]:
        return sorted(self.models)

    def get_thread_runtime_model(self, *, thread_id: str, user_id: str) -> str | None:
        return self.thread_models.get((thread_id, user_id))

    def get_thread_runtime_owner(self, thread_id: str) -> str | None:
        for (tid, uid), _model in self.thread_models.items():
            if tid == thread_id:
                return uid
        return None

    def get_thread_owner(self, thread_id: str) -> str | None:
        return self.thread_owners.get(thread_id)

    def get_thread_binding(self, thread_id: str):
        owner = self.thread_owners.get(thread_id)
        if owner is None:
            owner = self.get_thread_runtime_owner(thread_id)
        if owner is None:
            return None

        model_name = None
        for (tid, uid), bound_model in self.thread_models.items():
            if tid == thread_id and uid == owner:
                model_name = bound_model
                break

        agent_name = None
        for saved_thread_id, saved_user_id, _saved_model_name, saved_agent_name in reversed(self.saved):
            if saved_thread_id == thread_id and saved_user_id == owner:
                agent_name = saved_agent_name
                break

        return lead_agent_module.ThreadBinding(
            thread_id=thread_id,
            user_id=owner,
            agent_name=agent_name,
            agent_status="dev",
            assistant_id=agent_name,
            model_name=model_name,
            execution_backend=None,
            remote_session_id=None,
            title=None,
        )

    def claim_thread_ownership(self, *, thread_id: str, user_id: str, assistant_id: str | None) -> None:
        existing = self.thread_owners.get(thread_id)
        if existing is None:
            self.thread_owners[thread_id] = user_id
            return
        if existing != user_id:
            raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({existing}).")

    def assert_thread_access(self, *, thread_id: str, user_id: str) -> None:
        owner = self.get_thread_owner(thread_id)
        if owner is not None and owner != user_id:
            raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({owner}).")
        runtime_owner = self.get_thread_runtime_owner(thread_id)
        if runtime_owner is not None and runtime_owner != user_id:
            raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({runtime_owner}).")

    def save_thread_runtime(
        self,
        *,
        thread_id: str,
        user_id: str,
        model_name: str,
        agent_name: str | None,
        agent_status: str,
        execution_backend: str | None,
        remote_session_id: str | None,
    ) -> None:
        self.claim_thread_ownership(thread_id=thread_id, user_id=user_id, assistant_id=agent_name)
        for tid, uid in self.thread_models.keys():
            if tid == thread_id and uid != user_id:
                raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({uid}).")
        self.saved.append((thread_id, user_id, model_name, agent_name))
        self.thread_models[(thread_id, user_id)] = model_name

    def save_thread_runtime_if_needed(
        self,
        *,
        thread_id: str,
        user_id: str,
        model_name: str,
        agent_name: str | None,
        agent_status: str,
        execution_backend: str | None,
        remote_session_id: str | None,
    ) -> bool:
        binding = self.get_thread_binding(thread_id)
        if binding is not None and binding.user_id != user_id:
            raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({binding.user_id}).")
        if binding is not None and binding.user_id == user_id and binding.model_name == model_name and binding.agent_name == agent_name:
            return False

        self.save_thread_runtime(
            thread_id=thread_id,
            user_id=user_id,
            model_name=model_name,
            agent_name=agent_name,
            agent_status=agent_status,
            execution_backend=execution_backend,
            remote_session_id=remote_session_id,
        )
        return True


def _make_model(name: str, *, supports_thinking: bool, supports_vision: bool = False) -> ModelConfig:
    return ModelConfig(
        name=name,
        display_name=name,
        description=None,
        use="langchain_openai:ChatOpenAI",
        model=name,
        supports_thinking=supports_thinking,
        supports_vision=supports_vision,
    )


def _make_agent_config(
    *,
    name: str = LEAD_AGENT_NAME,
    model: str | None = None,
) -> lead_agent_module.AgentConfig:
    return lead_agent_module.AgentConfig(
        name=name,
        status="dev",
        model=model,
        tool_groups=[],
        mcp_servers=[],
    )


def test_parse_runtime_model_config_requires_name_field():
    with pytest.raises(ValueError, match="model_config.name"):
        lead_agent_module._parse_runtime_model_config({"use": "langchain_openai:ChatOpenAI"})


def test_resolve_run_model_uses_requested_model_name():
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    model_name, model_config = lead_agent_module._resolve_run_model(
        requested_model_name="safe-model",
        runtime_model_name=None,
        header_model_name=None,
        agent_config=None,
        thread_binding=None,
        thread_id=None,
        db_store=store,
    )

    assert model_name == "safe-model"
    assert model_config.name == "safe-model"


def test_resolve_run_model_uses_persisted_thread_runtime_model():
    store = _FakeDBStore(
        models={"thread-model": _make_model("thread-model", supports_thinking=True)},
        thread_models={("thread-1", "user-1"): "thread-model"},
    )

    model_name, model_config = lead_agent_module._resolve_run_model(
        requested_model_name=None,
        runtime_model_name=None,
        header_model_name=None,
        agent_config=None,
        thread_binding=store.get_thread_binding("thread-1"),
        thread_id="thread-1",
        db_store=store,
    )

    assert model_name == "thread-model"
    assert model_config.name == "thread-model"


def test_resolve_run_model_raises_when_persisted_thread_model_is_unavailable():
    store = _FakeDBStore(
        models={"safe-model": _make_model("safe-model", supports_thinking=True)},
        thread_models={("thread-1", "user-1"): "missing-model"},
    )

    with pytest.raises(ValueError, match="Resolved model 'missing-model'"):
        lead_agent_module._resolve_run_model(
            requested_model_name=None,
            runtime_model_name=None,
            header_model_name=None,
            agent_config=None,
            thread_binding=store.get_thread_binding("thread-1"),
            thread_id="thread-1",
            db_store=store,
        )


def test_resolve_run_model_raises_when_no_model_is_bound():
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    with pytest.raises(ValueError, match="No model resolved"):
        lead_agent_module._resolve_run_model(
            requested_model_name=None,
            runtime_model_name=None,
            header_model_name=None,
            agent_config=None,
            thread_binding=None,
            thread_id="thread-new",
            db_store=store,
        )


def test_resolve_run_model_raises_for_conflicting_requested_and_agent_model():
    store = _FakeDBStore(models={"agent-model": _make_model("agent-model", supports_thinking=True)})

    with pytest.raises(ValueError, match="Model conflict"):
        lead_agent_module._resolve_run_model(
            requested_model_name="other-model",
            runtime_model_name=None,
            header_model_name=None,
            agent_config=lead_agent_module.AgentConfig(
                name="agent-a",
                status="dev",
                model="agent-model",
                tool_groups=[],
                mcp_servers=[],
            ),
            thread_binding=None,
            thread_id=None,
            db_store=store,
        )


def test_resolve_run_model_raises_when_model_unavailable():
    store = _FakeDBStore(models={})

    with pytest.raises(ValueError, match="No model resolved for this run"):
        lead_agent_module._resolve_run_model(
            requested_model_name=None,
            runtime_model_name=None,
            header_model_name=None,
            agent_config=None,
            thread_binding=None,
            thread_id=None,
            db_store=store,
        )


def test_resolve_run_model_uses_request_header_model_for_unbound_thread_reads():
    store = _FakeDBStore(
        models={"header-model": _make_model("header-model", supports_thinking=True)},
    )

    model_name, model_config = lead_agent_module._resolve_run_model(
        requested_model_name=None,
        runtime_model_name=None,
        header_model_name="header-model",
        agent_config=None,
        thread_binding=None,
        thread_id="thread-1",
        db_store=store,
    )

    assert model_name == "header-model"
    assert model_config.name == "header-model"


def test_resolve_run_model_prefers_persisted_thread_model_over_request_header_model():
    store = _FakeDBStore(
        models={
            "thread-model": _make_model("thread-model", supports_thinking=True),
            "header-model": _make_model("header-model", supports_thinking=True),
        },
        thread_models={("thread-1", "user-1"): "thread-model"},
    )

    model_name, model_config = lead_agent_module._resolve_run_model(
        requested_model_name=None,
        runtime_model_name=None,
        header_model_name="header-model",
        agent_config=None,
        thread_binding=store.get_thread_binding("thread-1"),
        thread_id="thread-1",
        db_store=store,
    )

    assert model_name == "thread-model"
    assert model_config.name == "thread-model"


def test_resolve_run_model_ignores_stale_request_header_model_for_bound_thread_agent():
    store = _FakeDBStore(
        models={
            "thread-model": _make_model("thread-model", supports_thinking=True),
            "header-model": _make_model("header-model", supports_thinking=True),
        },
        thread_models={("thread-1", "user-1"): "thread-model"},
    )

    model_name, model_config = lead_agent_module._resolve_run_model(
        requested_model_name=None,
        runtime_model_name=None,
        header_model_name="header-model",
        agent_config=_make_agent_config(model="thread-model"),
        thread_binding=store.get_thread_binding("thread-1"),
        thread_id="thread-1",
        db_store=store,
    )

    assert model_name == "thread-model"
    assert model_config.name == "thread-model"


def test_resolve_run_model_raises_for_conflicting_requested_and_header_models():
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    with pytest.raises(ValueError, match="`configurable.model_name` and `x-model-name` must match"):
        lead_agent_module._resolve_run_model(
            requested_model_name="safe-model",
            runtime_model_name=None,
            header_model_name="other-model",
            agent_config=None,
            thread_binding=None,
            thread_id="thread-1",
            db_store=store,
        )


def test_make_lead_agent_reads_runtime_context_and_persists_thread_runtime(monkeypatch, tmp_path):
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    import src.tools as tools_module

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills"),
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda thread_id, agent_name, status="dev", agent_config=None, **kwargs: None,
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "prompt")
    monkeypatch.setattr(lead_agent_module, "create_deep_agent", lambda **kwargs: kwargs)

    captured: dict[str, object] = {}

    def _fake_create_chat_model(*, name, thinking_enabled, reasoning_effort=None, runtime_model_config=None):
        captured["name"] = name
        captured["thinking_enabled"] = thinking_enabled
        captured["runtime_model_config"] = runtime_model_config
        return object()

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)

    class _ExecutionRuntime:
        def __init__(self, context):
            self.context = context

    class _Runtime:
        def __init__(self, context):
            self.execution_runtime = _ExecutionRuntime(context)

    runtime = _Runtime(
        {
            "model_name": "safe-model",
            "thinking_enabled": True,
            "subagent_enabled": False,
        }
    )

    result = asyncio.run(
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "thread_id": "thread-1",
                    "user_id": "user-1",
                }
            },
            runtime=runtime,
        )
    )

    assert captured["name"] == "safe-model"
    assert captured["thinking_enabled"] is True
    assert result["model"] is not None
    assert "memory" not in result
    assert result["context_schema"] is lead_agent_module.LeadAgentRuntimeContext
    assert "interrupt_on" not in result
    assert store.saved == [("thread-1", "user-1", "safe-model", LEAD_AGENT_NAME)]
    assert runtime.execution_runtime.context["thread_id"] == "thread-1"
    assert runtime.execution_runtime.context["x-thread-id"] == "thread-1"
    assert "x_thread_id" not in runtime.execution_runtime.context
    assert "x_user_id" not in runtime.execution_runtime.context


def test_make_lead_agent_uses_request_header_model_for_thread_state_reads(monkeypatch, tmp_path):
    store = _FakeDBStore(
        models={"header-model": _make_model("header-model", supports_thinking=True)},
    )

    import src.tools as tools_module

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills"),
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda thread_id, agent_name, status="dev", agent_config=None, **kwargs: None,
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "prompt")
    monkeypatch.setattr(lead_agent_module, "create_deep_agent", lambda **kwargs: kwargs)

    captured: dict[str, object] = {}

    def _fake_create_chat_model(*, name, thinking_enabled, reasoning_effort=None, runtime_model_config=None):
        captured["name"] = name
        captured["thinking_enabled"] = thinking_enabled
        captured["runtime_model_config"] = runtime_model_config
        return object()

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)

    class _ExecutionRuntime:
        def __init__(self, context):
            self.context = context

    class _Runtime:
        def __init__(self, context):
            self.execution_runtime = _ExecutionRuntime(context)

    runtime = _Runtime(
        {
            "x-model-name": "header-model",
            "x-agent-name": "lead_agent",
            "x-agent-status": "dev",
            "thinking_enabled": True,
            "subagent_enabled": False,
        }
    )

    asyncio.run(
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "thread_id": "thread-1",
                    "user_id": "user-1",
                }
            },
            runtime=runtime,
        )
    )

    assert captured["name"] == "header-model"
    assert captured["thinking_enabled"] is True
    assert store.saved == [("thread-1", "user-1", "header-model", LEAD_AGENT_NAME)]
    assert runtime.execution_runtime.context["x-model-name"] == "header-model"


def test_resolve_lead_agent_runtime_uses_persisted_thread_agent_runtime(monkeypatch):
    store = _FakeDBStore(
        models={"safe-model": _make_model("safe-model", supports_thinking=True)},
    )

    persisted_binding = lead_agent_module.ThreadBinding(
        thread_id="thread-1",
        user_id="user-1",
        agent_name="reviewer",
        agent_status="prod",
        assistant_id="reviewer",
        model_name="safe-model",
        execution_backend="remote",
        remote_session_id="remote-session-1",
        title=None,
    )
    monkeypatch.setattr(store, "get_thread_binding", lambda _thread_id: persisted_binding)

    captured_save: dict[str, object] = {}

    def _fake_save_thread_runtime_if_needed(**kwargs):
        captured_save.update(kwargs)
        return False

    monkeypatch.setattr(store, "save_thread_runtime_if_needed", _fake_save_thread_runtime_if_needed)
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(name=kwargs["agent_name"]),
    )

    effective_request, resolution = lead_agent_module._resolve_lead_agent_runtime(
        request=lead_agent_module.LeadAgentRequest(
            thinking_enabled=True,
            reasoning_effort="high",
            requested_model_name=None,
            subagent_enabled=False,
            max_concurrent_subagents=3,
            command_name=None,
            command_kind=None,
            command_args=None,
            command_prompt=None,
            authoring_actions=(),
            target_agent_name=None,
            target_skill_name=None,
            agent_name=LEAD_AGENT_NAME,
            agent_status="dev",
            thread_id="thread-1",
            user_id="user-1",
            runtime_model_name=None,
            header_model_name=None,
            execution_backend=None,
            remote_session_id=None,
        ),
        db_store=store,
        persist_thread_runtime=True,
    )

    assert effective_request.agent_name == "reviewer"
    assert effective_request.agent_status == "prod"
    assert effective_request.execution_backend == "remote"
    assert effective_request.remote_session_id == "remote-session-1"
    assert resolution.agent_config.name == "reviewer"
    assert captured_save["agent_name"] == "reviewer"
    assert captured_save["agent_status"] == "prod"
    assert captured_save["execution_backend"] == "remote"
    assert captured_save["remote_session_id"] == "remote-session-1"


def test_build_openagents_middlewares_includes_vision_middleware_for_vision_model():
    middlewares = lead_agent_module._build_openagents_middlewares(_make_model("vision-model", supports_thinking=False, supports_vision=True))

    from langchain.agents.middleware import ModelRetryMiddleware, ToolRetryMiddleware

    from src.agents.middlewares.max_tokens_recovery_middleware import MaxTokensRecoveryMiddleware
    from src.agents.middlewares.question_discipline_middleware import QuestionDisciplineMiddleware
    from src.agents.middlewares.view_image_middleware import ViewImageMiddleware
    from src.agents.middlewares.visible_response_recovery_middleware import VisibleResponseRecoveryMiddleware

    assert any(isinstance(m, ModelRetryMiddleware) for m in middlewares)
    assert any(isinstance(m, ToolRetryMiddleware) for m in middlewares)
    assert any(isinstance(m, MaxTokensRecoveryMiddleware) for m in middlewares)
    assert any(isinstance(m, QuestionDisciplineMiddleware) for m in middlewares)
    assert any(isinstance(m, VisibleResponseRecoveryMiddleware) for m in middlewares)
    assert any(isinstance(m, ViewImageMiddleware) for m in middlewares)


def test_build_openagents_middlewares_excludes_vision_middleware_for_non_vision_model():
    middlewares = lead_agent_module._build_openagents_middlewares(_make_model("text-model", supports_thinking=False, supports_vision=False))

    from langchain.agents.middleware import ModelRetryMiddleware, ToolRetryMiddleware

    from src.agents.middlewares.max_tokens_recovery_middleware import MaxTokensRecoveryMiddleware
    from src.agents.middlewares.question_discipline_middleware import QuestionDisciplineMiddleware
    from src.agents.middlewares.view_image_middleware import ViewImageMiddleware
    from src.agents.middlewares.visible_response_recovery_middleware import VisibleResponseRecoveryMiddleware

    assert any(isinstance(m, ModelRetryMiddleware) for m in middlewares)
    assert any(isinstance(m, ToolRetryMiddleware) for m in middlewares)
    assert any(isinstance(m, MaxTokensRecoveryMiddleware) for m in middlewares)
    assert any(isinstance(m, QuestionDisciplineMiddleware) for m in middlewares)
    assert any(isinstance(m, VisibleResponseRecoveryMiddleware) for m in middlewares)
    assert not any(isinstance(m, ViewImageMiddleware) for m in middlewares)


def test_make_lead_agent_reuses_cached_graph_for_identical_request(monkeypatch, tmp_path):
    lead_agent_module._clear_lead_agent_graph_cache()
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    import src.tools as tools_module

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills"),
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda thread_id, agent_name, status="dev", agent_config=None, **kwargs: {"thread_id": thread_id},
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "prompt")
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    create_calls: list[dict[str, object]] = []

    def _fake_create_deep_agent(**kwargs):
        create_calls.append(kwargs)
        return {"graph_id": len(create_calls)}

    monkeypatch.setattr(lead_agent_module, "create_deep_agent", _fake_create_deep_agent)

    config = {
        "configurable": {
            "thread_id": "thread-1",
            "user_id": "user-1",
            "model_name": "safe-model",
            "thinking_enabled": True,
            "subagent_enabled": False,
        }
    }

    first = asyncio.run(lead_agent_module.make_lead_agent(config, runtime=None))
    second = asyncio.run(lead_agent_module.make_lead_agent(config, runtime=None))

    assert first is second
    assert len(create_calls) == 1
    assert store.saved == [("thread-1", "user-1", "safe-model", LEAD_AGENT_NAME)]


def test_make_lead_agent_rebuilds_cached_graph_when_model_config_changes(monkeypatch, tmp_path):
    lead_agent_module._clear_lead_agent_graph_cache()
    store = _FakeDBStore(
        models={
            "safe-model": ModelConfig.model_validate(
                {
                    "name": "safe-model",
                    "display_name": "safe-model",
                    "description": None,
                    "use": "langchain_anthropic:ChatAnthropic",
                    "model": "safe-model",
                    "api_key": "token-a",
                    "base_url": "http://gateway-a.invalid",
                    "supports_thinking": True,
                }
            )
        }
    )

    import src.tools as tools_module

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills"),
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda thread_id, agent_name, status="dev", agent_config=None, **kwargs: {"thread_id": thread_id},
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "prompt")
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    create_calls: list[dict[str, object]] = []

    def _fake_create_deep_agent(**kwargs):
        create_calls.append(kwargs)
        return {"graph_id": len(create_calls)}

    monkeypatch.setattr(lead_agent_module, "create_deep_agent", _fake_create_deep_agent)

    config = {
        "configurable": {
            "thread_id": "thread-1",
            "user_id": "user-1",
            "model_name": "safe-model",
            "thinking_enabled": True,
            "subagent_enabled": False,
        }
    }

    first = asyncio.run(lead_agent_module.make_lead_agent(config, runtime=None))

    store.models["safe-model"] = ModelConfig.model_validate(
        {
            "name": "safe-model",
            "display_name": "safe-model",
            "description": None,
            "use": "langchain_anthropic:ChatAnthropic",
            "model": "safe-model",
            "api_key": "token-b",
            "base_url": "http://gateway-b.invalid",
            "supports_thinking": True,
        }
    )

    second = asyncio.run(lead_agent_module.make_lead_agent(config, runtime=None))

    assert first is not second
    assert len(create_calls) == 2


def test_make_lead_agent_reuses_read_only_graph_across_threads(monkeypatch, tmp_path):
    lead_agent_module._clear_lead_agent_graph_cache()
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    import src.tools as tools_module

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills"),
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "_build_local_workspace_backend",
        lambda user_data_dir, shared_skills_mount=None: {"user_data_dir": user_data_dir},
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "prompt")
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    create_calls: list[dict[str, object]] = []

    def _fake_create_deep_agent(**kwargs):
        create_calls.append(kwargs)
        return {"graph_id": len(create_calls)}

    monkeypatch.setattr(lead_agent_module, "create_deep_agent", _fake_create_deep_agent)

    class _Runtime:
        execution_runtime = None

    first = asyncio.run(
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "thread_id": "thread-1",
                    "user_id": "user-1",
                    "model_name": "safe-model",
                }
            },
            runtime=_Runtime(),
        )
    )
    second = asyncio.run(
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "thread_id": "thread-2",
                    "user_id": "user-2",
                    "model_name": "safe-model",
                }
            },
            runtime=_Runtime(),
        )
    )

    assert first is second
    assert len(create_calls) == 1


def test_make_lead_agent_rejects_cross_user_thread_access(monkeypatch):
    store = _FakeDBStore(
        models={"safe-model": _make_model("safe-model", supports_thinking=True)},
        thread_owners={"thread-1": "user-owner"},
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)

    with pytest.raises(ValueError, match="Thread access denied"):
        asyncio.run(
            lead_agent_module.make_lead_agent(
                {
                    "configurable": {
                        "thread_id": "thread-1",
                        "user_id": "user-other",
                        "model_name": "safe-model",
                    }
                },
                runtime=None,
            )
        )


def test_make_lead_agent_accepts_header_injected_user_id(monkeypatch, tmp_path):
    store = _FakeDBStore(
        models={"thread-model": _make_model("thread-model", supports_thinking=True)},
        thread_models={("thread-1", "user-1"): "thread-model"},
    )

    import src.tools as tools_module

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills"),
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda thread_id, agent_name, status="dev", agent_config=None, **kwargs: None,
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "prompt")
    monkeypatch.setattr(lead_agent_module, "create_deep_agent", lambda **kwargs: kwargs)
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    result = asyncio.run(
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "thread_id": "thread-1",
                    "x-user-id": "user-1",
                    "thinking_enabled": True,
                    "subagent_enabled": False,
                }
            },
            runtime=None,
        )
    )

    assert result["model"] is not None
    assert store.saved == [("thread-1", "user-1", "thread-model", LEAD_AGENT_NAME)]


def test_make_lead_agent_requires_user_for_thread_scoped_requests(monkeypatch):
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)

    with pytest.raises(ValueError, match="Thread-scoped requests require user identity"):
        asyncio.run(
            lead_agent_module.make_lead_agent(
                {
                    "configurable": {
                        "thread_id": "thread-1",
                        "model_name": "safe-model",
                    }
                },
                runtime=None,
            )
        )


def test_make_lead_agent_skips_runtime_seeding_for_read_context(monkeypatch, tmp_path):
    lead_agent_module._clear_lead_agent_graph_cache()
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    import src.tools as tools_module

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills"),
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("build_backend should not run in read context")),
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "prompt")
    monkeypatch.setattr(lead_agent_module, "create_deep_agent", lambda **kwargs: kwargs)
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    class _Runtime:
        execution_runtime = None
        user = None

    result = asyncio.run(
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "model_name": "safe-model",
                }
            },
            runtime=_Runtime(),
        )
    )

    assert result["backend"] is not None


def test_make_lead_agent_skips_thread_runtime_persistence_for_read_context(monkeypatch, tmp_path):
    lead_agent_module._clear_lead_agent_graph_cache()
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    import src.tools as tools_module

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills"),
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("build_backend should not run in read context")),
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "prompt")
    monkeypatch.setattr(lead_agent_module, "create_deep_agent", lambda **kwargs: kwargs)
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    class _Runtime:
        execution_runtime = None
        user = None

    asyncio.run(
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "thread_id": "thread-1",
                    "user_id": "user-1",
                    "model_name": "safe-model",
                }
            },
            runtime=_Runtime(),
        )
    )

    assert store.saved == []


def test_make_lead_agent_disables_skills_and_subagents_for_hard_authoring_commands(monkeypatch, tmp_path):
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    import src.tools as tools_module

    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / "skills")
    command_file = paths.common_command_file("save-skill-to-store")
    command_file.parent.mkdir(parents=True, exist_ok=True)
    command_file.write_text(
        """---
name: save-skill-to-store
kind: hard
description: 确认将当前 skill 草稿保存到 dev 仓库
authoring_actions:
  - save_skill_to_store
---

用户已明确确认：请保存当前 skill。
附加说明：{{user_text}}
""",
        encoding="utf-8",
    )

    monkeypatch.setattr(
        lead_agent_module,
        "get_paths",
        lambda: paths,
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda thread_id, agent_name, status="dev", agent_config=None, **kwargs: None,
    )
    monkeypatch.setattr(
        lead_agent_module,
        "_load_agent_runtime_config",
        lambda **kwargs: _make_agent_config(),
    )
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    captured_prompt_kwargs: dict[str, object] = {}

    def _fake_prompt(**kwargs):
        captured_prompt_kwargs.update(kwargs)
        return "prompt"

    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", _fake_prompt)
    monkeypatch.setattr(lead_agent_module, "create_deep_agent", lambda **kwargs: kwargs)

    result = asyncio.run(
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "thread_id": "thread-1",
                    "user_id": "user-1",
                    "model_name": "safe-model",
                    "subagent_enabled": True,
                    "original_user_input": "/save-skill-to-store nda-clause-checker",
                }
            },
            runtime=None,
        )
    )

    assert result["skills"] == []
    assert result["subagents"] is None
    assert result["context_schema"] is lead_agent_module.LeadAgentRuntimeContext
    assert "interrupt_on" not in result
    assert captured_prompt_kwargs["command_name"] == "save-skill-to-store"
    assert captured_prompt_kwargs["command_kind"] == "hard"
    assert captured_prompt_kwargs["command_args"] == "nda-clause-checker"
    assert captured_prompt_kwargs["authoring_actions"] == ("save_skill_to_store",)
    assert "nda-clause-checker" in str(captured_prompt_kwargs["command_prompt"])
