# OpenAgents SDK API Reference

This document describes the current public HTTP SDK / Public API for external integrations.

## 1. Basics

- Base URL: `https://<your-host>/v1`
- Authentication: `Authorization: Bearer <API_TOKEN>`
- Public callable targets: published `prod` agents
- Important constraint: on compatibility surfaces, the `model` field means the **published agent name**, not the underlying provider model ID

Recommended integration order:

1. `GET /v1/models`
2. `POST /v1/turns`
3. `GET /v1/turns/{id}`
4. `POST /v1/files` if you need input file uploads

Compatibility surfaces:

- `POST /v1/responses`
- `GET /v1/responses/{id}`
- `POST /v1/chat/completions`

## 2. Authentication

Example headers:

```http
Authorization: Bearer df_xxx
Content-Type: application/json
```

## 3. Endpoint Summary

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/models` | List published agents visible to the current API token |
| `POST` | `/v1/files` | Upload an input file and get a `file_id` |
| `GET` | `/v1/files/{id}/content` | Download response artifact content |
| `POST` | `/v1/turns` | Recommended native turn-based API |
| `GET` | `/v1/turns/{id}` | Fetch a turn snapshot for recovery and replay |
| `POST` | `/v1/responses` | OpenAI Responses compatibility layer |
| `GET` | `/v1/responses/{id}` | Fetch a historical response |
| `POST` | `/v1/chat/completions` | Chat Completions compatibility layer |

## 4. List Available Agents

### `GET /v1/models`

Returns the published agents visible to the current API token.

Example:

```bash
curl -X GET "http://127.0.0.1:8083/v1/models" \
  -H "Authorization: Bearer df_xxx"
```

Example response:

```json
{
  "object": "list",
  "data": [
    {
      "id": "support-cases-http-demo",
      "object": "model",
      "created": 1710000000,
      "owned_by": "openagents"
    }
  ]
}
```

## 5. Native API: Create a Turn

### `POST /v1/turns`

This is the **recommended primary API**.

Key properties:

- send only the current turn input
- chain turns with `previous_turn_id`
- supports SSE streaming
- supports reasoning output, tool calls, structured output, uploaded files, and
  existing knowledge-base attachments
- published agents may also define default knowledge-base attachments; SDK
  callers normally omit `knowledge_base_ids` unless they need per-turn extras

### 5.1 Request Body

```json
{
  "agent": "support-cases-http-demo",
  "input": {
    "text": "Summarize this file",
    "file_ids": ["file_123"]
  },
  "previous_turn_id": "turn_abc",
  "knowledge_base_ids": ["11111111-1111-1111-1111-111111111111"],
  "metadata": {
    "ticket_id": "T-1001"
  },
  "stream": true,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "summary_result",
      "schema": {
        "type": "object",
        "properties": {
          "summary": { "type": "string" }
        },
        "required": ["summary"]
      },
      "strict": true
    }
  },
  "thinking": {
    "enabled": true,
    "effort": "high"
  },
  "max_output_tokens": 2048
}
```

### 5.2 Field Reference

| Field | Type | Required | Description |
|---|---|---:|---|
| `agent` | `string` | Yes | Published `prod` agent name |
| `input.text` | `string` | Yes | Current user text input |
| `input.file_ids` | `string[]` | No | `file_id` values returned by `/v1/files` |
| `previous_turn_id` | `string` | No | Previous turn ID for session continuity |
| `knowledge_base_ids` | `string[]` | No | Extra existing knowledge-base IDs to attach to the thread before this turn runs. Agent-level default knowledge bases are attached automatically. Any effective knowledge attachment requires the `knowledge:read` token scope, and each base must belong to the current user or be shared |
| `metadata` | `object` | No | Caller-defined metadata |
| `stream` | `boolean` | No | Enable SSE streaming |
| `text.format` | `object` | No | Structured output definition |
| `thinking.enabled` | `boolean` | No | Enable reasoning output |
| `thinking.effort` | `string` | No | Reasoning effort, commonly `low` / `medium` / `high` |
| `max_output_tokens` | `integer` | No | Maximum output token budget |

## 6. Turn SSE Events

When `stream=true`, `POST /v1/turns` returns `text/event-stream`.

Stable event budget:

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

### 6.1 SSE Example

```text
event: assistant.text.delta
data: {"sequence":3,"type":"assistant.text.delta","turn_id":"turn_123","delta":"Hello"}

event: tool.call.started
data: {"sequence":4,"type":"tool.call.started","turn_id":"turn_123","tool_call_id":"call_1","tool_name":"fs_grep","tool_arguments":{"pattern":"disaster"}}

event: tool.call.completed
data: {"sequence":5,"type":"tool.call.completed","turn_id":"turn_123","tool_call_id":"call_1","tool_name":"fs_grep","tool_output":{"items":[]}}

