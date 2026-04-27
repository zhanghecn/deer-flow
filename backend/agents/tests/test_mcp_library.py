"""Tests for the canonical MCP profile library helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.config.extensions_config import McpServerConfig
from src.config.paths import Paths
from src.mcp.library import (
    build_extensions_config_for_profile_refs,
    is_mcp_profile_ref,
    load_mcp_profile,
    resolve_mcp_profile_file,
)


def test_is_mcp_profile_ref_matches_canonical_prefixes():
    assert is_mcp_profile_ref("mcp-profiles/customer-docs.json") is True
    assert is_mcp_profile_ref("system/mcp-profiles/github.json") is False
    assert is_mcp_profile_ref("github") is False


def test_resolve_mcp_profile_file_supports_missing_json_suffix(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    resolved = resolve_mcp_profile_file("mcp-profiles/customer-docs", paths=paths)
    assert resolved == paths.mcp_profile_file("customer-docs.json")


def test_resolve_mcp_profile_file_rejects_legacy_scoped_refs(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")

    with pytest.raises(ValueError, match="Legacy scoped MCP profile refs"):
        resolve_mcp_profile_file("system/mcp-profiles/github.json", paths=paths)


def test_load_mcp_profile_returns_single_server_config(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    profile_file = paths.mcp_profile_file("customer-docs.json")
    profile_file.parent.mkdir(parents=True, exist_ok=True)
    profile_file.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "customer-docs": {
                        "type": "http",
                        "url": "https://customer.example.com/mcp",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    server_name, server_config = load_mcp_profile("mcp-profiles/customer-docs.json", paths=paths)

    assert server_name == "customer-docs"
    assert isinstance(server_config, McpServerConfig)
    assert server_config.type == "http"
    assert server_config.url == "https://customer.example.com/mcp"


def test_load_mcp_profile_requires_exactly_one_server(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    profile_file = paths.mcp_profile_file("too-many.json")
    profile_file.parent.mkdir(parents=True, exist_ok=True)
    profile_file.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "one": {"type": "stdio", "command": "echo"},
                    "two": {"type": "stdio", "command": "printf"},
                }
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="must define exactly one mcpServers entry"):
        load_mcp_profile("mcp-profiles/too-many.json", paths=paths)


def test_build_extensions_config_for_profile_refs_merges_distinct_servers(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    github_profile = paths.mcp_profile_file("github.json")
    github_profile.parent.mkdir(parents=True, exist_ok=True)
    github_profile.write_text(
        json.dumps({"mcpServers": {"github": {"type": "stdio", "command": "npx", "args": ["github"]}}}),
        encoding="utf-8",
    )
    customer_profile = paths.mcp_profile_file("customer-docs.json")
    customer_profile.parent.mkdir(parents=True, exist_ok=True)
    customer_profile.write_text(
        json.dumps({"mcpServers": {"customer-docs": {"type": "http", "url": "https://customer.example.com/mcp"}}}),
        encoding="utf-8",
    )

    config = build_extensions_config_for_profile_refs(
        [
            "mcp-profiles/github.json",
            "mcp-profiles/customer-docs.json",
        ],
        paths=paths,
    )

    assert set(config.mcp_servers) == {"github", "customer-docs"}


def test_build_extensions_config_for_profile_refs_rejects_conflicting_duplicate_server_name(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    first = paths.mcp_profile_file("alpha.json")
    first.parent.mkdir(parents=True, exist_ok=True)
    first.write_text(
        json.dumps({"mcpServers": {"shared": {"type": "stdio", "command": "echo"}}}),
        encoding="utf-8",
    )
    second = paths.mcp_profile_file("beta.json")
    second.parent.mkdir(parents=True, exist_ok=True)
    second.write_text(
        json.dumps({"mcpServers": {"shared": {"type": "stdio", "command": "printf"}}}),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="define conflicting server 'shared'"):
        build_extensions_config_for_profile_refs(
            [
                "mcp-profiles/alpha.json",
                "mcp-profiles/beta.json",
            ],
            paths=paths,
        )
