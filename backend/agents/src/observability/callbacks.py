from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from langchain_core.callbacks.base import BaseCallbackHandler

from src.observability.store import TraceContext, get_trace_store, now_utc

logger = logging.getLogger(__name__)


@dataclass
class _RunState:
    run_id: str
    parent_run_id: str | None
    run_type: str
    node_name: str | None
    tool_name: str | None
    task_run_id: str | None
    started_at: Any


class AgentTraceCallbackHandler(BaseCallbackHandler):
    raise_error = False

    def __init__(
        self,
        *,
        trace_id: str,
        user_id: str | None,
        thread_id: str | None,
        agent_name: str | None,
        model_name: str | None,
        metadata: dict[str, Any] | None = None,
    ):
        super().__init__()
        self._trace_id = trace_id
        self._user_id = user_id
        self._thread_id = thread_id
        self._agent_name = agent_name
        self._model_name = model_name
        self._metadata = metadata or {}
        self._store = get_trace_store()
        self._root_run_id: str | None = None
        self._runs: dict[str, _RunState] = {}
        self._event_index = 0
        self._lock = threading.Lock()

    @property
    def trace_id(self) -> str:
        return self._trace_id

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        node_name = _resolve_name(serialized)
        self._record_start(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="chain",
            node_name=node_name,
            tool_name=None,
            payload={"inputs": _shrink(inputs), "metadata": _shrink(metadata), "tags": tags or []},
        )

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._record_end(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="chain",
            payload={"outputs": _shrink(outputs)},
        )

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._record_error(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="chain",
            error=error,
        )

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        node_name = _resolve_name(serialized)
        self._record_start(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="llm",
            node_name=node_name,
            tool_name=None,
            payload={
                "messages": _shrink(messages),
                "metadata": _shrink(metadata),
                "tags": tags or [],
            },
        )

    def on_llm_end(
        self,
        response: Any,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        **kwargs: Any,
    ) -> Any:
        in_tok, out_tok, total_tok = _extract_usage(response)
        self._record_end(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="llm",
            input_tokens=in_tok,
            output_tokens=out_tok,
            total_tokens=total_tok,
            payload={
                "llm_output": _shrink(getattr(response, "llm_output", None)),
                "tags": tags or [],
            },
        )

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        **kwargs: Any,
    ) -> Any:
        self._record_error(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="llm",
            error=error,
            payload={"tags": tags or []},
        )

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        inputs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        tool_name = _resolve_name(serialized)
        self._record_start(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="tool",
            node_name=tool_name,
            tool_name=tool_name,
            payload={
                "input_str": _shrink(input_str),
                "inputs": _shrink(inputs),
                "metadata": _shrink(metadata),
                "tags": tags or [],
            },
        )

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._record_end(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="tool",
            payload={"output": _shrink(output)},
        )

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        self._record_error(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="tool",
            error=error,
        )

    def _record_start(
        self,
        *,
        run_id: UUID,
        parent_run_id: UUID | None,
        run_type: str,
        node_name: str | None,
        tool_name: str | None,
        payload: dict[str, Any],
    ) -> None:
        if self._store is None:
            return
        run_id_text = str(run_id)
        parent_text = str(parent_run_id) if parent_run_id else None

        with self._lock:
            if self._root_run_id is None and parent_text is None:
                self._root_run_id = run_id_text
            if self._root_run_id is None:
                self._root_run_id = run_id_text

            parent_state = self._runs.get(parent_text) if parent_text else None
            task_run_id = parent_state.task_run_id if parent_state else None
            if run_type == "tool" and tool_name == "task":
                task_run_id = run_id_text

            run_state = _RunState(
                run_id=run_id_text,
                parent_run_id=parent_text,
                run_type=run_type,
                node_name=node_name,
                tool_name=tool_name,
                task_run_id=task_run_id,
                started_at=now_utc(),
            )
            self._runs[run_id_text] = run_state
            event_index = self._next_event_index()

        try:
            self._store.upsert_trace(
                TraceContext(
                    trace_id=self._trace_id,
                    root_run_id=self._root_run_id,
                    user_id=_coerce_uuid(self._user_id),
                    thread_id=self._thread_id,
                    agent_name=self._agent_name,
                    model_name=self._model_name,
                    metadata=self._metadata,
                )
            )
            self._store.append_event(
                trace_id=self._trace_id,
                event_index=event_index,
                run_id=run_state.run_id,
                parent_run_id=run_state.parent_run_id,
                run_type=run_state.run_type,
                event_type="start",
                node_name=run_state.node_name,
                tool_name=run_state.tool_name,
                task_run_id=run_state.task_run_id,
                started_at=run_state.started_at,
                finished_at=None,
                duration_ms=None,
                input_tokens=None,
                output_tokens=None,
                total_tokens=None,
                status="running",
                error=None,
                payload=payload,
            )
        except Exception:
            logger.exception("Failed to persist start trace event")

    def _record_end(
        self,
        *,
        run_id: UUID,
        parent_run_id: UUID | None,
        run_type: str,
        payload: dict[str, Any],
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        total_tokens: int | None = None,
    ) -> None:
        if self._store is None:
            return
        run_id_text = str(run_id)
        parent_text = str(parent_run_id) if parent_run_id else None
        finished_at = now_utc()

        with self._lock:
            state = self._runs.get(run_id_text)
            started_at = state.started_at if state else None
            duration_ms = _duration_ms(started_at, finished_at)
            task_run_id = state.task_run_id if state else None
            node_name = state.node_name if state else None
            tool_name = state.tool_name if state else None
            event_index = self._next_event_index()
            is_root = run_id_text == self._root_run_id

        try:
            self._store.append_event(
                trace_id=self._trace_id,
                event_index=event_index,
                run_id=run_id_text,
                parent_run_id=parent_text,
                run_type=run_type,
                event_type="end",
                node_name=node_name,
                tool_name=tool_name,
                task_run_id=task_run_id,
                started_at=started_at,
                finished_at=finished_at,
                duration_ms=duration_ms,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                status="completed",
                error=None,
                payload=payload,
            )
            if total_tokens:
                self._store.add_trace_tokens(
                    self._trace_id,
                    input_tokens or 0,
                    output_tokens or 0,
                    total_tokens,
                )
            if is_root:
                self._store.finish_trace(self._trace_id, status="completed")
        except Exception:
            logger.exception("Failed to persist end trace event")

    def _record_error(
        self,
        *,
        run_id: UUID,
        parent_run_id: UUID | None,
        run_type: str,
        error: BaseException,
        payload: dict[str, Any] | None = None,
    ) -> None:
        if self._store is None:
            return
        run_id_text = str(run_id)
        parent_text = str(parent_run_id) if parent_run_id else None
        finished_at = now_utc()
        err_text = str(error)

        with self._lock:
            state = self._runs.get(run_id_text)
            started_at = state.started_at if state else None
            duration_ms = _duration_ms(started_at, finished_at)
            task_run_id = state.task_run_id if state else None
            node_name = state.node_name if state else None
            tool_name = state.tool_name if state else None
            event_index = self._next_event_index()
            is_root = run_id_text == self._root_run_id

        try:
            self._store.append_event(
                trace_id=self._trace_id,
                event_index=event_index,
                run_id=run_id_text,
                parent_run_id=parent_text,
                run_type=run_type,
                event_type="error",
                node_name=node_name,
                tool_name=tool_name,
                task_run_id=task_run_id,
                started_at=started_at,
                finished_at=finished_at,
                duration_ms=duration_ms,
                input_tokens=None,
                output_tokens=None,
                total_tokens=None,
                status="error",
                error=err_text,
                payload=payload or {},
            )
            if is_root:
                self._store.finish_trace(self._trace_id, status="error", error=err_text)
        except Exception:
            logger.exception("Failed to persist error trace event")

    def _next_event_index(self) -> int:
        self._event_index += 1
        return self._event_index


