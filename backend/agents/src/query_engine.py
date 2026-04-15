"""Runtime-side QueryEngine scaffolding for canonical run events.

This module is intentionally small in Phase 2. It does not replace the full
runtime loop yet; it consumes the currently exposed stream events and projects
them into the canonical run-event vocabulary so later runtime/gateway/frontend
migration work can share one event seam.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.client import StreamEvent


CANONICAL_RUN_EVENT_TYPES = (
    "run_started",
    "assistant_delta",
    "assistant_message",
    "tool_started",
    "tool_finished",
    "question_requested",
    "question_answered",
    "run_completed",
    "run_failed",
)


@dataclass(frozen=True)
class CanonicalRunEvent:
    """Small serializable run-event contract shared across adapters.

    The field layout intentionally mirrors the public `/v1/responses`
    `openagents.run_events` payload so the embedded runtime and public gateway
    can converge on the same event budget before they share the same storage.
    """

    event_index: int
    created_at: int
    type: str
    response_id: str | None = None
    delta: str | None = None
    text: str | None = None
    tool_name: str | None = None
    error: str | None = None
    question_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class CanonicalQueryEngine:
    """Normalize current runtime stream events into canonical run events.

    This adapter is the first QueryEngine-shaped runtime seam in Deer Flow:

    - input: legacy stream events (`messages-tuple`, `values`, `execution_event`)
    - output: canonical run events with stable ordering

    Phase 2 still derives these events from the current stream contract. Later
    phases should move the source of truth earlier in the runtime so this class
    consumes internal runtime events instead of legacy stream projections.
    """

    def __init__(self, *, response_id: str | None = None):
        self._response_id = response_id or f"resp_{uuid.uuid4().hex}"
        self._next_event_index = 0
        self._started = False
        self._completed = False
        self._last_assistant_text = ""
        self._started_tool_keys: set[str] = set()
        self._finished_tool_keys: set[str] = set()

    @property
    def response_id(self) -> str:
        return self._response_id

    def _new_event(self, event_type: str, **fields: Any) -> CanonicalRunEvent:
        self._next_event_index += 1
        return CanonicalRunEvent(
            event_index=self._next_event_index,
            created_at=int(time.time()),
            type=event_type,
            **fields,
        )

    def _ensure_started(self) -> list[CanonicalRunEvent]:
        if self._started:
            return []
        self._started = True
        return [
            self._new_event(
                "run_started",
                response_id=self._response_id,
            )
        ]

    def consume_stream_event(self, event: StreamEvent) -> list[CanonicalRunEvent]:
        """Convert one legacy stream event into zero or more canonical events."""

        emitted = [] if event.type == "end" else self._ensure_started()

        if event.type == "messages-tuple":
            message_type = event.data.get("type")
            if message_type == "ai":
                tool_calls = event.data.get("tool_calls")
                if isinstance(tool_calls, list):
                    for index, tool_call in enumerate(tool_calls):
                        if not isinstance(tool_call, dict):
                            continue
                        tool_name = str(tool_call.get("name") or "").strip()
                        if not tool_name:
                            continue
                        tool_key = str(tool_call.get("id") or f"{tool_name}:{index}")
                        if tool_key in self._started_tool_keys:
                            continue
                        self._started_tool_keys.add(tool_key)
                        emitted.append(
                            self._new_event(
                                "tool_started",
                                response_id=self._response_id,
                                tool_name=tool_name,
                            )
                        )

                text = str(event.data.get("content") or "")
                if text:
                    self._last_assistant_text = text
                    emitted.append(
                        self._new_event(
                            "assistant_delta",
                            response_id=self._response_id,
                            delta=text,
                        )
                    )

            elif message_type == "tool":
                tool_name = str(event.data.get("name") or "").strip() or None
                tool_key = str(
                    event.data.get("tool_call_id")
                    or event.data.get("id")
                    or tool_name
                    or f"tool-finished:{self._next_event_index + 1}"
                )
                if tool_key not in self._finished_tool_keys:
                    self._finished_tool_keys.add(tool_key)
                    emitted.append(
                        self._new_event(
                            "tool_finished",
                            response_id=self._response_id,
                            tool_name=tool_name,
                        )
                    )

        elif event.type == "execution_event":
            event_name = str(event.data.get("event") or "").strip()
            if event_name == "run_started" and not self._started:
                return self._ensure_started()

        elif event.type == "interrupts":
            interrupt_objects = event.data.get("__interrupt__")
            if isinstance(interrupt_objects, list):
                for index, interrupt in enumerate(interrupt_objects):
                    question_id = f"interrupt:{index}"
                    if isinstance(interrupt, dict):
                        value = interrupt.get("value")
                        if isinstance(value, dict):
                            request_id = value.get("request_id") or value.get("requestId")
                            if request_id:
                                question_id = str(request_id)
                    emitted.append(
                        self._new_event(
                            "question_requested",
                            response_id=self._response_id,
                            question_id=question_id,
                        )
                    )

        elif event.type == "end":
            if self._completed:
                return []
            self._completed = True
            if self._last_assistant_text:
                emitted.append(
                    self._new_event(
                        "assistant_message",
                        response_id=self._response_id,
                        text=self._last_assistant_text,
                    )
                )
            emitted.append(
                self._new_event(
                    "run_completed",
                    response_id=self._response_id,
                )
            )

        return emitted

    def fail(self, error: BaseException | str) -> CanonicalRunEvent:
        """Return a terminal failure event for an aborted or failed stream."""

        self._started = True
        self._completed = True
        return self._new_event(
            "run_failed",
            response_id=self._response_id,
            error=str(error).strip() or type(error).__name__,
        )
