from __future__ import annotations

import argparse

from src.knowledge.worker import KnowledgeBuildWorker


def main() -> int:
    parser = argparse.ArgumentParser(description="Knowledge indexing CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    worker_parser = subparsers.add_parser("worker")
    worker_parser.add_argument("--once", action="store_true")

    args = parser.parse_args()
    if args.command != "worker":
        raise ValueError(f"Unsupported command: {args.command}")

    worker = KnowledgeBuildWorker()
    if args.once:
        worker.run_once()
        return 0

    worker.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
