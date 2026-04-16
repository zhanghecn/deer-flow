"""Stage the external customer cases corpus into `.openagents/runtime`.

This keeps Deer Flow's local stdio MCP process and the compose-managed HTTP MCP
service on the same stable in-repo data path without hardcoding host-specific
mounts into product/runtime config.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

DEFAULT_SOURCE = Path(
    "/root/project/ai/ai-numerology/backend/agents/examples/案例大全"
)
DEFAULT_TARGET = Path("/root/project/ai/deer-flow/.openagents/runtime/customer-cases")


def main() -> None:
    source = Path(os.getenv("CUSTOMER_CASES_SOURCE_ROOT", str(DEFAULT_SOURCE))).resolve()
    target = Path(os.getenv("CUSTOMER_CASES_TARGET_ROOT", str(DEFAULT_TARGET))).resolve()

    if not source.exists() or not source.is_dir():
        raise FileNotFoundError(f"Customer cases source directory not found: {source}")

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        shutil.rmtree(target)

    # Copy the corpus into the runtime fixture root so both stdio and HTTP MCP
    # transports resolve the exact same customer-visible files during tests.
    shutil.copytree(source, target)
    print(f"Staged customer cases fixture -> {target}")


if __name__ == "__main__":
    main()
