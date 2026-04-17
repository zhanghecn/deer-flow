# Native `/v1/turns` Contract

This reference mirrors the current repository implementation in:

- `backend/gateway/internal/model/turns.go`
- `frontend/app/src/core/public-api/api.ts`

## Base URL and auth

- Use the published gateway base URL.
- Add `Authorization: Bearer <api_key>` on every request.
- The contract accepts a base URL with or without `/v1`; caller code should normalize that once.

## Core request body

```json
{
  "agent": "support-agent",
  "input": {
    "text": "How do I reset my order?",
    "file_ids": ["file_123"]
  },
  "previous_turn_id": "turn_prev",
  "stream": true,
  "thinking": {
    "enabled": true,
    "effort": "medium"
  },
  "text": {
    "format": {
      "type": "json_schema",
      "name": "support_reply",
      "schema": {
        "type": "object"
      },
      "strict": true
    }
  },
  "max_output_tokens": 1200,
  "metadata": {
    "surface": "customer_support_web"
  }
}
```

## Snapshot fields

`POST /v1/turns` in blocking mode and `GET /v1/turns/{id}` return a turn snapshot with:

- `id`
- `status`
- `agent`
- `thread_id`
- `previous_turn_id`
- `output_text`
- `reasoning_text`
- `artifacts`
- `usage`
- `metadata`
- `events`

## Stream event types

The SSE stream emits these exact event names:

- `turn.started`
- `assistant.message.started`
- `assistant.text.delta`
- `assistant.reasoning.delta`
- `tool.call.started`
- `tool.call.completed`
- `turn.requires_input`
- `assistant.message.completed`
- `turn.completed`
- `turn.failed`

Important event fields:

- `sequence`
- `created_at`
- `turn_id`
- `type`
- `message_id`
- `tool_call_id`
- `tool_name`
- `delta`
- `text`
- `reasoning`
- `error`
- `tool_arguments`
- `tool_output`

## Rendering rules

Use one accumulating read model instead of permanently rendering every delta chunk as a separate card.

Recommended behavior:

1. On `turn.started`, mark the run active and capture `turn_id`.
2. On `assistant.text.delta`, append `delta` into the current assistant answer.
3. On `assistant.reasoning.delta`, append `delta` into the current reasoning block.
4. On `tool.call.started`, render a step item with:
   - method name
   - serialized `tool_arguments`
5. On `tool.call.completed`, render a step item with:
   - method name
   - serialized `tool_output`
6. On `assistant.message.completed`, replace live text with `text` and reasoning with `reasoning` when present.
7. On `turn.completed`, mark the run complete.
8. On `turn.requires_input`, mark the run waiting instead of complete.
9. On `turn.failed`, mark the run failed and surface `error`.

## Finalization pattern

For stable UI state, use this pattern:

1. stream `/v1/turns`
2. capture the returned `turn_id`
3. fetch `GET /v1/turns/{turn_id}`
4. finalize `output_text`, `reasoning_text`, artifacts, and the full event ledger from the snapshot

## Failure handling

- HTTP non-2xx on `POST /v1/turns` means the request failed before a successful turn existed.
- `turn.failed` means the turn streamed but ended in failure.
- `turn.requires_input` is a waiting state, not a successful completion.

## Follow-up turns

Continue the same conversation by sending the previous turn id:

```json
{
  "agent": "support-agent",
  "input": {
    "text": "继续根据上一步结果，告诉我下一步。"
  },
  "previous_turn_id": "turn_abc123"
}
```
