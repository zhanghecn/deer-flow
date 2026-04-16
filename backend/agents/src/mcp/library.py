"""Canonical MCP library helpers for agent-bound profile refs.

This module intentionally keeps the product-facing MCP format aligned with the
Claude Code-style ``mcpServers`` JSON shape. Agent manifests bind reusable
profile refs such as ``custom/mcp-profiles/customer-docs.json`` instead of
editing one workspace-global runtime config blob.
"""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath

from src.config.extensions_config import ExtensionsConfig, McpServerConfig
from src.config.paths import Paths, get_paths

_MCP_PROFILE_SOURCE_PREFIXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("system", ("system", "mcp-profiles")),
    ("custom", ("custom", "mcp-profiles")),
)


def is_mcp_profile_ref(value: str) -> bool:
    """Return whether *value* looks like a canonical MCP profile source path."""

    normalized = str(value or "").strip().strip("/")
    return normalized.startswith("system/mcp-profiles/") or normalized.startswith("custom/mcp-profiles/")


def normalize_mcp_profile_name(name: str) -> str:
    """Return a canonical MCP profile filename for library writes."""

    normalized = str(name or "").strip().strip("/")
    if not normalized:
        raise ValueError("MCP profile name is required.")
    relative_path = PurePosixPath(normalized)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValueError("MCP profile name must stay inside the MCP profile library.")
    if relative_path.suffix.lower() != ".json":
        relative_path = relative_path.with_suffix(".json")
    return relative_path.as_posix()


def _parse_mcp_profile_source_path(source_path: str) -> tuple[str, PurePosixPath]:
    normalized = str(source_path or "").strip().strip("/")
    if not normalized:
        raise ValueError("MCP profile source_path is required.")

    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts or len(path.parts) < 3:
        raise ValueError(
            "MCP profile source_path must be a safe relative path like "
            "'system/mcp-profiles/customer-docs.json' or "
            "'custom/mcp-profiles/customer-docs.json'."
        )

    path_str = path.as_posix()
    for scope, prefix_parts in _MCP_PROFILE_SOURCE_PREFIXES:
        prefix = PurePosixPath(*prefix_parts).as_posix() + "/"
        if not path_str.startswith(prefix):
            continue
        relative_path = PurePosixPath(path_str[len(prefix) :])
        if not relative_path.parts:
            raise ValueError("MCP profile source_path must point to a concrete JSON file.")
        if relative_path.suffix.lower() != ".json":
            relative_path = relative_path.with_suffix(".json")
        return scope, relative_path

    raise ValueError("MCP profile source_path must start with system/mcp-profiles/ or custom/mcp-profiles/.")


def resolve_mcp_profile_file(source_path: str, *, paths: Paths | None = None) -> Path:
    """Resolve a canonical MCP profile source path to a filesystem JSON file."""

    paths = paths or get_paths()
    scope, relative_path = _parse_mcp_profile_source_path(source_path)
    if scope == "system":
        return paths.system_mcp_profile_file(relative_path)
    return paths.custom_mcp_profile_file(relative_path)


def load_mcp_profile(source_path: str, *, paths: Paths | None = None) -> tuple[str, McpServerConfig]:
    """Load one MCP profile file and return its single server definition.

    Phase 1 keeps each library item atomic: one file == one server entry. This
    makes agent binding, inspection, and testing predictable without inventing a
    separate wrapper format beyond the canonical ``mcpServers`` document.
    """

    profile_file = resolve_mcp_profile_file(source_path, paths=paths)
    if not profile_file.exists():
        raise FileNotFoundError(f"MCP profile not found: {source_path}")

    with open(profile_file, encoding="utf-8") as handle:
        payload = json.load(handle)

    parsed = ExtensionsConfig.model_validate(payload)
    if len(parsed.mcp_servers) != 1:
        raise ValueError(f"MCP profile '{source_path}' must define exactly one mcpServers entry.")

    return next(iter(parsed.mcp_servers.items()))


def validate_mcp_profile_payload(config_json: dict[str, object]) -> tuple[str, ExtensionsConfig]:
    """Validate canonical `mcpServers` JSON and return its single server name."""

    parsed = ExtensionsConfig.model_validate(config_json)
    if len(parsed.mcp_servers) != 1:
        raise ValueError("MCP profile payload must define exactly one mcpServers entry.")
    return next(iter(parsed.mcp_servers)), parsed


def write_mcp_profile(
    *,
    scope: str,
    name: str,
    config_json: dict[str, object],
    paths: Paths | None = None,
) -> str:
    """Write one MCP profile file and return its canonical source_path."""

    paths = paths or get_paths()
    normalized_name = normalize_mcp_profile_name(name)
    _server_name, parsed = validate_mcp_profile_payload(config_json)

    if scope == "system":
        target_file = paths.system_mcp_profile_file(normalized_name)
        source_path = f"system/mcp-profiles/{normalized_name}"
    elif scope == "custom":
        target_file = paths.custom_mcp_profile_file(normalized_name)
        source_path = f"custom/mcp-profiles/{normalized_name}"
    else:
        raise ValueError("MCP profile scope must be 'system' or 'custom'.")

    target_file.parent.mkdir(parents=True, exist_ok=True)
    with open(target_file, "w", encoding="utf-8") as handle:
        json.dump(parsed.model_dump(by_alias=True, exclude_none=True), handle, indent=2)
        handle.write("\n")
    return source_path


def build_extensions_config_for_profile_refs(
    profile_refs: list[str] | None,
    *,
    paths: Paths | None = None,
) -> ExtensionsConfig:
    """Build an ``ExtensionsConfig`` from selected MCP profile refs only.

    The returned config represents the active agent-scoped MCP subset, not the
    full reusable library catalog.
    """

    paths = paths or get_paths()
    merged_servers: dict[str, McpServerConfig] = {}

    for raw_ref in profile_refs or []:
        source_path = str(raw_ref or "").strip()
        if not source_path:
            continue
        server_name, server_config = load_mcp_profile(source_path, paths=paths)
        existing = merged_servers.get(server_name)
        if existing is None:
            merged_servers[server_name] = server_config
            continue
        if existing.model_dump(exclude_none=True) != server_config.model_dump(exclude_none=True):
            raise ValueError(
                f"MCP profile refs define conflicting server '{server_name}'. "
                "Use unique server names or align the duplicated profiles."
            )

    return ExtensionsConfig(mcp_servers=merged_servers, skills={})
