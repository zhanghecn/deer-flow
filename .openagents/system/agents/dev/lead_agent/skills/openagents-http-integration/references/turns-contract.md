# Native `/v1/turns` Contract

This reference mirrors the current repository implementation in:

- `backend/gateway/internal/model/turns.go`
- `frontend/app/src/core/public-api/api.ts`

This document is the source of truth for external integration. If helper
libraries exist, they must preserve this contract instead of redefining it.

## Canonical stance

- Preferred integration path: raw HTTP against `/v1/turns`
- Claude Code alignment is internal architecture inspiration, not a public wire
  dependency
- TypeScript or Python helpers are optional thin clients only
- Customers should not need a product-specific SDK to achieve full fidelity
- If a helper is used, its public shape should be session-based
  (`session.prompt(...)`) instead of requiring the caller to keep sending
  `messages[]`

## Base URL and auth

- Use the published gateway base URL.
- Add `Authorization: Bearer <api_key>` on every request.
- The contract accepts a base URL with or without `/v1`; caller code should
  normalize that once.

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

`POST /v1/turns` in blocking mode and `GET /v1/turns/{id}` return a turn
snapshot with:

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

Use one accumulating read model instead of permanently rendering every delta
chunk as a separate card.

Recommended behavior:

1. On `turn.started`, mark the run active and capture `turn_id`.
2. On `assistant.text.delta`, merge `delta` into the current assistant answer.
3. On `assistant.reasoning.delta`, merge `delta` into the current reasoning
   block.
4. On `tool.call.started`, render a step item with:
   - method name
   - serialized `tool_arguments`
5. On `tool.call.completed`, render a step item with:
   - method name
   - serialized `tool_output`
6. On `assistant.message.completed`, replace live text with `text` and
   reasoning with `reasoning` when present.
7. On `turn.completed`, mark the run complete.
8. On `turn.requires_input`, mark the run waiting instead of complete.
9. On `turn.failed`, mark the run failed and surface `error`.

## Streaming merge rules

Clients must not treat every incoming chunk as a final independent text block.

Required rules:

1. Preserve whitespace exactly as received. Do not `trim()` text deltas or
   reasoning deltas before merging.
2. Detect cumulative replay:
   - if the incoming delta already contains the full current text, replace the
     current text with the incoming value
   - if the current text already contains the incoming delta, keep the current
     text
3. Otherwise append the incoming delta, using only minimal separator inference
   for split ASCII words.
4. Apply the same strategy to reasoning text.
5. When `assistant.message.completed` provides `text` or `reasoning`, replace
   the live buffers with those finalized values.

This is required because upstream model streams may mix token deltas and
cumulative full-text replays in the same turn.

## Streaming rendering rules

- While streaming, render assistant content and reasoning as plain text or a
  stream-safe text view.
- Do not parse incomplete Markdown as finalized rich content during the live
  stream.
- After `assistant.message.completed` or `GET /v1/turns/{id}`, render finalized
  Markdown or structured output.
- Tool calls should show:
  - method name
  - serialized input arguments
  - serialized output payload
- Errors must be visible in the UI and must not be hidden behind a generic
  loading state.

## Finalization pattern

For stable UI state, use this pattern:

1. stream `/v1/turns`
2. capture the returned `turn_id`
3. fetch `GET /v1/turns/{turn_id}`
4. finalize `output_text`, `reasoning_text`, artifacts, and the full event
   ledger from the snapshot

## Failure handling

- HTTP non-2xx on `POST /v1/turns` means the request failed before a successful
  turn existed.
- `turn.failed` means the turn streamed but ended in failure.
- `turn.requires_input` is a waiting state, not a successful completion.

## HTTP status handling

Treat request-level failures and turn-level failures differently.

- `2xx` with SSE stream:
  - the request succeeded
  - final state still depends on `turn.completed`, `turn.requires_input`, or
    `turn.failed`
- `400`, `401`, `403`, `404`, `409`, `422`:
  - caller or configuration error
  - surface the response body directly in the UI
  - do not silently retry
- `408`, `429`, `500`, `502`, `503`, `504`:
  - transport or platform error
  - show explicit retry affordance
  - automatic retry is allowed only when the request is idempotent from the
    caller's perspective

UI rule:

- always surface request failure text
- always surface `turn.failed` text
- never leave the user with a spinner and no explanation

## Real acceptance testing

“Real test” for `/v1/turns` integration means all of the following:

1. Trigger the run from the OpenAgents user-facing product surface on
   `http://127.0.0.1:8083`, or from a standalone external page that calls the
   same published `/v1/turns` contract.
2. Verify the matching run is visible in admin observability on
   `http://127.0.0.1:8081/observability`.
3. Verify the result is previewable or interactable in product UI, not just in
   host-side scripts.
4. Use a real published agent key and the actual customer-facing integration
   path, not a mocked local transcript.

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

If you ship a helper, hide this field behind session state:

```ts
const session = createOpenAgentsSession({
  baseURL,
  apiKey,
  agent: "support-agent",
});

await session.prompt({
  text: "案例库里有哪些文件？",
  thinking: { enabled: true, effort: "medium" },
});

await session.prompt({
  text: "继续读取第一页。",
});
```

That helper shape matches Claude Code's public usage model more closely:

- caller sends prompts into a session
- helper owns continuation state
- wire contract remains native `/v1/turns`
