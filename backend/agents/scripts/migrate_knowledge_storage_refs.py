#!/usr/bin/env python3
"""Migrate filesystem-backed knowledge packages to the configured object store.

Usage:
    KNOWLEDGE_OBJECT_STORE=minio ... python scripts/migrate_knowledge_storage_refs.py [--base-dir /path/to/.openagents] [--dry-run]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config.paths import Paths, get_paths
from src.knowledge.migration import migrate_all_documents


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate knowledge storage refs from filesystem to object storage")
    parser.add_argument("--base-dir", type=Path, default=None, help="Path to OPENAGENTS_HOME / .openagents")
    parser.add_argument("--dry-run", action="store_true", help="Preview the migration without changing DB rows")
    args = parser.parse_args()

    if args.base_dir is not None:
        base_dir = args.base_dir.expanduser().resolve()
        paths = Paths(base_dir=base_dir, skills_dir=base_dir / "skills")
    else:
        paths = get_paths()

    print(f"Knowledge asset base dir: {paths.base_dir}")
    if args.dry_run:
        print("(dry run - no DB rows will be updated)\n")
    else:
        print()

    migrated = migrate_all_documents(paths=paths, dry_run=args.dry_run)
    if not migrated:
        print("No filesystem-backed knowledge documents required migration.")
        return

    for item in migrated:
        print(
            f"  migrated {item.document_id}: package={item.package_root_key} uploaded_files={item.uploaded_file_count}"
        )

    prefix = "[DRY RUN] " if args.dry_run else ""
    print(f"\n{prefix}Migration complete: {len(migrated)} knowledge documents processed.")


if __name__ == "__main__":
    main()
