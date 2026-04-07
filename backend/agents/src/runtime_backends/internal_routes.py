from __future__ import annotations

from pathlib import Path

from deepagents.backends import FilesystemBackend
from deepagents.backends.protocol import BackendProtocol

from src.config.paths import VIRTUAL_PATH_PREFIX


def build_internal_runtime_routes(
    user_data_dir: str,
    *,
    shared_tmp_dir: str | None = None,
) -> dict[str, BackendProtocol]:
    """Route internal agent spill files into the thread runtime outputs tree."""

    user_data_root = Path(user_data_dir).resolve()
    routes: dict[str, BackendProtocol] = {
        "/large_tool_results/": FilesystemBackend(
            root_dir=user_data_root / "outputs" / ".large_tool_results",
            virtual_mode=True,
        ),
        "/conversation_history/": FilesystemBackend(
            root_dir=user_data_root / "outputs" / ".conversation_history",
            virtual_mode=True,
        ),
    }
    if shared_tmp_dir:
        # `/mnt/user-data/tmp` is the one intentional runtime area that is not
        # thread-local. Route it explicitly so file tools do not accidentally
        # fall back to `<thread>/user-data/tmp`.
        tmp_backend = FilesystemBackend(
            root_dir=Path(shared_tmp_dir).resolve(),
            virtual_mode=True,
        )
        routes[f"{VIRTUAL_PATH_PREFIX}/tmp"] = tmp_backend
        routes["/tmp"] = tmp_backend
    return routes