event: turn.completed
data: {"sequence":9,"type":"turn.completed","turn_id":"turn_123"}
```

### 6.2 Client Handling Guidance

- Preserve incoming whitespace; do not trim deltas before merging
- Merge `assistant.text.delta` and `assistant.reasoning.delta` incrementally
- Treat `assistant.message.completed` or `GET /v1/turns/{id}` as the final source of truth
- For tool call UIs, display:
  - tool name
  - tool arguments
  - tool output

## 7. Fetch a Turn Snapshot

### `GET /v1/turns/{id}`

Use cases:

- restore UI after refresh
- recover after SSE interruption
- replay a historical turn

Example response:

```json
{
  "id": "turn_123",
  "object": "turn",
  "status": "completed",
  "agent": "support-cases-http-demo",
  "thread_id": "thread_456",
  "trace_id": "trace_789",
  "previous_turn_id": "turn_prev",
  "output_text": "This is the final answer",
  "reasoning_text": "This is the reasoning text",
  "artifacts": [],
  "usage": {
    "input_tokens": 120,
    "output_tokens": 80,
    "total_tokens": 200
  },
  "metadata": {
    "ticket_id": "T-1001"
  },
  "events": [],
  "created_at": 1710000000,
  "completed_at": 1710000005
}
```

### 7.1 Snapshot Fields

| Field | Description |
|---|---|
| `id` | Current turn ID |
| `status` | Common values: `completed`, `failed`, `incomplete` |
| `agent` | Agent name |
| `thread_id` | Backend execution thread ID |
| `trace_id` | Observability trace ID |
| `previous_turn_id` | Previous turn ID |
| `output_text` | Final assistant answer |
| `reasoning_text` | Final reasoning text |
| `artifacts` | Output files |
| `usage` | Token usage |
| `events` | Normalized event list for this turn |

## 8. File Uploads

### `POST /v1/files`

Use this to attach uploaded files to a turn.

`multipart/form-data` fields:

- `file`: file body
- `purpose`: recommended value `assistants`

Example:

```bash
curl -X POST "http://127.0.0.1:8083/v1/files" \
  -H "Authorization: Bearer df_xxx" \
  -F "file=@./example.pdf" \
  -F "purpose=assistants"
```

Example response:

```json
{
  "id": "file_123",
  "object": "file",
  "bytes": 10240,
  "created_at": 1710000000,
  "filename": "example.pdf",
  "purpose": "assistants",
  "mime_type": "application/pdf",
  "status": "processed"
}
```

Then include that ID in the turn request:

```json
{
  "input": {
    "text": "Please read the attachment",
    "file_ids": ["file_123"]
  }
}
```

## 9. Responses Compatibility Layer

### `POST /v1/responses`

Use this if you already integrate in an OpenAI Responses-like style.

Key points:

- `model` = published agent name
- `input` = raw input payload
- supports `stream=true`
- supports `reasoning`
- supports `text.format`

Example:

```bash
curl -X POST "http://127.0.0.1:8083/v1/responses" \
  -H "Authorization: Bearer df_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "support-cases-http-demo",
    "input": "Reply with TEST_OK",
    "stream": false
  }'
```

## 10. Chat Completions Compatibility Layer

### `POST /v1/chat/completions`

Use this only if you already have a Chat Completions client.

Key points:

- `model` = published agent name
- the gateway translates it into the canonical responses/runtime flow
- not recommended as the default surface for new integrations

## 11. Common Errors

### 401 Unauthorized

```json
{
  "error": "missing api token"
}
```

or:

```json
{
  "error": "invalid api token"
}
```

### 403 Forbidden

The token is missing the required scopes. For example, `knowledge_base_ids`
requires `knowledge:read`.

### 404 Not Found

- missing agent
- missing turn / response / file
- a `knowledge_base_ids` entry does not exist or is not accessible

### 422 / `runtime_error`

Execution failed inside the runtime. On streaming calls this usually appears as:

```text
event: turn.failed
data: {"type":"turn.failed","error":"..."}
```

## 12. Minimal Integration Examples

### 12.1 Blocking Call

```python
import requests

base_url = "http://127.0.0.1:8083/v1"
api_key = "df_xxx"

resp = requests.post(
    f"{base_url}/turns",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    json={
        "agent": "support-cases-http-demo",
        "input": {"text": "Hello"},
    },
    timeout=60,
)
resp.raise_for_status()
print(resp.json())
```

### 12.2 Streaming Call

```python
import requests

resp = requests.post(
    "http://127.0.0.1:8083/v1/turns",
    headers={
        "Authorization": "Bearer df_xxx",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    },
    json={
        "agent": "support-cases-http-demo",
        "input": {"text": "Please answer in streaming mode"},
        "stream": True,
    },
    stream=True,
    timeout=60,
)

for line in resp.iter_lines(decode_unicode=True):
    if line:
        print(line)
```

## 13. Integration Recommendations

- Prefer `/v1/turns` for new integrations
- Store only `previous_turn_id` on the client side; do not resend full `messages[]` every turn
- Use `GET /v1/turns/{id}` for recovery and reopen flows
- Build tool-call UI from the normalized turn events, not from raw traces
- Upload files through `/v1/files` before calling a turn

## 14. Document Status

- Status: aligned with the current repository implementation
- Scope: OpenAgents external Public API / SDK usage
- Non-goals: raw LangGraph chunks, internal traces, frontend-private event formats
