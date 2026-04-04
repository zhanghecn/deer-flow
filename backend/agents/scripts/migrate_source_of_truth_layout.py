#!/usr/bin/env python3
"""Migrate legacy authored assets into the system/custom/runtime layout.

Usage:
    python scripts/migrate_source_of_truth_layout.py [--base-dir /path/to/.openagents]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _detect_base_dir() -> Path:
    cwd = Path.cwd()
    for candidate in (cwd / ".openagents", cwd.parent / ".openagents"):
        if candidate.exists():
            return candidate.resolve()
    raise FileNotFoundError("Could not find .openagents directory. Use --base-dir to specify it explicitly.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate OpenAgents authored assets to the system/custom/runtime layout")
    parser.add_argument("--base-dir", type=Path, default=None, help="Path to the .openagents directory")
    args = parser.parse_args()

    try:
        base_dir = args.base_dir.resolve() if args.base_dir is not None else _detect_base_dir()
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc

    repo_root = Path(__file__).resolve().parents[3]
    backend_agents_root = repo_root / "backend" / "agents"
    if str(backend_agents_root) not in sys.path:
        sys.path.insert(0, str(backend_agents_root))

    from src.config.paths import Paths
    from src.config.source_of_truth_migration import migrate_source_of_truth_layout

    paths = Paths(base_dir=base_dir, skills_dir=base_dir)
    result = migrate_source_of_truth_layout(paths=paths)

    print(
        "Source-of-truth migration complete: "
        f"copied_skills={result.copied_skills}, "
        f"copied_agents={result.copied_agents}, "
        f"rewritten_manifests={result.rewritten_manifests}, "
        f"skipped_conflicts={len(result.skipped_conflicts)}"
    )


if __name__ == "__main__":
    main()
