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
        request_messages = _extract_chat_messages(messages)
        request_context = _extract_model_request_context(serialized, kwargs)
        self._record_start(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="llm",
            node_name=node_name,
            tool_name=None,
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
        self._record_start(
            run_id=run_id,
            parent_run_id=parent_run_id,
            run_type="tool",
            node_name=tool_name,
            tool_name=tool_name,
            payload={
                "tool_call": {
                    "name": tool_name,
                    "arguments": _shrink(parsed_input),
                    "inputs": _shrink(inputs),
                },
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
            payload={
                "tool_response": {"output": _shrink(output)},
                "output": _shrink(output),
            },
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
        reasoning_effort = invocation_params.get("reasoning_effort")
        tools = _extract_registered_tools(invocation_params.get("tools"))
        settings = _drop_none(
            {
                "temperature": _jsonify(temperature),
                "max_tokens": _jsonify(max_tokens),
                "reasoning_effort": _jsonify(reasoning_effort),
                "stop": _jsonify(stop),
            }
        )

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
        request["model"] = _resolve_name(serialized)

    return request


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
        for key in ("finish_reason", "stop_reason", "refusal"):
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
        return value


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
