# SDKMessage-First Event Contract

This note defines the frontend-facing direction for Deer Flow's event refactor.

## Decision

Deer Flow should adopt a Claude Code style event spine, but the first stable
contract should be a gateway-owned `SDKMessage` wire shape instead of a new
runtime-wide event bus.

## Why

- The current live UX depends on fragmented sources:
  - LangGraph `values.messages`
  - custom stream events
  - workspace surface events
  - public `/v1/responses` trace ledger
- The previous oversized event design is unpublished and can be deleted.
- Frontend and docs need one live contract before runtime internals gain a new
  canonical event bus.

## Boundaries

Three planes remain distinct:

1. Snapshot / recovery plane
   - Source: persisted thread state
   - Purpose: reopen threads, recover from stream loss, hydrate history

2. Live contract plane
   - Source: gateway-normalized `SDKMessage`
   - Purpose: streaming UI, SDK consumers, replay-after-reconnect

3. Observability plane
   - Source: raw traces and operator debug ledgers
   - Purpose: debugging, audits, deep inspection

The frontend must not treat raw LangGraph chunks or debug trace payloads as the
primary live contract once the normalized stream exists.

## V1 Event Budget

The first public live contract must stay small:

- `run_started`
- `assistant_delta`
- `assistant_message`
- `tool_started`
- `tool_finished`
- `run_completed`
- `run_failed`

Everything else stays deferred, snapshot-driven, or debug-only until the gap is
proven by a real consumer.

## Replay Rules

- The persisted gateway run-event ledger is the source of truth for live-event
  replay.
- Ordering uses a per-run monotonically increasing `event_index`.
- Reconnect uses snapshot-plus-tail replay:
  - latest snapshot for recovery
  - normalized events after the last seen `event_index` for live continuity
- Replay should not re-emit stale deltas before the replay cursor.

## Explicit Non-Goals

- Do not freeze raw `messages-tuple`, `values`, or `custom` payloads into the
  public contract.
- Do not move workspace-specific side effects into the v1 `SDKMessage` union.
- Do not make raw trace payloads the primary frontend integration surface.

## Hard Deletes

When migration is complete, remove:

- unpublished oversized event payloads
- duplicated event reshaping in both gateway and frontend
- frontend concepts that depend directly on fragmented raw live sources as the
  primary contract
