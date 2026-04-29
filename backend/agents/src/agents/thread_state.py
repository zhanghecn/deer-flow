from typing import Annotated, NotRequired, TypedDict

from langchain.agents import AgentState


class SandboxState(TypedDict):
    sandbox_id: NotRequired[str | None]


class ContextWindowThresholdState(TypedDict):
    """Evaluation result for one summarization trigger rule."""

    type: NotRequired[str | None]
    value: NotRequired[int | float | None]
    current: NotRequired[int | float | None]
    matched: NotRequired[bool | None]
    label: NotRequired[str | None]


class ContextWindowKeepState(TypedDict):
    """Retention policy used when summarization compacts the prompt."""

    type: NotRequired[str | None]
    value: NotRequired[int | float | None]


class ContextWindowSummaryState(TypedDict):
    """Details about the most recent summarization event visible to the UI."""

    created_at: NotRequired[str | None]
    cutoff_index: NotRequired[int | None]
    state_cutoff_index: NotRequired[int | None]
    summarized_message_count: NotRequired[int | None]
    preserved_message_count: NotRequired[int | None]
    file_path: NotRequired[str | None]
    summary_preview: NotRequired[str | None]


class ContextWindowState(TypedDict):
    """Context-window telemetry emitted for each model call.

    `approx_input_tokens` and `effective_message_count` always describe the prompt
    that was actually considered for this turn. The `*_after_summary` fields are
    only populated when a new summarization step compacted the prompt.
    """

    updated_at: NotRequired[str | None]
    approx_input_tokens: NotRequired[int | None]
    approx_input_tokens_after_summary: NotRequired[int | None]
    approx_input_tokens_after_microcompact: NotRequired[int | None]
    max_input_tokens: NotRequired[int | None]
    usage_ratio: NotRequired[float | None]
    usage_ratio_after_summary: NotRequired[float | None]
    usage_ratio_after_microcompact: NotRequired[float | None]
    raw_message_count: NotRequired[int | None]
    effective_message_count: NotRequired[int | None]
    effective_message_count_after_summary: NotRequired[int | None]
    trigger_thresholds: NotRequired[list[ContextWindowThresholdState] | None]
    trigger_reasons: NotRequired[list[str] | None]
    keep: NotRequired[ContextWindowKeepState | None]
    triggered: NotRequired[bool | None]
    summary_applied: NotRequired[bool | None]
    summary_count: NotRequired[int | None]
    last_summary: NotRequired[ContextWindowSummaryState | None]
    # Microcompact clears stale tool result bodies while preserving tool-call
    # pairing. These counters help the admin trace distinguish it from formal
    # summarization, which creates durable conversation memory.
    microcompact_applied: NotRequired[bool | None]
    microcompacted_tool_result_count: NotRequired[int | None]
    microcompact_original_chars: NotRequired[int | None]
    microcompact_compacted_chars: NotRequired[int | None]


def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    """Reducer for artifacts list - merges and deduplicates artifacts."""
    if existing is None:
        return new or []
    if new is None:
        return existing
    # Use dict.fromkeys to deduplicate while preserving order
    return list(dict.fromkeys(existing + new))


class ThreadState(AgentState):
    """Shared LangGraph state carried across lead-agent turns."""

    sandbox: NotRequired[SandboxState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]
    todos: NotRequired[list | None]
    # Snapshot of prompt pressure and summarization activity for the latest model call.
    context_window: NotRequired[ContextWindowState | None]
    uploaded_files: NotRequired[list[dict] | None]
