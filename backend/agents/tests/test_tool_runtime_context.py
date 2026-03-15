from types import SimpleNamespace

from src.agents.lead_agent.agent import LeadAgentRuntimeContext
from src.tools.builtins.push_agent_prod_tool import push_agent_prod
from src.tools.builtins.runtime_context import runtime_context_value
from src.tools.builtins.save_agent_to_store_tool import save_agent_to_store
from src.tools.builtins.setup_agent_tool import setup_agent


def test_runtime_context_value_supports_typed_context():
    context = LeadAgentRuntimeContext(
        agent_name="lead_agent",
        target_agent_name="contract-agent",
        agent_status="dev",
        runtime_thread_id="thread-1",
    )

    assert runtime_context_value(context, "agent_name") == "lead_agent"
    assert runtime_context_value(context, "target_agent_name") == "contract-agent"
    assert runtime_context_value(context, "agent_status") == "dev"
    assert runtime_context_value(context, "x-thread-id") == "thread-1"
    assert runtime_context_value(context, "missing", "fallback") == "fallback"


def test_setup_agent_accepts_typed_runtime_context(monkeypatch):
    calls: dict[str, object] = {}

    def fake_materialize_agent_definition(**kwargs):
        calls.update(kwargs)
        return SimpleNamespace(skill_refs=[])

    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.materialize_agent_definition",
        fake_materialize_agent_definition,
    )
    monkeypatch.setattr(
        "src.tools.builtins.setup_agent_tool.get_paths",
        lambda: SimpleNamespace(
            agent_dir=lambda name, status: f"/tmp/{status}/{name}",
        ),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(
            agent_name="lead_agent",
            target_agent_name="contract-agent",
            agent_status="dev",
        ),
        tool_call_id="tc-1",
    )

    command = setup_agent.func(
        agents_md="# Contract Agent",
        description="Reviews contracts",
        runtime=runtime,
        skills=[
            {"name": "bootstrap"},
            {
                "name": "contract-review",
                "content": "---\nname: contract-review\ndescription: Review contracts\n---\n\n# contract-review\n",
            },
        ],
    )

    assert calls["name"] == "contract-agent"
    assert calls["status"] == "dev"
    assert calls["description"] == "Reviews contracts"
    assert calls["skill_names"] == ["bootstrap"]
    assert calls["inline_skills"] == [
        {
            "name": "contract-review",
            "content": "---\nname: contract-review\ndescription: Review contracts\n---\n\n# contract-review\n",
        }
    ]
    assert command.update["created_agent_name"] == "contract-agent"


def test_save_and_push_agent_tools_accept_typed_runtime_context(monkeypatch):
    monkeypatch.setattr(
        "src.tools.builtins.save_agent_to_store_tool.get_paths",
        lambda: object(),
    )
    monkeypatch.setattr(
        "src.tools.builtins.save_agent_to_store_tool.resolve_default_agent_source_dir",
        lambda runtime, agent_name, paths: f"/tmp/{agent_name}",
    )
    monkeypatch.setattr(
        "src.tools.builtins.save_agent_to_store_tool.save_agent_directory_to_store",
        lambda source_dir, agent_name, paths: (f"/store/dev/{agent_name}", None),
    )
    monkeypatch.setattr(
        "src.tools.builtins.push_agent_prod_tool.get_paths",
        lambda: object(),
    )
    monkeypatch.setattr(
        "src.tools.builtins.push_agent_prod_tool.push_agent_directory_to_prod",
        lambda agent_name, paths: (f"/store/prod/{agent_name}", None),
    )

    runtime = SimpleNamespace(
        context=LeadAgentRuntimeContext(agent_name="contract-agent"),
        tool_call_id="tc-2",
    )

    save_result = save_agent_to_store.func(runtime=runtime)
    push_result = push_agent_prod.func(runtime=runtime)

    assert "contract-agent" in save_result.update["messages"][0].content
    assert "contract-agent" in push_result.update["messages"][0].content
