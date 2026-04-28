from pathlib import Path
from types import SimpleNamespace

from src.agents.lead_agent.prompt import apply_prompt_template
from src.config.agents_config import AgentConfig
from src.tools.tools import get_available_tools


def test_get_available_tools_does_not_require_model_env(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
models:
  - name: broken-model
    use: langchain_openai:ChatOpenAI
    model: broken-model
    api_key: $OPENAI_API_KEY
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
tools:
  - name: web_search
    group: web
    use: tests.fake_tools:fake_tool
tool_groups:
  - name: web
""".strip(),
        encoding="utf-8",
    )

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(
        "src.tools.tools.resolve_variable",
        lambda use, _: {"use": use},
    )

    tools = get_available_tools(
        include_mcp=False,
        model_supports_vision=False,
    )

    assert {"use": "tests.fake_tools:fake_tool"} in tools


def test_get_available_tools_includes_default_knowledge_retrieval_tools(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
models: []
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
tools: []
tool_groups: []
""".strip(),
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))

    tools = get_available_tools(
        include_mcp=False,
        model_supports_vision=False,
    )

    tool_names = {tool.name for tool in tools if hasattr(tool, "name")}

    assert "question" in tool_names
    assert "list_knowledge_documents" not in tool_names
    assert "get_document_tree" in tool_names
    assert "get_document_evidence" in tool_names
    assert "get_document_image" in tool_names
    assert "get_document_tree_node_detail" not in tool_names


def test_get_available_tools_adds_view_image_only_for_vision_models(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
models: []
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
tools: []
tool_groups: []
""".strip(),
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))

    text_tools = get_available_tools(
        include_mcp=False,
        model_supports_vision=False,
    )
    vision_tools = get_available_tools(
        include_mcp=False,
        model_supports_vision=True,
    )

    text_tool_names = {tool.name for tool in text_tools if hasattr(tool, "name")}
    vision_tool_names = {tool.name for tool in vision_tools if hasattr(tool, "name")}

    # `view_image` must stay runtime-conditional so non-vision models can still
    # use the same archived agent manifest without tool-loading failures.
    assert "view_image" not in text_tool_names
    assert "view_image" in vision_tool_names


def test_prompt_omits_question_contract_for_explicit_empty_tool_names() -> None:
    prompt = apply_prompt_template(
        agent_name="mcp-only-agent",
        memory_config=None,
        agent_config=AgentConfig(
            name="mcp-only-agent",
            tool_names=[],
            mcp_servers=["mcp-profiles/customer-docs.json"],
        ),
    )

    assert "call `question`" not in prompt
    assert "question_tool_contract" not in prompt


def test_get_available_tools_resolves_opt_in_knowledge_compatibility_tool(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
models: []
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
tools: []
tool_groups: []
""".strip(),
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))

    tools = get_available_tools(
        tool_names=["get_document_tree_node_detail"],
        include_mcp=False,
        model_supports_vision=False,
    )

    assert [tool.name for tool in tools] == ["get_document_tree_node_detail"]


def test_get_available_tools_prefers_explicit_tool_names(monkeypatch, tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
models: []
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
tools:
  - name: web_search
    group: web
    use: tests.fake_tools:web_search
  - name: image_search
    group: web
    use: tests.fake_tools:image_search
tool_groups:
  - name: web
""".strip(),
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(
        "src.tools.tools.resolve_variable",
        lambda use, _: {"use": use},
    )

    tools = get_available_tools(
        groups=["web"],
        tool_names=["image_search"],
        include_mcp=False,
        model_supports_vision=False,
    )

    assert tools == [{"use": "tests.fake_tools:image_search"}]


def test_get_available_tools_appends_contextual_runtime_helpers_to_explicit_tool_names(
    monkeypatch,
    tmp_path: Path,
):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
models: []
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
tools: []
tool_groups: []
""".strip(),
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))

    tools = get_available_tools(
        tool_names=["get_document_tree"],
        include_mcp=False,
        model_supports_vision=False,
        agent_status="dev",
        setup_agent_enabled=True,
        always_available_tool_names=[
            "install_skill_from_registry",
            "save_skill_to_store",
            "setup_agent",
        ],
        always_available_authoring_actions=["save_skill_to_store"],
    )

    assert [tool.name for tool in tools] == [
        "get_document_tree",
        "install_skill_from_registry",
        "save_skill_to_store",
        "setup_agent",
    ]


def test_get_available_tools_keeps_agent_scoped_mcp_when_explicit_tool_names_empty(
    monkeypatch,
    tmp_path: Path,
):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
models: []
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
tools: []
tool_groups: []
""".strip(),
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(
        "src.tools.tools._tool_items_by_name",
        lambda **_kwargs: {},
    )
    monkeypatch.setattr(
        "src.tools.tools._load_mcp_tool_items",
        lambda **_kwargs: [("fs_grep", SimpleNamespace(name="fs_grep"))],
    )

    tools = get_available_tools(
        tool_names=[],
        include_mcp=True,
        mcp_servers=["mcp-profiles/customer-docs.json"],
        model_supports_vision=False,
    )

    assert [tool.name for tool in tools] == ["fs_grep"]


def test_get_available_tools_appends_agent_scoped_mcp_to_explicit_tool_names(
    monkeypatch,
    tmp_path: Path,
):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        """
models: []
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
tools: []
tool_groups: []
""".strip(),
        encoding="utf-8",
    )

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(
        "src.tools.tools._tool_items_by_name",
        lambda **_kwargs: {"question": SimpleNamespace(name="question")},
    )
    monkeypatch.setattr(
        "src.tools.tools._load_mcp_tool_items",
        lambda **_kwargs: [("fs_grep", SimpleNamespace(name="fs_grep"))],
    )

    tools = get_available_tools(
        tool_names=["question"],
        include_mcp=True,
        mcp_servers=["mcp-profiles/customer-docs.json"],
        model_supports_vision=False,
    )

    assert [tool.name for tool in tools] == ["question", "fs_grep"]
