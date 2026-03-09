from __future__ import annotations

from abc import ABC, abstractmethod

from .sandbox import Sandbox


class SandboxProvider(ABC):
    """Lifecycle manager for runtime sandboxes."""

    @abstractmethod
    def acquire(self, thread_id: str | None = None) -> str:
        """Acquire or reuse a sandbox for the given thread."""

    @abstractmethod
    def get(self, sandbox_id: str) -> Sandbox | None:
        """Resolve an acquired sandbox instance by id."""

    @abstractmethod
    def release(self, sandbox_id: str) -> None:
        """Release a sandbox instance."""

    @abstractmethod
    def shutdown(self) -> None:
        """Shutdown all managed sandboxes."""
