from __future__ import annotations

import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Literal, NotRequired, cast, override

from deepagents.middleware.summarization import (
    SummarizationMiddleware,
    compute_summarization_defaults,
)
from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.summarization import ContextSize
from langchain.agents.middleware.types import ExtendedModelResponse, ModelRequest, ModelResponse
from langchain_core.messages import AnyMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.messages.utils import count_tokens_approximately
from langgraph.types import Command

from src.agents.thread_state import (
    ContextWindowKeepState,
    ContextWindowState,
    ContextWindowSummaryState,
    ContextWindowThresholdState,
)
from src.config.summarization_config import get_summarization_config

ContextSizeType = Literal["fraction", "messages", "tokens"]
ContextSizeValue = int | float
ContextSizeTuple = ContextSize

_SUMMARY_TAG_PATTERN = re.compile(r"<summary>\s*(.*?)\s*</summary>", re.DOTALL)
_SUMMARY_FILE_PATH_PATTERN = re.compile(
    r"saved to\s+(?P<path>\S+)\s+should you need",
    re.IGNORECASE,
)


class ContextWindowMiddlewareState(AgentState):
    """State schema for context-window telemetry."""

    context_window: NotRequired[ContextWindowState | None]


class ContextWindowMiddleware(AgentMiddleware[ContextWindowMiddlewareState]):
    """Persist an approximate context-window snapshot for every model call."""

    state_schema: type[ContextWindowMiddlewareState] = ContextWindowMiddlewareState

    def _build_snapshot(self, request: ModelRequest[Any]) -> ContextWindowState:
        helper, trigger, keep = _build_summarization_helper(request)
        now = _utcnow()

        raw_state_messages = request.state.get("messages", request.messages)
        state_messages = list(cast(Sequence[AnyMessage], raw_state_messages))
        prior_event = request.state.get("_summarization_event")
        previous_state = request.state.get("context_window")
        previous_context: Mapping[str, Any] = (
            cast(Mapping[str, Any], previous_state)
            if isinstance(previous_state, Mapping)
            else {}
        )

        # Reconstruct the prompt as it looked before the current summarization step,
        # so thresholds and token usage reflect the pressure that triggered compaction.
        pre_summary_messages = helper._apply_event_to_messages(state_messages, prior_event)
        pre_summary_messages, _ = helper._truncate_args(
            pre_summary_messages,
            request.system_message,
            request.tools,
        )

        active_messages = list(request.messages)
        # A freshly applied summary appears as a synthetic first HumanMessage. Compare it
        # with the prior event so we can tell a new compaction apart from an old one being replayed.
        current_summary_message = _current_summary_message(active_messages)
        prior_summary_message = _event_summary_message(prior_event)
        summary_applied = (
            current_summary_message is not None
            and not _messages_equivalent(current_summary_message, prior_summary_message)
        )

        raw_message_count = len(state_messages)
        pre_summary_count = len(pre_summary_messages)
        active_count = len(active_messages)
        pre_summary_tokens = _count_tokens(
            pre_summary_messages,
            system_message=request.system_message,
            tools=request.tools,
        )
        active_tokens = _count_tokens(
            active_messages,
            system_message=request.system_message,
            tools=request.tools,
        )
        max_input_tokens = _resolve_max_input_tokens(request.model)

        thresholds = _build_thresholds(
            trigger=trigger,
            total_tokens=pre_summary_tokens,
            message_count=pre_summary_count,
            max_input_tokens=max_input_tokens,
        )
        trigger_reasons = [
            label
            for threshold in thresholds
            if threshold.get("matched") is True
            for label in [threshold.get("label")]
            if isinstance(label, str) and label
        ]
        triggered = any(threshold.get("matched") is True for threshold in thresholds)

        summary_count = _previous_summary_count(previous_context, prior_event)
        last_summary = _previous_last_summary(previous_context, prior_event)

        # Build incrementally as a plain dict, then convert once at the boundary.
        # This keeps the assembly readable and avoids TypedDict.update overload issues in pyright.
        snapshot: dict[str, Any] = {
            "updated_at": now,
            "max_input_tokens": max_input_tokens,
            "raw_message_count": raw_message_count,
            "trigger_thresholds": thresholds,
            "trigger_reasons": trigger_reasons,
            "keep": _to_context_window_keep_state(
                {
                    "type": keep[0],
                    "value": keep[1],
                }
            ),
        }

        if summary_applied:
            summarized_message_count = max(0, pre_summary_count - max(0, active_count - 1))
            # Persist both the cutoff within the effective prompt for this step and the
            # cumulative cutoff against the original thread history for UI/trace consumers.
            state_cutoff_index = _compute_state_cutoff(
                prior_event,
                summarized_message_count,
            )
            summary_count += 1
            triggered = True

            if not trigger_reasons:
                trigger_reasons = ["summary applied"]

            last_summary = _to_context_window_summary_state(
                {
                    "created_at": now,
                    "cutoff_index": summarized_message_count or None,
                    "state_cutoff_index": state_cutoff_index or None,
                    "summarized_message_count": summarized_message_count or None,
                    "preserved_message_count": max(0, active_count - 1),
                    "file_path": _extract_summary_file_path(current_summary_message),
                    "summary_preview": _extract_summary_preview(current_summary_message),
                }
            )

            snapshot |= {
                "approx_input_tokens": pre_summary_tokens,
                "approx_input_tokens_after_summary": active_tokens,
                "usage_ratio": _usage_ratio(pre_summary_tokens, max_input_tokens),
                "usage_ratio_after_summary": _usage_ratio(active_tokens, max_input_tokens),
                "effective_message_count": pre_summary_count,
                "effective_message_count_after_summary": active_count,
                "trigger_reasons": trigger_reasons,
                "triggered": True,
                "summary_applied": True,
                "summary_count": summary_count,
                "last_summary": last_summary,
            }
            return _to_context_window_state(snapshot)

        snapshot |= {
            "approx_input_tokens": active_tokens,
            "usage_ratio": _usage_ratio(active_tokens, max_input_tokens),
            "effective_message_count": active_count,
            "triggered": triggered,
            "summary_applied": False,
            "summary_count": summary_count or None,
            "last_summary": last_summary,
        }
        return _to_context_window_state(snapshot)

    @override
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any] | ExtendedModelResponse[Any]:
        snapshot = self._build_snapshot(request)
        response = handler(request)
        return ExtendedModelResponse(
            model_response=response,
            command=Command(update={"context_window": snapshot}),
        )

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any] | ExtendedModelResponse[Any]:
        snapshot = self._build_snapshot(request)
        response = await handler(request)
        return ExtendedModelResponse(
            model_response=response,
            command=Command(update={"context_window": snapshot}),
        )


