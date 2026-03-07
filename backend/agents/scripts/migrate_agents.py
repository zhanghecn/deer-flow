#!/usr/bin/env python3
"""Migration script: SOUL.md → AGENTS.md rename + legacy agents/{name}/ → agents/dev/{name}/ layout.

Usage:
    python scripts/migrate_agents.py [--base-dir /path/to/.openagents] [--dry-run]

This script is idempotent — running it multiple times is safe.
"""

import argparse
import shutil
import sys
from pathlib import Path


def migrate(base_dir: Path, dry_run: bool = False) -> None:
    agents_dir = base_dir / "agents"
    if not agents_dir.exists():
        print(f"No agents directory found at {agents_dir}, nothing to migrate.")
        return

    migrated = 0
    renamed = 0

    # Phase 1: Move legacy agents/{name}/ → agents/dev/{name}/
    for entry in sorted(agents_dir.iterdir()):
        if not entry.is_dir():
            continue
        # Skip status directories
        if entry.name in ("prod", "dev"):
            continue
        # Skip if no config.yaml (not a real agent)
        if not (entry / "config.yaml").exists():
            continue

        dest = agents_dir / "dev" / entry.name
        if dest.exists():
            print(f"  SKIP {entry.name}: agents/dev/{entry.name}/ already exists")
            continue

        print(f"  MOVE agents/{entry.name}/ → agents/dev/{entry.name}/")
        if not dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(entry), str(dest))
        migrated += 1

    # Phase 2: Rename SOUL.md → AGENTS.md in all agent directories
    for status_name in ("dev", "prod"):
        status_dir = agents_dir / status_name
        if not status_dir.exists():
            continue
        for agent_entry in sorted(status_dir.iterdir()):
            if not agent_entry.is_dir():
                continue
            soul_file = agent_entry / "SOUL.md"
            agents_md_file = agent_entry / "AGENTS.md"
            if soul_file.exists() and not agents_md_file.exists():
                print(f"  RENAME {status_name}/{agent_entry.name}/SOUL.md → AGENTS.md")
                if not dry_run:
                    soul_file.rename(agents_md_file)
                renamed += 1

    # Also check legacy layout that wasn't moved (e.g. already had agents/dev/)
    # and the base_dir SOUL.md (global default)
    global_soul = base_dir / "SOUL.md"
    global_agents_md = base_dir / "AGENTS.md"
    if global_soul.exists() and not global_agents_md.exists():
        print(f"  RENAME (global) SOUL.md → AGENTS.md")
        if not dry_run:
            global_soul.rename(global_agents_md)
        renamed += 1

    prefix = "[DRY RUN] " if dry_run else ""
    print(f"\n{prefix}Migration complete: {migrated} agents moved, {renamed} SOUL.md renamed.")


def main():
    parser = argparse.ArgumentParser(description="Migrate OpenAgents agents to new layout")
    parser.add_argument("--base-dir", type=Path, default=None, help="Path to .openagents directory")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    args = parser.parse_args()

    if args.base_dir:
        base_dir = args.base_dir.resolve()
    else:
        # Auto-detect: look for .openagents in cwd or parent
        cwd = Path.cwd()
        if (cwd / ".openagents").exists():
            base_dir = cwd / ".openagents"
        elif (cwd.parent / ".openagents").exists():
            base_dir = cwd.parent / ".openagents"
        else:
            print("Could not find .openagents directory. Use --base-dir to specify.", file=sys.stderr)
            sys.exit(1)

    print(f"Migrating agents in: {base_dir}")
    if args.dry_run:
        print("(dry run — no changes will be made)\n")
    else:
        print()

    migrate(base_dir, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
