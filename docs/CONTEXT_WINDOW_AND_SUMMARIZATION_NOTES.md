# Context Window And Summarization Notes

Last validated: March 14, 2026

## Source Of Truth

- The only frontend/runtime source of truth for current prompt occupancy is persisted `context_window`.
- `context_window` is produced by `ContextWindowMiddleware` and written into LangGraph state on every model call.
- Admin observability records the same payload as a `system` event named `ContextWindow`.
- Gateway history transform preserves persisted `context_window`; it no longer derives prompt occupancy from `_summarization_event` or token usage fallbacks.

## What `MaxTokensRecoveryMiddleware` Is For

- `SummarizationMiddleware` is responsible for normal proactive compaction.
- `MaxTokensRecoveryMiddleware` is a separate recovery path for provider-side max-token / context-overflow failures.
- It should not be treated as the normal summarization trigger.
- Seeing `MaxTokensRecoveryMiddleware` in the middleware chain does not mean compaction should happen early.

## Why `_summarization_event` Still Exists In Python

- `_summarization_event` is still useful inside Python middleware to understand that a thread was already summarized before the current model call.
- It is used to compute:
  - pre-summary message/token counts
  - `summary_count`
  - `last_summary`
- It is not used as a frontend-facing context-window fallback anymore.

## Why `langgraph_state.go` Must Stay

- `backend/gateway/internal/proxy/langgraph_state.go` is still the gateway-side history sanitation layer.
- Its job is to:
  - keep only frontend-relevant state keys
  - trim noisy message payloads
  - drop bulky tool outputs and internal fields
- It should not be deleted just because context-window derivation fallback was removed.
- Dead history-compaction helpers were removed, but the history transform itself is still required.

## How To Read Observability Correctly

- `trace.total_tokens` is the sum of all LLM calls in the trace.
- `context_window.approx_input_tokens / max_input_tokens` is the current main-agent prompt occupancy snapshot.
- These two numbers answer different questions:
  - trace total: how expensive the whole run was
  - context window: how full the active prompt is right now

## Trigger Policy

- Current policy follows the Opencode-style fraction trigger:
  - `trigger.type = fraction`
  - `trigger.value = 0.95`
- Keep policy remains message-based:
  - `keep.type = messages`
  - `keep.value = 12`
- There is no longer a config-level token fallback trigger in local config.

## Concrete Validation Snapshot

Validated on thread `afaa1340-0f01-40b5-aaeb-b1d8f91867af`:

- `Surprise me` completed with `32,970 / 256,000` prompt tokens, about `12.9%`, `summary_applied=false`.
- Follow-up PPTX generation completed with `70,725 / 256,000` prompt tokens, about `27.6%`, `summary_applied=false`.
- The same PPT trace accumulated about `697.9K` total trace tokens, which confirms again that trace totals and active context occupancy are different metrics.

## UI Guidance

- User-facing context display should stay lightweight.
- A single inline text status near the input area is easier to scan than a floating card above the composer.
- Prefer compact text such as:
  - `Context 28% · 70.7K / 256.0K`