def _build_summarization_helper(
    request: ModelRequest[Any],
) -> tuple[SummarizationMiddleware, list[ContextSizeTuple], ContextSizeTuple]:
    # Reuse the same trigger/keep policy as the real summarization middleware so the
    # telemetry reflects runtime behavior instead of a parallel approximation.
    defaults = compute_summarization_defaults(request.model)
    trigger: ContextSizeTuple | list[ContextSizeTuple] = cast(
        ContextSizeTuple | list[ContextSizeTuple],
        defaults["trigger"],
    )
    keep: ContextSizeTuple = defaults["keep"]
    trim_tokens_to_summarize: int | None = None
    summary_prompt: str | None = None

    try:
        config = get_summarization_config()
    except Exception:
        config = None

    if config is not None and getattr(config, "enabled", False):
        if getattr(config, "trigger", None) is not None:
            trigger = _coerce_context_sizes(config.trigger)
        if getattr(config, "keep", None) is not None:
            keep = _coerce_context_size(config.keep)
        trim_tokens_to_summarize = getattr(config, "trim_tokens_to_summarize", None)
        summary_prompt = getattr(config, "summary_prompt", None)

    # This helper mirrors summarization decisions for telemetry only. The live
    # summarization middleware owns persistence, so this probe intentionally runs
    # without a backend and never writes conversation history on its own.
    helper = SummarizationMiddleware(
        model=request.model,
        backend=cast(Any, None),
        trigger=trigger,
        keep=keep,
        trim_tokens_to_summarize=trim_tokens_to_summarize,
        summary_prompt=summary_prompt or "",
        truncate_args_settings=defaults["truncate_args_settings"],
    )
    return helper, _ensure_context_size_list(trigger), keep


