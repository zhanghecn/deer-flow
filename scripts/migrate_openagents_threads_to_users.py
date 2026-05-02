#!/usr/bin/env python3
"""One-time migration for OpenAgents thread runtime directories.

Moves:
    {base}/threads/{thread_id}
to:
    {base}/users/{user_id}/threads/{thread_id}

The live runtime intentionally does not fall back to the old flat layout. Run
this script during a maintenance window before starting services with the
user-scoped storage layout.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class ThreadBinding:
    thread_id: str
    user_id: str


def _load_psycopg():
    try:
        import psycopg  # type: ignore
    except ImportError as exc:
        raise SystemExit("psycopg is required. Run this with the backend/agents Python environment.") from exc
    return psycopg


def _safe_id(value: str, label: str) -> str:
    normalized = str(value or "").strip()
    if not SAFE_ID_RE.match(normalized):
        raise ValueError(f"unsafe {label}: {value!r}")
    return normalized


def _load_bindings(database_url: str) -> list[ThreadBinding]:
    psycopg = _load_psycopg()
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT thread_id, user_id::text FROM thread_bindings ORDER BY updated_at NULLS FIRST")
            rows = cur.fetchall()
    return [
        ThreadBinding(
            thread_id=_safe_id(str(thread_id), "thread_id"),
            user_id=_safe_id(str(user_id), "user_id"),
        )
        for thread_id, user_id in rows
        if thread_id and user_id
    ]


def _nonempty_dir(path: Path) -> bool:
    return path.is_dir() and any(path.iterdir())


def migrate(base_dir: Path, bindings: list[ThreadBinding], *, execute: bool) -> int:
    migrated = 0
    old_root = base_dir / "threads"
    for binding in bindings:
        old_path = old_root / binding.thread_id
        new_path = base_dir / "users" / binding.user_id / "threads" / binding.thread_id
        if not old_path.exists():
            continue
        if new_path.exists() and _nonempty_dir(new_path):
            print(f"BLOCKED existing destination: {new_path}", file=sys.stderr)
            continue
        print(f"{'MOVE' if execute else 'DRY-RUN'} {old_path} -> {new_path}")
        migrated += 1
        if not execute:
            continue
        new_path.parent.mkdir(parents=True, exist_ok=True)
        if new_path.exists():
            new_path.rmdir()
        shutil.move(str(old_path), str(new_path))
    return migrated


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate flat OpenAgents thread dirs to user-scoped dirs.")
    parser.add_argument("--base-dir", default=os.getenv("OPENAGENTS_HOME", ".openagents"))
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", ""))
    parser.add_argument("--execute", action="store_true", help="Move directories. Omit for dry-run.")
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("DATABASE_URL or --database-url is required")

    base_dir = Path(args.base_dir).expanduser().resolve()
    bindings = _load_bindings(args.database_url)
    migrated = migrate(base_dir, bindings, execute=args.execute)
    print(f"{'migrated' if args.execute else 'would migrate'} {migrated} thread directories")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
