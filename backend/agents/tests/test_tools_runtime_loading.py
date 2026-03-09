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