def _coerce_context_sizes(value: Any) -> ContextSizeTuple | list[ContextSizeTuple]:
    if isinstance(value, list):
        return [_coerce_context_size(item) for item in value]
    return _coerce_context_size(value)


def _coerce_context_size(value: Any) -> ContextSizeTuple:
    if isinstance(value, tuple):
        if len(value) != 2:
            raise TypeError(f"Unsupported context-size tuple: {value!r}")
        return cast(ContextSizeTuple, value)
    if hasattr(value, "to_tuple"):
        return cast(ContextSizeTuple, value.to_tuple())
    if isinstance(value, dict):
        return cast(
            "ContextSizeTuple",
            (
                str(value.get("type") or "messages"),
                cast("ContextSizeValue", value.get("value") or 0),
            ),
        )
    raise TypeError(f"Unsupported context-size value: {value!r}")


def _ensure_context_size_list(
    value: ContextSizeTuple | list[ContextSizeTuple],
) -> list[ContextSizeTuple]:
    if isinstance(value, list):
        return value
    return [value]


def _build_thresholds(
    *,
    trigger: list[ContextSizeTuple],
    total_tokens: int,
    message_count: int,
    max_input_tokens: int | None,
) -> list[ContextWindowThresholdState]:
    thresholds: list[ContextWindowThresholdState] = []

    for threshold_type, raw_value in trigger:
        current: float | int | None
        matched = False
        label = _format_threshold_label(threshold_type, raw_value)
        if threshold_type == "messages":
            current = message_count
            matched = current >= int(raw_value)
        elif threshold_type == "tokens":
            current = total_tokens
            matched = current >= int(raw_value)
        elif threshold_type == "fraction":
            if max_input_tokens is None or max_input_tokens <= 0:
                current = None
            else:
                current = round(total_tokens / max_input_tokens, 6)
                matched = current >= float(raw_value)
        else:
            current = None

        thresholds.append(
            _to_context_window_threshold_state(
                {
                    "type": threshold_type,
                    "value": raw_value,
                    "current": current,
                    "matched": matched,
                    "label": label,
                }
            )
        )

    return thresholds


def _format_threshold_label(threshold_type: ContextSizeType, value: ContextSizeValue) -> str:
    if threshold_type == "fraction":
        return f"{round(float(value) * 100)}% of context window"
    if threshold_type == "tokens":
        return f"{int(value):,} input tokens"
    return f"{int(value)} messages"


def _usage_ratio(tokens: int, max_input_tokens: int | None) -> float | None:
    if max_input_tokens is None or max_input_tokens <= 0:
        return None
    return round(tokens / max_input_tokens, 6)


def _count_tokens(
    messages: Sequence[AnyMessage],
    *,
    system_message: SystemMessage | None,
    tools: list[Any] | None,
) -> int:
    counted_messages = [system_message, *messages] if system_message is not None else list(messages)
    try:
        return count_tokens_approximately(counted_messages, tools=tools)
    except TypeError:
        return count_tokens_approximately(counted_messages)


def _resolve_max_input_tokens(model: Any) -> int | None:
    profile = getattr(model, "profile", None)
    if not isinstance(profile, dict):
        return None
    value = profile.get("max_input_tokens")
    if isinstance(value, int) and value > 0:
        return value
    return None


