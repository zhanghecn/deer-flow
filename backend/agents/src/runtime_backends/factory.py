from __future__ import annotations

from typing import Literal

from deepagents.backends.protocol import BackendProtocol

from src.config.paths import Paths

from .local import build_local_workspace_backend, resolve_shared_skills_mount
from .remote import REMOTE_EXECUTION_BACKEND, build_remote_workspace_backend
from .sandbox import build_sandbox_workspace_backend, resolve_default_execution_backend

RuntimeBackendKind = Literal["local", "sandbox", "remote"]


def resolve_runtime_backend_kind(requested_backend: str | None = None) -> RuntimeBackendKind:
    normalized = str(requested_backend or "").strip().lower()
    if normalized:
        if normalized != REMOTE_EXECUTION_BACKEND:
            raise ValueError(
                f"Unsupported execution backend '{requested_backend}'. Only 'remote' is selectable per request."
            )
        return REMOTE_EXECUTION_BACKEND
    return resolve_default_execution_backend()


def build_runtime_workspace_backend(
    *,
    user_data_dir: str,
    thread_id: str,
    paths: Paths,
    requested_backend: str | None = None,
    remote_session_id: str | None = None,
) -> BackendProtocol:
    backend_kind = resolve_runtime_backend_kind(requested_backend)
    if backend_kind == REMOTE_EXECUTION_BACKEND:
        if not remote_session_id:
            raise ValueError("Remote execution requires `remote_session_id`.")
        return build_remote_workspace_backend(session_id=remote_session_id, paths=paths)
    if backend_kind == "sandbox":
        return build_sandbox_workspace_backend(
            thread_id,
            user_data_dir=user_data_dir,
        )
    return build_local_workspace_backend(
        user_data_dir,
        shared_skills_mount=resolve_shared_skills_mount(paths),
    )
