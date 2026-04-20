"""CLI entrypoint for running the file MCP workbench transport."""

from __future__ import annotations

import os
import sys

from app.main import run_mcp_transport


def main() -> int:
    transport = os.getenv("MCP_WORKBENCH_TRANSPORT", "stdio")
    if len(sys.argv) > 1 and sys.argv[1].strip():
        transport = sys.argv[1].strip()
    run_mcp_transport(transport)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