def _current_summary_message(messages: Sequence[AnyMessage]) -> HumanMessage | None:
    if not messages:
        return None
    first = messages[0]
    if not isinstance(first, HumanMessage):
        return None
    if first.additional_kwargs.get("lc_source") != "summarization":
        return None
    return first


def _event_summary_message(event: Any) -> BaseMessage | None:
    if not isinstance(event, dict):
        return None
    message = event.get("summary_message")
    if isinstance(message, BaseMessage):
        return message
    return None


def _messages_equivalent(current: BaseMessage | None, previous: BaseMessage | None) -> bool:
    if current is None or previous is None:
        return current is previous
    return (
        current.type == previous.type
        and current.content == previous.content
        and current.additional_kwargs.get("lc_source")
        == previous.additional_kwargs.get("lc_source")
    )


def _previous_summary_count(previous_context: Mapping[str, Any], prior_event: Any) -> int:
    value = previous_context.get("summary_count")
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(prior_event, dict):
        return 1
    return 0


def _previous_last_summary(
    previous_context: Mapping[str, Any],
    prior_event: Any,
) -> ContextWindowSummaryState | None:
    last_summary = previous_context.get("last_summary")
    if isinstance(last_summary, dict):
        return _to_context_window_summary_state(last_summary)
    if not isinstance(prior_event, dict):
        return None

    # Older checkpoints may only have the raw summarization event. Synthesize the
    # richer summary payload so the frontend can render a stable shape across versions.
    summary_message = _event_summary_message(prior_event)
    cutoff = prior_event.get("cutoff_index")
    return _to_context_window_summary_state(
        {
            "cutoff_index": cutoff if isinstance(cutoff, int) and cutoff > 0 else None,
            "state_cutoff_index": cutoff if isinstance(cutoff, int) and cutoff > 0 else None,
            "file_path": prior_event.get("file_path"),
            "summary_preview": _extract_summary_preview(summary_message),
        }
    )


def _compute_state_cutoff(prior_event: Any, effective_cutoff: int) -> int | None:
    if effective_cutoff <= 0:
        return None
    if not isinstance(prior_event, dict):
        return effective_cutoff
    prior_cutoff = prior_event.get("cutoff_index")
    if not isinstance(prior_cutoff, int):
        return effective_cutoff
    return prior_cutoff + effective_cutoff - 1


def _extract_summary_file_path(message: HumanMessage | None) -> str | None:
    if message is None or not isinstance(message.content, str):
        return None
    match = _SUMMARY_FILE_PATH_PATTERN.search(message.content)
    if match is None:
        return None
    path = match.group("path").strip()
    return path or None


def _extract_summary_preview(message: BaseMessage | None) -> str | None:
    if message is None:
        return None
    content = message.content
    if isinstance(content, str):
        match = _SUMMARY_TAG_PATTERN.search(content)
        if match is not None:
            return _truncate_text(match.group(1).strip(), 800)
        return _truncate_text(content.strip(), 800)
    return None


def _truncate_text(value: str, limit: int) -> str | None:
    text = value.strip()
    if not text:
        return None
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _to_context_window_state(payload: Mapping[str, Any]) -> ContextWindowState:
    return cast(ContextWindowState, cast(object, _drop_none(payload)))


def _to_context_window_summary_state(payload: Mapping[str, Any]) -> ContextWindowSummaryState:
    return cast(ContextWindowSummaryState, cast(object, _drop_none(payload)))


def _to_context_window_keep_state(payload: Mapping[str, Any]) -> ContextWindowKeepState:
    return cast(ContextWindowKeepState, cast(object, _drop_none(payload)))


def _to_context_window_threshold_state(payload: Mapping[str, Any]) -> ContextWindowThresholdState:
    return cast(ContextWindowThresholdState, cast(object, _drop_none(payload)))


def _drop_none(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}
