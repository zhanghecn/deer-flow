"""Tests for MCP tool resolution paths in the shared tool loader."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from langchain_core.tools import BaseTool

from src.mcp.tools import wrap_mcp_tool_errors
from src.tools.tools import _load_mcp_tool_items


class FailingDocumentTool(BaseTool):
    name: str = "document_read"
    description: str = "Read a document."

    def _run(self, path: str) -> str:
        raise FileNotFoundError(f"{path} was not found")


class AsyncFailingDocumentTool(BaseTool):
    name: str = "document_read"
    description: str = "Read a document."

    def _run(self, path: str) -> str:
        raise FileNotFoundError(f"{path} was not found")

    async def _arun(self, path: str) -> str:
        raise RuntimeError(f"{path} cannot be read")


def test_wrap_mcp_tool_errors_returns_model_visible_tool_error():
    wrapped = wrap_mcp_tool_errors(FailingDocumentTool())

    result = wrapped.invoke(
        {
            "type": "tool_call",
            "id": "call-document-read",
            "name": "document_read",
            "args": {"path": "missing.md"},
        }
    )

    assert result.status == "error"
    assert result.name == "document_read"
    assert result.tool_call_id == "call-document-read"
    assert "MCP tool 'document_read' failed: missing.md was not found" in result.content


def test_wrap_mcp_tool_errors_handles_async_mcp_failures():
    wrapped = wrap_mcp_tool_errors(AsyncFailingDocumentTool())

    result = asyncio.run(
        wrapped.ainvoke(
            {
                "type": "tool_call",
                "id": "call-document-read",
                "name": "document_read",
                "args": {"path": "missing.md"},
            }
        )
    )

    assert result.status == "error"
    assert "MCP tool 'document_read' failed: missing.md cannot be read" in result.content


def test_load_mcp_tool_items_uses_agent_scoped_profile_refs(monkeypatch):
    calls: dict[str, object] = {}

    def fake_build_extensions_config_for_profile_refs(profile_refs):
        calls["profile_refs"] = list(profile_refs)
        return SimpleNamespace(get_enabled_mcp_servers=lambda: {"customer-docs": object()})

    async def fake_get_mcp_tools_for_extensions_config(_extensions_config):
        calls["explicit_config"] = True
        return [SimpleNamespace(name="mcp__customer_docs__search_files")]

    monkeypatch.setattr(
        "src.mcp.library.build_extensions_config_for_profile_refs",
        fake_build_extensions_config_for_profile_refs,
    )
    monkeypatch.setattr(
        "src.mcp.tools.get_mcp_tools_for_extensions_config",
        fake_get_mcp_tools_for_extensions_config,
    )

    resolved = _load_mcp_tool_items(
        include_mcp=True,
        mcp_servers=["mcp-profiles/customer-docs.json"],
    )

    assert calls["profile_refs"] == ["mcp-profiles/customer-docs.json"]
    assert calls["explicit_config"] is True
    assert [name for name, _tool in resolved] == ["mcp__customer_docs__search_files"]


def test_load_mcp_tool_items_merges_profile_refs_with_legacy_server_names(monkeypatch):
    calls: dict[str, object] = {}

    def fake_build_extensions_config_for_profile_refs(profile_refs):
        calls["profile_refs"] = list(profile_refs)
        return SimpleNamespace(get_enabled_mcp_servers=lambda: {"customer-docs": object()})

    async def fake_get_mcp_tools_for_extensions_config(_extensions_config):
        return [SimpleNamespace(name="mcp__customer_docs__search_files")]

    class FakeExtensionsConfig:
        def get_enabled_mcp_servers(self):
            return {"github": object()}

    monkeypatch.setattr(
        "src.mcp.library.build_extensions_config_for_profile_refs",
        fake_build_extensions_config_for_profile_refs,
    )
    monkeypatch.setattr(
        "src.mcp.tools.get_mcp_tools_for_extensions_config",
        fake_get_mcp_tools_for_extensions_config,
    )
    monkeypatch.setattr(
        "src.config.extensions_config.ExtensionsConfig.from_file",
        lambda: FakeExtensionsConfig(),
    )
    monkeypatch.setattr(
        "src.mcp.cache.get_cached_mcp_tools",
        lambda server_names=None: [SimpleNamespace(name=f"mcp__{server_names[0]}__repo_search")],
    )

    resolved = _load_mcp_tool_items(
        include_mcp=True,
        mcp_servers=[
            "mcp-profiles/customer-docs.json",
            "github",
        ],
    )

    assert calls["profile_refs"] == ["mcp-profiles/customer-docs.json"]
    assert [name for name, _tool in resolved] == [
        "mcp__customer_docs__search_files",
        "mcp__github__repo_search",
    ]
