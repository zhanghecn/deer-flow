from __future__ import annotations

from pathlib import Path

import pytest
from langchain.tools import tool

from src.agents.lead_agent import subagents as subagents_loader
from src.config.agents_config import AgentConfig
from src.tools.builtins import question_tool


@tool("web_search")
def _dummy_web_search(_query: str) -> str:
    """dummy web search"""
    return "ok"


def test_load_default_subagents_yaml():
    loaded = subagents_loader.load_subagent_specs(
        [],
        agent_config=AgentConfig(name="lead_agent", status="dev"),
        agent_status="dev",
        model_name="demo-model",
        model_supports_vision=False,
    )

    names = [spec["name"] for spec in loaded.custom_subagents]
    assert names == ["explore"]
    assert loaded.general_purpose_enabled is True


def test_resolve_named_tools_from_yaml(tmp_path: Path, monkeypatch):
    cfg = tmp_path / "subagents.yaml"
    cfg.write_text(
        """
version: 1
subagents:
  reviewer:
    description: review changes
    system_prompt: do review
    tool_names:
      - web_search
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(subagents_loader, "_resolve_subagents_path", lambda *_args, **_kwargs: cfg)
    monkeypatch.setattr(subagents_loader, "get_available_tools", lambda **_kwargs: [_dummy_web_search])

    loaded = subagents_loader.load_subagent_specs(
        [_dummy_web_search],
        agent_config=AgentConfig(name="demo", status="dev"),
        agent_status="dev",
        model_name="demo-model",
        model_supports_vision=False,
    )

    assert loaded.custom_subagents[0]["name"] == "reviewer"
    assert loaded.custom_subagents[0]["tools"][0].name == "web_search"


def test_unknown_tool_reference_raises(tmp_path: Path, monkeypatch):
    cfg = tmp_path / "subagents.yaml"
    cfg.write_text(
        """
version: 1
subagents:
  reviewer:
    description: review changes
    system_prompt: do review
    tool_names:
      - missing_tool
    """,
        encoding="utf-8",
    )
    monkeypatch.setattr(subagents_loader, "_resolve_subagents_path", lambda *_args, **_kwargs: cfg)

    with pytest.raises(ValueError, match="Unknown tool"):
        subagents_loader.load_subagent_specs(
            [],
            agent_config=AgentConfig(name="demo", status="dev"),
            agent_status="dev",
            model_name="demo-model",
            model_supports_vision=False,
        )


def test_inherited_subagent_tools_filter_main_agent_only(monkeypatch, tmp_path: Path):
    cfg = tmp_path / "subagents.yaml"
    cfg.write_text(
        """
version: 1
subagents:
  reviewer:
    description: review changes
    system_prompt: do review
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(subagents_loader, "_resolve_subagents_path", lambda *_args, **_kwargs: cfg)

    loaded = subagents_loader.load_subagent_specs(
        [_dummy_web_search, question_tool],
        agent_config=AgentConfig(name="demo", status="dev"),
        agent_status="dev",
        model_name="demo-model",
        model_supports_vision=False,
    )

    inherited_tool_names = [tool.name for tool in loaded.custom_subagents[0]["tools"]]
    general_purpose_tool_names = [tool.name for tool in loaded.general_purpose_tools]

    assert inherited_tool_names == ["web_search"]
    assert general_purpose_tool_names == ["web_search"]
