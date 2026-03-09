"""Tests for lead agent runtime model resolution behavior."""

from __future__ import annotations

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

    def get_thread_runtime_model(self, *, thread_id: str, user_id: str) -> str | None:
        return self.thread_models.get((thread_id, user_id))

    def get_thread_runtime_owner(self, thread_id: str) -> str | None:
        for (tid, uid), _model in self.thread_models.items():
            if tid == thread_id:
                return uid
        return None

    def get_thread_owner(self, thread_id: str) -> str | None:
        return self.thread_owners.get(thread_id)

    def claim_thread_ownership(self, *, thread_id: str, user_id: str, assistant_id: str | None) -> None:
        existing = self.thread_owners.get(thread_id)
        if existing is None:
            self.thread_owners[thread_id] = user_id
            return
        if existing != user_id:
            raise ValueError(
                f"Thread access denied for thread '{thread_id}': owned by another user ({existing})."
            )

    def assert_thread_access(self, *, thread_id: str, user_id: str) -> None:
        owner = self.get_thread_owner(thread_id)
        if owner is not None and owner != user_id:
            raise ValueError(
                f"Thread access denied for thread '{thread_id}': owned by another user ({owner})."
            )
        runtime_owner = self.get_thread_runtime_owner(thread_id)
        if runtime_owner is not None and runtime_owner != user_id:
            raise ValueError(
                f"Thread access denied for thread '{thread_id}': owned by another user ({runtime_owner})."
            )

    def save_thread_runtime(
        self,
        *,
        thread_id: str,
        user_id: str,
        model_name: str,
        agent_name: str | None,
    ) -> None:
        self.claim_thread_ownership(thread_id=thread_id, user_id=user_id, assistant_id=agent_name)
        for (tid, uid) in self.thread_models.keys():
            if tid == thread_id and uid != user_id:
                raise ValueError(
                    f"Thread access denied for thread '{thread_id}': owned by another user ({uid})."
                )
        self.saved.append((thread_id, user_id, model_name, agent_name))
        self.thread_models[(thread_id, user_id)] = model_name

    def get_agent(self, name: str, status: str):
        return None


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


def test_parse_runtime_model_config_requires_name_field():
    with pytest.raises(ValueError, match="model_config.name"):
        lead_agent_module._parse_runtime_model_config({"use": "langchain_openai:ChatOpenAI"})


def test_resolve_run_model_uses_requested_model_name():
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    model_name, model_config = lead_agent_module._resolve_run_model(
        requested_model_name="safe-model",
        runtime_model_name=None,
        agent_config=None,
        thread_id=None,
        user_id=None,
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
        agent_config=None,
        thread_id="thread-1",
        user_id="user-1",
        db_store=store,
    )

    assert model_name == "thread-model"
    assert model_config.name == "thread-model"


def test_resolve_run_model_raises_for_conflicting_requested_and_agent_model():
    store = _FakeDBStore(models={"agent-model": _make_model("agent-model", supports_thinking=True)})

    with pytest.raises(ValueError, match="Model conflict"):
        lead_agent_module._resolve_run_model(
            requested_model_name="other-model",
            runtime_model_name=None,
            agent_config=lead_agent_module.DBAgentConfig(
                name="agent-a",
                status="dev",
                model="agent-model",
                tool_groups=[],
                mcp_servers=[],
            ),
            thread_id=None,
            user_id=None,
            db_store=store,
        )


def test_resolve_run_model_raises_when_model_unavailable():
    store = _FakeDBStore(models={})

    with pytest.raises(ValueError, match="No model resolved for this run"):
        lead_agent_module._resolve_run_model(
            requested_model_name=None,
            runtime_model_name=None,
            agent_config=None,
            thread_id=None,
            user_id=None,
            db_store=store,
        )


def test_make_lead_agent_reads_runtime_context_and_persists_thread_runtime(monkeypatch, tmp_path):
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})

    import src.tools as tools_module

    monkeypatch.setattr(lead_agent_module, "get_paths", lambda: Paths(base_dir=tmp_path / ".openagents"))
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda thread_id, agent_name, status="dev": None,
    )
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

    result = lead_agent_module.make_lead_agent(
        {
            "configurable": {
                "thread_id": "thread-1",
                "user_id": "user-1",
            }
        },
        runtime=_Runtime(
            {
                "model_name": "safe-model",
                "thinking_enabled": True,
                "subagent_enabled": False,
            }
        ),
    )

    assert captured["name"] == "safe-model"
    assert captured["thinking_enabled"] is True
    assert result["model"] is not None
    assert store.saved == [("thread-1", "user-1", "safe-model", LEAD_AGENT_NAME)]


def test_build_openagents_middlewares_includes_vision_middleware_for_vision_model():
    middlewares = lead_agent_module._build_openagents_middlewares(
        _make_model("vision-model", supports_thinking=False, supports_vision=True)
    )

    from src.agents.middlewares.view_image_middleware import ViewImageMiddleware

    assert any(isinstance(m, ViewImageMiddleware) for m in middlewares)


def test_build_openagents_middlewares_excludes_vision_middleware_for_non_vision_model():
    middlewares = lead_agent_module._build_openagents_middlewares(
        _make_model("text-model", supports_thinking=False, supports_vision=False)
    )

    from src.agents.middlewares.view_image_middleware import ViewImageMiddleware

    assert not any(isinstance(m, ViewImageMiddleware) for m in middlewares)


def test_make_lead_agent_rejects_cross_user_thread_access(monkeypatch):
    store = _FakeDBStore(
        models={"safe-model": _make_model("safe-model", supports_thinking=True)},
        thread_owners={"thread-1": "user-owner"},
    )
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)

    with pytest.raises(ValueError, match="Thread access denied"):
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


def test_make_lead_agent_accepts_header_injected_user_id(monkeypatch, tmp_path):
    store = _FakeDBStore(
        models={"thread-model": _make_model("thread-model", supports_thinking=True)},
        thread_models={("thread-1", "user-1"): "thread-model"},
    )

    import src.tools as tools_module

    monkeypatch.setattr(lead_agent_module, "get_paths", lambda: Paths(base_dir=tmp_path / ".openagents"))
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(
        lead_agent_module,
        "build_backend",
        lambda thread_id, agent_name, status="dev": None,
    )
    monkeypatch.setattr(lead_agent_module, "create_deep_agent", lambda **kwargs: kwargs)
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    result = lead_agent_module.make_lead_agent(
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

    assert result["model"] is not None
    assert store.saved == [("thread-1", "user-1", "thread-model", LEAD_AGENT_NAME)]


def test_make_lead_agent_requires_user_for_thread_scoped_requests(monkeypatch):
    store = _FakeDBStore(models={"safe-model": _make_model("safe-model", supports_thinking=True)})
    monkeypatch.setattr(lead_agent_module, "get_runtime_db_store", lambda: store)

    with pytest.raises(ValueError, match="Thread-scoped requests require user identity"):
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "thread_id": "thread-1",
                    "model_name": "safe-model",
                }
            },
            runtime=None,
        )
