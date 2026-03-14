from typing import Annotated, NotRequired, TypedDict

from langchain.agents import AgentState


class SandboxState(TypedDict):
    sandbox_id: NotRequired[str | None]


class ThreadDataState(TypedDict):
    workspace_path: NotRequired[str | None]
    uploads_path: NotRequired[str | None]
    outputs_path: NotRequired[str | None]
    agents_path: NotRequired[str | None]
    authoring_path: NotRequired[str | None]
    authoring_agents_path: NotRequired[str | None]
    authoring_skills_path: NotRequired[str | None]


class ViewedImageData(TypedDict):
    base64: str
    mime_type: str


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
    max_input_tokens: NotRequired[int | None]
    usage_ratio: NotRequired[float | None]
    usage_ratio_after_summary: NotRequired[float | None]
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


def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    """Reducer for artifacts list - merges and deduplicates artifacts."""
    if existing is None:
        return new or []
    if new is None:
        return existing
    # Use dict.fromkeys to deduplicate while preserving order
    return list(dict.fromkeys(existing + new))


def merge_viewed_images(existing: dict[str, ViewedImageData] | None, new: dict[str, ViewedImageData] | None) -> dict[str, ViewedImageData]:
    """Reducer for viewed_images dict - merges image dictionaries.

    Special case: If new is an empty dict {}, it clears the existing images.
    This allows middlewares to clear the viewed_images state after processing.
    """
    if existing is None:
        return new or {}
    if new is None:
        return existing
    # Special case: empty dict means clear all viewed images
    if len(new) == 0:
        return {}
    # Merge dictionaries, new values override existing ones for same keys
    return {**existing, **new}


class ThreadState(AgentState):
    """Shared LangGraph state carried across lead-agent turns."""

    sandbox: NotRequired[SandboxState | None]
    thread_data: NotRequired[ThreadDataState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]
    todos: NotRequired[list | None]
    # Snapshot of prompt pressure and summarization activity for the latest model call.
    context_window: NotRequired[ContextWindowState | None]
    uploaded_files: NotRequired[list[dict] | None]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]  # image_path -> {base64, mime_type}
