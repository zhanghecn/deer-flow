from __future__ import annotations

from .sandbox_provider import SandboxProvider


class LocalSandboxProvider(SandboxProvider):
    """Marker provider for local execution mode.

    Local execution is constructed directly in `lead_agent.agent.build_backend()`
    and does not provision managed sandboxes.
    """

    def acquire(self, thread_id: str | None = None) -> str:
        _ = thread_id
        raise NotImplementedError("LocalSandboxProvider is a config marker and is not instantiated at runtime.")

    def get(self, sandbox_id: str):
        _ = sandbox_id
        raise NotImplementedError("LocalSandboxProvider is a config marker and is not instantiated at runtime.")

    def release(self, sandbox_id: str) -> None:
        _ = sandbox_id

    def shutdown(self) -> None:
        return None
