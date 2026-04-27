"""Tests for migrating scoped MCP profiles to the global catalog."""

from __future__ import annotations

import json
from pathlib import Path

from src.config.mcp_profile_migration import migrate_legacy_mcp_profile_layout
from src.config.paths import Paths


def test_migrate_legacy_mcp_profile_layout_copies_profiles_and_rewrites_agent_refs(tmp_path: Path):
    paths = Paths(base_dir=tmp_path / ".openagents", skills_dir=tmp_path / ".openagents" / "skills")
    legacy_profile = paths.custom_dir / "mcp-profiles" / "customer-docs.json"
    legacy_profile.parent.mkdir(parents=True, exist_ok=True)
    legacy_profile.write_text(
        json.dumps({"mcpServers": {"customer-docs": {"type": "http", "url": "https://example.com/mcp"}}}),
        encoding="utf-8",
    )
    agent_config = paths.custom_dir / "agents" / "prod" / "support-agent" / "config.yaml"
    agent_config.parent.mkdir(parents=True, exist_ok=True)
    agent_config.write_text(
        "name: support-agent\nmcp_servers:\n  - custom/mcp-profiles/customer-docs.json\n",
        encoding="utf-8",
    )

    migrate_legacy_mcp_profile_layout(paths=paths)

    assert paths.mcp_profile_file("customer-docs.json").exists()
    config_text = agent_config.read_text(encoding="utf-8")
    assert "custom/mcp-profiles/" not in config_text
    assert "mcp-profiles/customer-docs.json" in config_text
