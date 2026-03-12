from __future__ import annotations

from pathlib import Path

import pytest
from langchain.tools import tool

from src.agents.lead_agent import subagents as subagents_loader


@tool("web_search")
def _dummy_web_search(_query: str) -> str:
    """dummy web search"""
    return "ok"


def test_load_default_subagents_yaml():
    specs = subagents_loader.load_subagent_specs(
        [],
        agent_name=None,
        agent_status="dev",
    )

    names = [spec["name"] for spec in specs]
    assert names == ["explore"]


def test_resolve_named_tools_from_yaml(tmp_path: Path, monkeypatch):
    cfg = tmp_path / "subagents.yaml"
    cfg.write_text(
        """
reviewer:
  description: review changes
  system_prompt: do review
  tools:
    - web_search
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(subagents_loader, "_resolve_subagents_path", lambda *_args, **_kwargs: cfg)

    specs = subagents_loader.load_subagent_specs(
        [_dummy_web_search],
        agent_name="demo",
        agent_status="dev",
    )

    assert specs[0]["name"] == "reviewer"
    assert specs[0]["tools"][0].name == "web_search"


def test_unknown_tool_reference_raises(tmp_path: Path, monkeypatch):
    cfg = tmp_path / "subagents.yaml"
    cfg.write_text(
        """
reviewer:
  description: review changes
  system_prompt: do review
  tools:
    - missing_tool
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(subagents_loader, "_resolve_subagents_path", lambda *_args, **_kwargs: cfg)

    with pytest.raises(ValueError, match="unknown tool"):
        subagents_loader.load_subagent_specs(
            [],
            agent_name="demo",
            agent_status="dev",
        )
