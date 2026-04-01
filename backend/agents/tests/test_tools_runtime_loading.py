from pathlib import Path

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


def test_get_available_tools_includes_knowledge_tools(monkeypatch, tmp_path: Path):
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
    assert "list_knowledge_documents" in tool_names
    assert "get_document_tree" in tool_names
    assert "get_document_evidence" in tool_names
    assert "get_document_image" in tool_names
    assert "get_document_tree_node_detail" not in tool_names


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
