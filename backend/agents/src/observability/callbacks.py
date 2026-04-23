from __future__ import annotations

import ast
import json
import logging
import hashlib
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from langchain_core.callbacks.base import BaseCallbackHandler

from src.observability.store import TraceContext, get_trace_store, now_utc

logger = logging.getLogger(__name__)

DEFAULT_TRACE_STRING_LIMIT = 12_000
LARGE_TRACE_STRING_LIMIT = 120_000
TOOL_TRACE_STRING_LIMIT = 48_000
FILE_TOOL_TRACE_STRING_LIMIT = 120_000
DEFAULT_TRACE_MAX_ITEMS = 128
LARGE_TRACE_MAX_ITEMS = 256
TRACE_MAX_DEPTH = 16
FILE_IO_TOOL_NAMES = {"read_file", "write_file", "edit_file"}
TRACE_LINEAGE_METADATA_KEYS = (
    "thread_id",
    "agent_name",
    "agent_status",
    "execution_backend",
    "original_user_input_preview",
    "original_user_input_digest",
)


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

    @staticmethod
    def _tool_shrink(value: Any, *, tool_name: str | None) -> Any:
        max_string_len = (
            FILE_TOOL_TRACE_STRING_LIMIT
            if tool_name in FILE_IO_TOOL_NAMES
            else TOOL_TRACE_STRING_LIMIT
        )
        return _shrink(
            value,
            max_string_len=max_string_len,
            max_items=LARGE_TRACE_MAX_ITEMS,
            max_depth=TRACE_MAX_DEPTH,
        )

    @property
    def trace_id(self) -> str:
        return self._trace_id

    def record_system_event(
        self,
        *,
        node_name: str,
        payload: dict[str, Any],
        parent_run_id: str | None = None,
    ) -> None:
        """Persist an instant system event outside the standard callback hooks."""
        if self._store is None:
            return

        finished_at = now_utc()
        run_id_text = f"system:{node_name}:{uuid4()}"

        with self._lock:
            event_index = self._next_event_index()
            resolved_parent = parent_run_id or self._root_run_id

        try:
            self._store.append_event(
                trace_id=self._trace_id,
                event_index=event_index,
                run_id=run_id_text,
                parent_run_id=resolved_parent,
                run_type="system",
                event_type="end",
                node_name=node_name,
                tool_name=None,
                task_run_id=None,
                started_at=finished_at,
                finished_at=finished_at,
                duration_ms=0,
                input_tokens=None,
                output_tokens=None,
                total_tokens=None,
                status="completed",
                error=None,
                payload=_shrink(payload),
            )
        except Exception:
            logger.exception("Failed to persist system trace event")

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
            payload=_augment_trace_payload(
                payload={"inputs": _shrink(inputs), "metadata": _shrink(metadata), "tags": tags or []},
                metadata=metadata,
                input_value=inputs,
            ),
        )

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        context_window = _extract_context_window_payload(outputs)
        if context_window:
            self.record_system_event(
                node_name="ContextWindow",
                payload={"context_window": context_window},
                parent_run_id=str(run_id),
            )
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
        request_messages = _extract_chat_messages(messages)
        request_context = _extract_model_request_context(serialized, kwargs)
        self._record_start(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="llm",
            node_name=node_name,
            tool_name=None,
            payload=_augment_trace_payload(
                payload={
                    "model_request": _drop_none(
                        {
                            "messages": _shrink(
                                request_messages,
                                max_string_len=200000,
                                max_items=256,
                                max_depth=16,
                            ),
                            **request_context,
                        }
                    ),
                    "metadata": _shrink(metadata),
                    "tags": tags or [],
                },
                metadata=metadata,
                input_value=request_messages,
            ),
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
        response_messages = _extract_response_messages(response)
        response_tool_calls = _extract_tool_calls(response_messages)
        self._record_end(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="llm",
            input_tokens=in_tok,
            output_tokens=out_tok,
            total_tokens=total_tok,
            payload={
                "model_response": {
                    "messages": _shrink(
                        response_messages,
                        max_string_len=120000,
                        max_items=256,
                        max_depth=16,
                    ),
                    "tool_calls": _shrink(
                        response_tool_calls,
                        max_string_len=120000,
                        max_items=256,
                        max_depth=16,
                    ),
                },
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
        parsed_input = _try_parse_json(input_str)
        payload = {
            "tool_call": {
                "name": tool_name,
                "arguments": self._tool_shrink(parsed_input, tool_name=tool_name),
                "inputs": self._tool_shrink(inputs, tool_name=tool_name),
            },
            "input_str": self._tool_shrink(input_str, tool_name=tool_name),
            "inputs": self._tool_shrink(inputs, tool_name=tool_name),
            "metadata": _shrink(metadata),
            "tags": tags or [],
        }
        normalized_tool_input = parsed_input if parsed_input is not None else inputs
        if tool_name == "task":
            payload["delegation"] = _build_task_delegation_payload(
                parsed_input=normalized_tool_input,
                run_id_text=str(run_id),
                parent_run_id=parent_run_id,
            )
        elif tool_name == "execute":
            payload["execution"] = _build_execution_payload(
                parsed_input=normalized_tool_input,
                metadata=metadata,
                launch_status="started",
            )
        self._record_start(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="tool",
            node_name=tool_name,
            tool_name=tool_name,
            payload=_augment_trace_payload(
                payload=payload,
                metadata=metadata,
                input_value=parsed_input if parsed_input is not None else inputs,
            ),
        )

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        run_id_text = str(run_id)
        with self._lock:
            state = self._runs.get(run_id_text)
            tool_name = state.tool_name if state else None

        self._record_end(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="tool",
            payload=_augment_tool_end_payload(
                tool_name=tool_name,
                payload={
                "tool_response": {
                    "output": self._tool_shrink(output, tool_name=tool_name),
                },
                "output": self._tool_shrink(output, tool_name=tool_name),
                },
                output=output,
            ),
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
            payload=_augment_tool_error_payload(
                tool_name=_tool_name_for_run(self._runs, run_id),
                error=error,
            ),
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


def _tool_name_for_run(
    runs: dict[str, _RunState],
    run_id: UUID,
) -> str | None:
    state = runs.get(str(run_id))
    return state.tool_name if state else None


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
            input_tokens = _to_int(usage.get("prompt_tokens") or usage.get("input_tokens") or usage.get("input_token_count"))
            output_tokens = _to_int(usage.get("completion_tokens") or usage.get("output_tokens") or usage.get("output_token_count"))
            total_tokens = _to_int(usage.get("total_tokens") or usage.get("total_token_count"))

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


def _truncate_summary_text(value: str, max_len: int = 240) -> str:
    text = " ".join(value.split()).strip()
    if len(text) <= max_len:
        return text
    return f"{text[: max_len - 3].rstrip()}..."


def _extract_text_blocks(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        text_values: list[str] = []
        direct_text = value.get("text")
        if isinstance(direct_text, str):
            text_values.append(direct_text)
        direct_content = value.get("content")
        if direct_content is not None:
            text_values.extend(_extract_text_blocks(direct_content))
        return text_values
    if isinstance(value, list | tuple):
        collected: list[str] = []
        for item in value:
            collected.extend(_extract_text_blocks(item))
        return collected
    return []


def _last_human_input_text(value: Any, depth: int = 0) -> str:
    if depth > 8 or value is None:
        return ""
    if isinstance(value, dict):
        role = str(value.get("type") or value.get("role") or "").strip().lower()
        if role == "human":
            text = "\n".join(
                part.strip()
                for part in _extract_text_blocks(value.get("content"))
                if part.strip()
            ).strip()
            if text:
                return text
        for nested_key in ("messages", "inputs", "state", "values", "update", "output", "outputs"):
            if nested_key in value:
                candidate = _last_human_input_text(value.get(nested_key), depth + 1)
                if candidate:
                    return candidate
        for nested_value in reversed(list(value.values())):
            candidate = _last_human_input_text(nested_value, depth + 1)
            if candidate:
                return candidate
        return ""
    if isinstance(value, list | tuple):
        for item in reversed(value):
            candidate = _last_human_input_text(item, depth + 1)
            if candidate:
                return candidate
    return ""


def _lineage_payload(
    metadata: dict[str, Any] | None,
    *,
    input_value: Any = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    source = metadata if isinstance(metadata, dict) else {}
    for key in TRACE_LINEAGE_METADATA_KEYS:
        raw = source.get(key)
        if raw is None:
            continue
        payload[key] = _jsonify(raw)

    for key in ("run_id", "langgraph_request_id", "checkpoint_ns"):
        raw = source.get(key)
        if raw is None:
            continue
        payload[key] = _jsonify(raw)

    input_text = _last_human_input_text(input_value)
    if input_text:
        payload["input_digest"] = hashlib.sha256(input_text.encode("utf-8")).hexdigest()
        payload["input_preview"] = _truncate_summary_text(input_text)

    return payload


def _augment_trace_payload(
    *,
    payload: dict[str, Any],
    metadata: dict[str, Any] | None,
    input_value: Any = None,
) -> dict[str, Any]:
    lineage = _lineage_payload(metadata, input_value=input_value)
    if lineage:
        payload["lineage"] = _shrink(lineage)
    return payload


def _coerce_record(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, Mapping):
        return dict(value)
    return {}


def _task_launch_failure_class(parsed_input: dict[str, Any]) -> str | None:
    if not parsed_input:
        return "missing_task_arguments"
    if not str(parsed_input.get("description") or "").strip():
        return "missing_task_description"
    if not str(parsed_input.get("prompt") or "").strip():
        return "missing_task_prompt"
    return None


def _build_task_delegation_payload(
    *,
    parsed_input: Any,
    run_id_text: str,
    parent_run_id: UUID | None,
) -> dict[str, Any]:
    task_args = _coerce_record(parsed_input)
    description = str(task_args.get("description") or "").strip()
    prompt = str(task_args.get("prompt") or "").strip()
    brief_source = description or prompt
    # Claude Code defaults omitted `subagent_type` to general-purpose when the
    # caller is not using the fork path. Deer Flow mirrors that minimal
    # contract, so observability records the effective type rather than
    # treating omission as invalid input.
    subagent_type = str(task_args.get("subagent_type") or "").strip() or "general-purpose"
    failure_class = _task_launch_failure_class(task_args)
    return {
        "schema_version": 1,
        "task_session_id": run_id_text,
        "parent_run_id": str(parent_run_id) if parent_run_id else None,
        "effective_agent_name": subagent_type,
        "brief_summary": _truncate_summary_text(brief_source) if brief_source else None,
        "description": description or None,
        "prompt_preview": _truncate_summary_text(prompt, max_len=400) if prompt else None,
        "validation_status": "valid" if failure_class is None else "invalid",
        "launch_failure_class": failure_class,
        "anomaly_flags": [failure_class] if failure_class is not None else [],
    }


def _build_execution_payload(
    *,
    parsed_input: Any,
    metadata: dict[str, Any] | None,
    launch_status: str,
    output: Any = None,
    error: BaseException | None = None,
) -> dict[str, Any]:
    execute_args = _coerce_record(parsed_input)
    execution_backend = None
    timeout_contract = {}
    if isinstance(metadata, dict):
        execution_backend = str(metadata.get("execution_backend") or "").strip() or None
        timeout_contract = _coerce_record(metadata.get("execute_timeout_contract"))
    requested_timeout = execute_args.get("timeout")
    requested_timeout_seconds = requested_timeout if isinstance(requested_timeout, int) else None
    payload: dict[str, Any] = {
        "schema_version": 1,
        "execution_backend": execution_backend,
        "launch_status": launch_status,
        "requested_timeout_seconds": requested_timeout_seconds,
        "max_timeout_seconds": timeout_contract.get("max_timeout_seconds"),
        "default_timeout_seconds_hint": timeout_contract.get("default_timeout_seconds"),
        "background_intent": "foreground_only",
    }
    if isinstance(output, str):
        payload["output_truncated"] = "[Output was truncated due to size limits]" in output
    if error is not None:
        err_text = str(error)
        if "exceeds maximum allowed" in err_text:
            payload["launch_failure_class"] = "timeout_exceeds_max"
        elif "timeout must be non-negative" in err_text:
            payload["launch_failure_class"] = "invalid_timeout"
        else:
            payload["launch_failure_class"] = "execute_tool_error"
        payload["anomaly_flags"] = [payload["launch_failure_class"]]
    return payload


def _augment_tool_end_payload(
    *,
    tool_name: str | None,
    payload: dict[str, Any],
    output: Any,
) -> dict[str, Any]:
    if tool_name == "execute":
        payload["execution"] = _build_execution_payload(
            parsed_input=None,
            metadata=None,
            launch_status="completed",
            output=output,
        )
    return payload


def _classify_task_launch_failure(error_text: str) -> str:
    lowered = error_text.lower()
    if "description" in lowered and "required" in lowered:
        return "missing_task_description"
    if "prompt" in lowered and "required" in lowered:
        return "missing_task_prompt"
    if "validation error" in lowered:
        return "invalid_task_arguments"
    return "task_tool_error"


def _augment_tool_error_payload(
    *,
    tool_name: str | None,
    error: BaseException,
) -> dict[str, Any]:
    if tool_name == "task":
        return {
            "delegation": {
                "schema_version": 1,
                "validation_status": "invalid",
                "launch_failure_class": _classify_task_launch_failure(str(error)),
                "anomaly_flags": [_classify_task_launch_failure(str(error))],
            }
        }
    if tool_name == "execute":
        return {
            "execution": _build_execution_payload(
                parsed_input=None,
                metadata=None,
                launch_status="error",
                error=error,
            )
        }
    return {}


def _extract_chat_messages(messages: list[list[Any]]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    is_batched = len(messages) > 1
    for batch_index, batch in enumerate(messages):
        if not isinstance(batch, list):
            continue
        for message in batch:
            item = _serialize_message(message)
            if is_batched:
                item["batch_index"] = batch_index
            flattened.append(item)
    return flattened


def _extract_response_messages(response: Any) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    generations = getattr(response, "generations", None)
    if not isinstance(generations, list):
        return messages

    for generation_list in generations:
        if not isinstance(generation_list, list):
            continue
        for generation in generation_list:
            message = getattr(generation, "message", None)
            if message is not None:
                messages.append(_serialize_message(message))
                continue
            text = getattr(generation, "text", None)
            if text not in (None, ""):
                messages.append({"role": "assistant", "content": _jsonify(text)})
    return messages


def _extract_tool_calls(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for message in messages:
        raw_calls = message.get("tool_calls")
        if not isinstance(raw_calls, list):
            continue
        for raw_call in raw_calls:
            normalized = _normalize_tool_call(raw_call)
            if normalized:
                calls.append(normalized)
    return calls


def _extract_model_request_context(
    serialized: dict[str, Any] | None,
    kwargs: dict[str, Any],
) -> dict[str, Any]:
    request: dict[str, Any] = {}
    invocation_params = kwargs.get("invocation_params")
    options = kwargs.get("options")

    if isinstance(invocation_params, dict):
        model_name = _first_non_empty_str(
            invocation_params.get("model_name"),
            invocation_params.get("model"),
            invocation_params.get("model_id"),
        )
        provider = _first_non_empty_str(
            invocation_params.get("_type"),
            invocation_params.get("provider"),
        )
        tool_choice = invocation_params.get("tool_choice")
        parallel_tool_calls = invocation_params.get("parallel_tool_calls")
        response_format = invocation_params.get("response_format")
        extra_body = invocation_params.get("extra_body")
        stop = invocation_params.get("stop")
        temperature = invocation_params.get("temperature")
        max_tokens = invocation_params.get("max_tokens")
        effort = _first_non_empty_str(invocation_params.get("effort"))
        reasoning_effort = _first_non_empty_str(invocation_params.get("reasoning_effort"))
        thinking_level = _first_non_empty_str(invocation_params.get("thinking_level"))
        reasoning = invocation_params.get("reasoning")
        thinking = invocation_params.get("thinking")
        thinking_budget = invocation_params.get("thinking_budget")
        include_thoughts = invocation_params.get("include_thoughts")
        tools = _extract_registered_tools(invocation_params.get("tools"))
        settings = _drop_none(
            {
                "temperature": _jsonify(temperature),
                "max_tokens": _jsonify(max_tokens),
                "effort": _jsonify(effort),
                # Persist the provider-facing reasoning knobs directly so trace
                # review can prove which payload the runtime actually sent.
                "reasoning_effort": _jsonify(reasoning_effort),
                "reasoning": _shrink(reasoning),
                "thinking": _shrink(thinking),
                "thinking_budget": _jsonify(thinking_budget),
                "thinking_level": _jsonify(thinking_level),
                "include_thoughts": _jsonify(include_thoughts),
                "stop": _jsonify(stop),
            }
        )

        # Persist enough of the invocation params to explain model behavior in traces,
        # but aggressively shrink large nested payloads so observability storage does
        # not balloon on tool schemas or provider-specific request bodies.
        request.update(
            _drop_none(
                {
                    "model": model_name,
                    "provider": provider,
                    "tool_choice": _jsonify(tool_choice),
                    "parallel_tool_calls": _jsonify(parallel_tool_calls),
                    "response_format": _shrink(response_format),
                    "extra_body": _shrink(extra_body),
                    "settings": _shrink(settings) if settings else None,
                    "tools": _shrink(
                        tools,
                        max_string_len=120000,
                        max_items=256,
                        max_depth=16,
                    )
                    if tools
                    else None,
                }
            )
        )

    if isinstance(options, dict):
        option_settings = _drop_none(
            {
                "stop": _jsonify(options.get("stop")),
                "structured_output": _jsonify(options.get("ls_structured_output_format")),
            }
        )
        if option_settings:
            request["options"] = _shrink(option_settings)

    if "model" not in request:
        # Some integrations omit invocation_params on replayed runs. Fall back to the
        # serialized runnable name so the trace still shows which model was involved.
        request["model"] = _resolve_name(serialized)

    return request


def _extract_context_window_payload(outputs: Any) -> dict[str, Any] | None:
    return _find_direct_context_window(outputs)


def _find_direct_context_window(value: Any, depth: int = 0) -> dict[str, Any] | None:
    if depth > TRACE_MAX_DEPTH or value is None:
        return None

    if isinstance(value, dict):
        context_window = value.get("context_window")
        if isinstance(context_window, dict):
            return _jsonify(context_window)

        # LangGraph may wrap middleware updates under several container keys depending on
        # whether we are looking at raw outputs, Command updates, or persisted state values.
        for nested_key in ("update", "outputs", "values"):
            if nested_key in value:
                candidate = _find_direct_context_window(value.get(nested_key), depth + 1)
                if candidate:
                    return candidate

        for nested_value in value.values():
            candidate = _find_direct_context_window(nested_value, depth + 1)
            if candidate:
                return candidate
        return None

    update = getattr(value, "update", None)
    if update is not None and not callable(update):
        candidate = _find_direct_context_window(update, depth + 1)
        if candidate:
            return candidate

    if isinstance(value, (list, tuple, set)):
        for item in value:
            candidate = _find_direct_context_window(item, depth + 1)
            if candidate:
                return candidate

    return None


def _serialize_message(message: Any) -> dict[str, Any]:
    serialized: dict[str, Any] = {}

    role = _as_non_empty_str(getattr(message, "type", None)) or _as_non_empty_str(getattr(message, "role", None))
    if role:
        serialized["role"] = role

    content = getattr(message, "content", None)
    if content is not None:
        serialized["content"] = _jsonify(content)

    message_id = _as_non_empty_str(getattr(message, "id", None))
    if message_id:
        serialized["id"] = message_id

    name = _as_non_empty_str(getattr(message, "name", None))
    if name:
        serialized["name"] = name

    tool_call_id = _as_non_empty_str(getattr(message, "tool_call_id", None))
    if tool_call_id:
        serialized["tool_call_id"] = tool_call_id

    tool_calls = _extract_message_tool_calls(message)
    if tool_calls:
        serialized["tool_calls"] = tool_calls

    response_metadata = getattr(message, "response_metadata", None)
    if response_metadata:
        serialized["response_metadata"] = _jsonify(response_metadata)

    additional_kwargs = getattr(message, "additional_kwargs", None)
    if isinstance(additional_kwargs, dict):
        extra: dict[str, Any] = {}
        for key in ("finish_reason", "stop_reason", "refusal", "reasoning_content"):
            if key in additional_kwargs:
                extra[key] = _jsonify(additional_kwargs.get(key))
        if extra:
            serialized["additional_kwargs"] = extra

    if serialized:
        return serialized
    return {"raw": str(message)}


def _extract_message_tool_calls(message: Any) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    direct_calls = getattr(message, "tool_calls", None)
    if isinstance(direct_calls, list):
        for call in direct_calls:
            normalized = _normalize_tool_call(call)
            if normalized:
                calls.append(normalized)

    additional_kwargs = getattr(message, "additional_kwargs", None)
    if isinstance(additional_kwargs, dict):
        raw_calls = additional_kwargs.get("tool_calls")
        if isinstance(raw_calls, list):
            for raw_call in raw_calls:
                normalized = _normalize_tool_call(raw_call)
                if normalized:
                    calls.append(normalized)
    return calls


def _normalize_tool_call(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        if isinstance(value.get("function"), dict):
            function = value.get("function") or {}
            arguments = function.get("arguments")
            parsed_args = _try_parse_json(arguments)
            normalized = _drop_none(
                {
                    "id": _as_non_empty_str(value.get("id")),
                    "name": _as_non_empty_str(function.get("name")),
                    "type": _as_non_empty_str(value.get("type")) or "tool_call",
                    "arguments": _jsonify(parsed_args),
                }
            )
            return normalized or {"raw": _jsonify(value)}

        arguments = value.get("args")
        if arguments is None:
            arguments = value.get("arguments")
        parsed_args = _try_parse_json(arguments)
        normalized = _drop_none(
            {
                "id": _as_non_empty_str(value.get("id")),
                "name": _as_non_empty_str(value.get("name")),
                "type": _as_non_empty_str(value.get("type")),
                "arguments": _jsonify(parsed_args),
            }
        )
        return normalized or {"raw": _jsonify(value)}
    return {"raw": _jsonify(value)}


def _extract_registered_tools(raw_tools: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_tools, list):
        return []

    tools: list[dict[str, Any]] = []
    for raw_tool in raw_tools:
        normalized = _normalize_registered_tool(raw_tool)
        if normalized:
            tools.append(normalized)
    return tools


def _normalize_registered_tool(value: Any) -> dict[str, Any] | None:
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    elif hasattr(value, "dict"):
        value = value.dict()

    payload = _jsonify(value)
    if not isinstance(payload, dict):
        return {"raw": payload}

    if isinstance(payload.get("function"), dict):
        function = payload.get("function") or {}
        return _drop_none(
            {
                "type": _as_non_empty_str(payload.get("type")) or "function",
                "name": _as_non_empty_str(function.get("name")),
                "description": _jsonify(function.get("description")),
                "parameters": _jsonify(function.get("parameters") or function.get("input_schema")),
                "strict": _jsonify(function.get("strict")),
            }
        ) or {"raw": payload}

    return _drop_none(
        {
            "type": _as_non_empty_str(payload.get("type")),
            "name": _as_non_empty_str(payload.get("name")),
            "description": _jsonify(payload.get("description")),
            "parameters": _jsonify(payload.get("parameters") or payload.get("input_schema")),
            "strict": _jsonify(payload.get("strict")),
        }
    ) or {"raw": payload}


def _jsonify(value: Any) -> Any:
    if value is None:
        return None
    try:
        text = json.dumps(value, ensure_ascii=True, default=str)
    except TypeError:
        return str(value)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _try_parse_json(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        return _jsonify(value)
    text = value.strip()
    if not text:
        return ""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # LangChain often passes tool input strings as Python-style repr dicts
        # with single quotes. Accept that shape so trace payloads stay grounded
        # on the real tool arguments instead of falling back to string-only
        # error classification.
        try:
            parsed = ast.literal_eval(text)
        except (SyntaxError, ValueError):
            return value
        return _jsonify(parsed)


def _as_non_empty_str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _first_non_empty_str(*values: Any) -> str | None:
    for value in values:
        text = _as_non_empty_str(value)
        if text is not None:
            return text
    return None


def _drop_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def _to_int(value: Any) -> int:
    if value is None:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _truncate_text(value: str, max_len: int) -> str:
    if len(value) <= max_len:
        return value
    omitted = len(value) - max_len
    return f"{value[:max_len]}\n...[truncated {omitted} chars]"


def _shrink(
    value: Any,
    *,
    max_string_len: int = 12000,
    max_items: int = 128,
    max_depth: int = 10,
) -> Any:
    if value is None:
        return None
    normalized = _jsonify(value)
    return _shrink_value(
        normalized,
        depth=0,
        max_string_len=max_string_len,
        max_items=max_items,
        max_depth=max_depth,
    )


def _shrink_value(
    value: Any,
    *,
    depth: int,
    max_string_len: int,
    max_items: int,
    max_depth: int,
) -> Any:
    if value is None:
        return None
    if depth >= max_depth:
        return _truncate_text(json.dumps(value, ensure_ascii=True, default=str), max_string_len)
    if isinstance(value, str):
        return _truncate_text(value, max_string_len)
    if isinstance(value, list):
        items = [
            _shrink_value(
                item,
                depth=depth + 1,
                max_string_len=max_string_len,
                max_items=max_items,
                max_depth=max_depth,
            )
            for item in value[:max_items]
        ]
        if len(value) > max_items:
            items.append(
                {
                    "truncated": True,
                    "omitted_items": len(value) - max_items,
                }
            )
        return items
    if isinstance(value, dict):
        items = list(value.items())
        shrunken = {
            str(key): _shrink_value(
                item,
                depth=depth + 1,
                max_string_len=max_string_len,
                max_items=max_items,
                max_depth=max_depth,
            )
            for key, item in items[:max_items]
        }
        if len(items) > max_items:
            shrunken["__truncated__"] = {
                "omitted_keys": len(items) - max_items,
            }
        return shrunken
    return value
