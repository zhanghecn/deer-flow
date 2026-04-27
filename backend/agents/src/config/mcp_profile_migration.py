"""Migration helpers for the single global MCP profile library."""

from __future__ import annotations

import shutil
from pathlib import Path

import yaml

from src.config.paths import Paths, get_paths

_LEGACY_MCP_PREFIXES = ("system/mcp-profiles/", "custom/mcp-profiles/")


def _legacy_ref_to_global(ref: str) -> tuple[str, bool]:
    normalized = str(ref or "").strip().strip("/")
    for prefix in _LEGACY_MCP_PREFIXES:
        if normalized.startswith(prefix):
            return f"mcp-profiles/{normalized[len(prefix):]}", True
    return ref, False


def _copy_legacy_profile_root(paths: Paths, legacy_root: Path) -> None:
    if not legacy_root.is_dir():
        return
    for source_file in sorted(legacy_root.rglob("*.json")):
        relative_path = source_file.relative_to(legacy_root).as_posix()
        target_file = paths.mcp_profile_file(relative_path)
        if target_file.exists():
            if target_file.read_bytes() != source_file.read_bytes():
                raise RuntimeError(f"Legacy MCP profile migration conflict: {source_file} -> {target_file}")
            continue
        target_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target_file)


def _rewrite_agent_config(config_file: Path) -> None:
    with config_file.open(encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}
    if not isinstance(payload, dict):
        return
    refs = payload.get("mcp_servers")
    if not isinstance(refs, list):
        return

    changed = False
    rewritten_refs: list[object] = []
    for ref in refs:
        if not isinstance(ref, str):
            rewritten_refs.append(ref)
            continue
        rewritten_ref, did_rewrite = _legacy_ref_to_global(ref)
        changed = changed or did_rewrite
        rewritten_refs.append(rewritten_ref)
    if not changed:
        return

    # This is the hard-cut persistence migration; after it runs runtime code
    # rejects scoped MCP refs instead of keeping fallback readers alive.
    payload["mcp_servers"] = rewritten_refs
    with config_file.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(payload, handle, allow_unicode=True, sort_keys=False)


def migrate_legacy_mcp_profile_layout(paths: Paths | None = None) -> None:
    """Move scoped MCP profile storage to the single global MCP catalog."""

    paths = paths or get_paths()
    for legacy_root in (paths.system_dir / "mcp-profiles", paths.custom_dir / "mcp-profiles"):
        _copy_legacy_profile_root(paths, legacy_root)
    for agents_root in (paths.system_dir / "agents", paths.custom_dir / "agents"):
        if not agents_root.is_dir():
            continue
        for config_file in sorted(agents_root.rglob("config.yaml")):
            _rewrite_agent_config(config_file)