def create_agent_trace_callback(
    *,
    user_id: str | None,
    thread_id: str | None,
    agent_name: str | None,
    model_name: str | None,
    metadata: dict[str, Any] | None = None,
) -> AgentTraceCallbackHandler | None:
    store = get_trace_store()
    if store is None:
        return None
    trace_id = str(uuid4())
    return AgentTraceCallbackHandler(
        trace_id=trace_id,
        user_id=user_id,
        thread_id=thread_id,
        agent_name=agent_name,
        model_name=model_name,
        metadata=metadata,
    )


def _coerce_uuid(value: str | None) -> UUID | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return UUID(text)
    except ValueError:
        return None


def _resolve_name(serialized: dict[str, Any] | None) -> str | None:
    if not serialized:
        return None
    name = serialized.get("name") if isinstance(serialized, dict) else None
    if isinstance(name, str) and name.strip():
        return name
    sid = serialized.get("id") if isinstance(serialized, dict) else None
    if isinstance(sid, list) and sid:
        tail = sid[-1]
        if isinstance(tail, str) and tail.strip():
            return tail
    if isinstance(sid, str) and sid.strip():
        return sid
    return None


def _duration_ms(started_at: Any, finished_at: Any) -> int | None:
    if started_at is None or finished_at is None:
        return None
    delta = finished_at - started_at
    return max(int(delta.total_seconds() * 1000), 0)


def _extract_usage(response: Any) -> tuple[int, int, int]:
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0

    llm_output = getattr(response, "llm_output", None)
    if isinstance(llm_output, dict):
        usage = llm_output.get("token_usage") or llm_output.get("usage")
        if isinstance(usage, dict):
            input_tokens = _to_int(
                usage.get("prompt_tokens")
                or usage.get("input_tokens")
                or usage.get("input_token_count")
            )
            output_tokens = _to_int(
                usage.get("completion_tokens")
                or usage.get("output_tokens")
                or usage.get("output_token_count")
            )
            total_tokens = _to_int(
                usage.get("total_tokens") or usage.get("total_token_count")
            )

    generations = getattr(response, "generations", None)
    if generations and isinstance(generations, list):
        for generation_list in generations:
            if not isinstance(generation_list, list):
                continue
            for generation in generation_list:
                message = getattr(generation, "message", None)
                usage_metadata = getattr(message, "usage_metadata", None)
                if isinstance(usage_metadata, dict):
                    input_tokens += _to_int(usage_metadata.get("input_tokens"))
                    output_tokens += _to_int(usage_metadata.get("output_tokens"))
                    total_tokens += _to_int(usage_metadata.get("total_tokens"))

    if total_tokens == 0:
        total_tokens = input_tokens + output_tokens

    return input_tokens, output_tokens, total_tokens


def _to_int(value: Any) -> int:
    if value is None:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _shrink(value: Any, *, max_len: int = 3000) -> Any:
    if value is None:
        return None
    try:
        text = json.dumps(value, ensure_ascii=True, default=str)
    except TypeError:
        text = json.dumps(str(value), ensure_ascii=True)
    if len(text) > max_len:
        return {"truncated": True, "preview": text[:max_len]}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text
