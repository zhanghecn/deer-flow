"""Memory update queue with debounce mechanism."""

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.config.agents_config import AgentMemoryConfig


@dataclass
class ConversationContext:
    """Context for a conversation to be processed for memory update."""

    user_id: str
    thread_id: str
    messages: list[Any]
    timestamp: datetime = field(default_factory=datetime.utcnow)
    agent_name: str = ""
    agent_status: str = "dev"
    memory_config: AgentMemoryConfig = field(default_factory=AgentMemoryConfig)


class MemoryUpdateQueue:
    """Queue for memory updates with debounce mechanism.

    This queue collects conversation contexts and processes them after
    a configurable debounce period. Multiple conversations received within
    the debounce window are batched together.
    """

    def __init__(self):
        """Initialize the memory update queue."""
        self._queue: list[ConversationContext] = []
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._processing = False

    def add(
        self,
        *,
        user_id: str,
        thread_id: str,
        messages: list[Any],
        agent_name: str,
        agent_status: str = "dev",
        memory_config: AgentMemoryConfig,
    ) -> None:
        """Add a conversation to the update queue.

        Args:
            thread_id: The thread ID.
            messages: The conversation messages.
            user_id: Owning user identifier.
            agent_name: Agent name.
            agent_status: Agent status namespace.
            memory_config: Per-agent memory policy.
        """
        if not memory_config.enabled:
            return

        context = ConversationContext(
            user_id=user_id,
            thread_id=thread_id,
            messages=messages,
            agent_name=agent_name,
            agent_status=agent_status,
            memory_config=memory_config,
        )

        with self._lock:
            # Check if this thread already has a pending update
            # If so, replace it with the newer one
            self._queue = [c for c in self._queue if c.thread_id != thread_id]
            self._queue.append(context)

            # Reset or start the debounce timer
            self._reset_timer(memory_config.debounce_seconds)

        print(f"Memory update queued for thread {thread_id}, queue size: {len(self._queue)}")

    def _reset_timer(self, debounce_seconds: int) -> None:
        """Reset the debounce timer."""
        # Cancel existing timer if any
        if self._timer is not None:
            self._timer.cancel()

        # Start new timer
        self._timer = threading.Timer(
            debounce_seconds,
            self._process_queue,
        )
        self._timer.daemon = True
        self._timer.start()

        print(f"Memory update timer set for {debounce_seconds}s")

    def _process_queue(self) -> None:
        """Process all queued conversation contexts."""
        # Import here to avoid circular dependency
        from src.agents.memory.updater import MemoryUpdater

        with self._lock:
            if self._processing:
                # Already processing, reschedule
                if self._queue:
                    self._reset_timer(self._queue[-1].memory_config.debounce_seconds)
                return

            if not self._queue:
                return

            self._processing = True
            contexts_to_process = self._queue.copy()
            self._queue.clear()
            self._timer = None

        print(f"Processing {len(contexts_to_process)} queued memory updates")

        try:
            for context in contexts_to_process:
                try:
                    updater = MemoryUpdater(context.memory_config)
                    print(f"Updating memory for thread {context.thread_id}")
                    success = updater.update_memory(
                        messages=context.messages,
                        user_id=context.user_id,
                        thread_id=context.thread_id,
                        agent_name=context.agent_name,
                        agent_status=context.agent_status,
                    )
                    if success:
                        print(f"Memory updated successfully for thread {context.thread_id}")
                    else:
                        print(f"Memory update skipped/failed for thread {context.thread_id}")
                except Exception as e:
                    print(f"Error updating memory for thread {context.thread_id}: {e}")

                # Small delay between updates to avoid rate limiting
                if len(contexts_to_process) > 1:
                    time.sleep(0.5)

        finally:
            with self._lock:
                self._processing = False

    def flush(self) -> None:
        """Force immediate processing of the queue.

        This is useful for testing or graceful shutdown.
        """
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

        self._process_queue()

    def clear(self) -> None:
        """Clear the queue without processing.

        This is useful for testing.
        """
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._queue.clear()
            self._processing = False

    @property
    def pending_count(self) -> int:
        """Get the number of pending updates."""
        with self._lock:
            return len(self._queue)

    @property
    def is_processing(self) -> bool:
        """Check if the queue is currently being processed."""
        with self._lock:
            return self._processing


# Global singleton instance
_memory_queue: MemoryUpdateQueue | None = None
_queue_lock = threading.Lock()


def get_memory_queue() -> MemoryUpdateQueue:
    """Get the global memory update queue singleton.

    Returns:
        The memory update queue instance.
    """
    global _memory_queue
    with _queue_lock:
        if _memory_queue is None:
            _memory_queue = MemoryUpdateQueue()
        return _memory_queue


def reset_memory_queue() -> None:
    """Reset the global memory queue.

    This is useful for testing.
    """
    global _memory_queue
    with _queue_lock:
        if _memory_queue is not None:
            _memory_queue.clear()
        _memory_queue = None
