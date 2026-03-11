from src.tools import tools as tools_module


def _tool_names(tools: object) -> set[str]:
    assert isinstance(tools, list)
    return {
        name
        for name in (getattr(tool, "name", None) for tool in tools)
        if isinstance(name, str)
    }


def test_prod_runs_do_not_receive_authoring_tools(monkeypatch):
    monkeypatch.setattr(tools_module, "load_tool_configs", lambda: ([], []))

    tools = tools_module.get_available_tools(
        agent_status="prod",
        authoring_actions=["save_agent_to_store", "push_agent_prod"],
        model_supports_vision=False,
        include_mcp=False,
    )

    names = _tool_names(tools)
    assert "save_agent_to_store" not in names
    assert "push_agent_prod" not in names


def test_dev_runs_without_authoring_actions_do_not_receive_authoring_tools(monkeypatch):
    monkeypatch.setattr(tools_module, "load_tool_configs", lambda: ([], []))

    tools = tools_module.get_available_tools(
        agent_status="dev",
        authoring_actions=[],
        model_supports_vision=False,
        include_mcp=False,
    )

    names = _tool_names(tools)
    assert "save_agent_to_store" not in names
    assert "save_skill_to_store" not in names
    assert "push_agent_prod" not in names
    assert "push_skill_prod" not in names
    assert "promote_skill_shared" not in names


def test_dev_runs_receive_only_requested_authoring_tools(monkeypatch):
    monkeypatch.setattr(tools_module, "load_tool_configs", lambda: ([], []))

    tools = tools_module.get_available_tools(
        agent_status="dev",
        authoring_actions=["save_agent_to_store"],
        model_supports_vision=False,
        include_mcp=False,
    )

    names = _tool_names(tools)
    assert "save_agent_to_store" in names
    assert "save_skill_to_store" not in names
    assert "push_agent_prod" not in names
