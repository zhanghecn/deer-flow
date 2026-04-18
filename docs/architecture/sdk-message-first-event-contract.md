# Message-First `/v1/turns` Event Contract

This note defines the frontend-facing contract for the OpenAgents event
refactor.

The filename is historical. The canonical northbound contract is no longer a
product-specific `SDKMessage` schema. The canonical first-party integration
surface is native HTTP `POST /v1/turns` plus SSE events plus
`GET /v1/turns/{id}` snapshots.

## Decision

OpenAgents aligns to Claude Code at the architectural split, not at the public
wire type:

- Claude Code reference for internal split:
  - `/root/project/ai/claude-code/src/query.ts`
  - `/root/project/ai/claude-code/src/QueryEngine.ts`
  - `/root/project/ai/claude-code/src/entrypoints/sdk/coreSchemas.ts`
- OpenAgents public contract:
  - native `/v1/turns`
  - stable SSE event names
  - turn snapshot finalization via `GET /v1/turns/{id}`

If OpenAgents ships helper libraries, they must be thin wrappers over
`/v1/turns`. They must not invent a second public event vocabulary or make
callers resend the full transcript on every turn.

## Why

- The live UX was previously split across:
  - LangGraph `values.messages`
  - custom stream events
  - workspace-only runtime events
  - public replay ledgers
  - page-specific adapters
- That fragmentation caused duplicated reshaping, whitespace bugs, broken
  streaming Markdown, and inconsistent tool and reasoning rendering.
- Real customer integration should target one stable HTTP contract instead of a
  repo-local SDK abstraction.

## Contract Planes

Keep these planes distinct:

1. Snapshot / recovery plane
   - Source: `GET /v1/turns/{id}`
   - Purpose: reopen turns, recover after stream loss, hydrate history

2. Live contract plane
   - Source: `POST /v1/turns` SSE events
   - Purpose: streaming UI, external clients, reconnect continuation

3. Observability plane
   - Source: traces, audits, operator ledgers
   - Purpose: debugging and investigation

Frontend and public consumers must not treat raw LangGraph chunks or
observability payloads as the primary live contract.

## V1 Live Event Budget

The public live contract stays intentionally small and message-first:

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

Anything outside this budget must remain:

- snapshot-only
- projection-only
- debug-only

## Client Read-Model Rules

All streaming consumers must follow the same merge rules:

1. Preserve incoming whitespace. Do not call `trim()` on text or reasoning
   deltas before merging.
2. Merge deltas intelligently instead of raw append:
   - if the new delta is a cumulative replay that already contains the current
     text, replace the current text
   - if the current text already contains the new delta, keep the current text
   - otherwise append with minimal separator inference for split ASCII words
3. Apply the same rule set to assistant answer text and reasoning text.
4. On `assistant.message.completed`, replace live text with the server-provided
   final `text` and `reasoning` when present.
5. After the stream ends, finalize from `GET /v1/turns/{id}`.

These rules exist because model providers and middleware may emit a mix of
token-like deltas and cumulative replays in the same turn.

## Session Helper Shape

Claude Code alignment matters at the public SDK shape, not at the wire format.

- Claude Code public callers send `prompt` into a long-lived session.
- Claude Code does not ask external callers to keep sending `messages[]`.
- OpenAgents should do the same on top of native `/v1/turns`:
  - caller creates a session helper
  - caller invokes `session.prompt({ text, ... })`
  - helper stores `previous_turn_id` internally
  - helper streams SSE from `/v1/turns`
  - helper finalizes from `GET /v1/turns/{id}`

That means:

- canonical wire contract: `/v1/turns`
- canonical helper shape: `session.prompt(...)`
- explicit non-goal: public `messages[]` replay as the primary integration path

## Rendering Rules

Streaming clients must separate incomplete transport text from finalized rich
rendering:

- While streaming, render assistant text and reasoning with plain-text-safe
  accumulation.
- Do not parse incomplete Markdown as final rich content while the stream is
  still open.
- After `assistant.message.completed` or snapshot recovery, render finalized
  Markdown or structured output.
- Tool calls should render as step items that show method name and serialized
  arguments or output.

## Replay Rules

- The persisted turn-event ledger is the source of truth for replay.
- Ordering uses per-turn monotonically increasing `sequence`.
- Reconnect uses snapshot plus tail replay:
  - snapshot for current finalized state
  - normalized events after the last seen sequence for live continuity
- Reconnect must not re-fragment already accumulated text into separate cards.

## Explicit Non-Goals

- Do not publish raw `messages-tuple`, `values`, or `custom` payloads as the
  external contract.
- Do not expose workspace-only side effects as part of the native turns
  protocol.
- Do not make a hand-maintained product SDK the source of truth for event
  semantics.
- Do not parse free-form observability output to rebuild the live transcript.

## Hard Deletes

When migration is complete, remove:

- unpublished oversized event payload designs
- duplicate event reshaping in both gateway and frontend for the same live
  signal
- frontend code that treats fragmented raw live sources as the primary contract
- any wrapper that silently diverges from `/v1/turns`
