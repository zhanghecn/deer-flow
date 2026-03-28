from __future__ import annotations

from pathlib import Path

from deepagents.backends import FilesystemBackend
from deepagents.backends.protocol import BackendProtocol


def build_internal_runtime_routes(user_data_dir: str) -> dict[str, BackendProtocol]:
    """Route internal agent spill files into the thread runtime outputs tree."""

    user_data_root = Path(user_data_dir).resolve()
    return {
        "/large_tool_results/": FilesystemBackend(
            root_dir=user_data_root / "outputs" / ".large_tool_results",
            virtual_mode=True,
        ),
        "/conversation_history/": FilesystemBackend(
            root_dir=user_data_root / "outputs" / ".conversation_history",
            virtual_mode=True,
        ),
    }
