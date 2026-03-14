"""Backend for connecting to an already-running sandbox URL."""

from __future__ import annotations

from .backend import SandboxBackend, wait_for_sandbox_ready
from .sandbox_info import SandboxInfo


class ExistingSandboxBackend(SandboxBackend):
    """Provisioning backend that reuses a fixed sandbox base URL.

    This keeps the config surface honest for deployments where sandbox lifecycle
    is managed externally and OpenAgents should simply reconnect.
    """

    def __init__(self, base_url: str):
        self._base_url = base_url.rstrip("/")

    @property
    def base_url(self) -> str:
        return self._base_url

    def create(
        self,
        thread_id: str,
        sandbox_id: str,
        extra_mounts: list[tuple[str, str, bool]] | None = None,
    ) -> SandboxInfo:
        _ = thread_id
        _ = extra_mounts
        return SandboxInfo(
            sandbox_id=sandbox_id,
            sandbox_url=self._base_url,
        )

    def destroy(self, info: SandboxInfo) -> None:
        _ = info

    def is_alive(self, info: SandboxInfo) -> bool:
        return wait_for_sandbox_ready(info.sandbox_url, timeout=5)

    def discover(self, sandbox_id: str) -> SandboxInfo | None:
        if not wait_for_sandbox_ready(self._base_url, timeout=5):
            return None
        return SandboxInfo(
            sandbox_id=sandbox_id,
            sandbox_url=self._base_url,
        )
