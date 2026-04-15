# QueryEngine Event Spine

This note is the implementation-facing architecture boundary for the complete
event-spine replacement.

## Why This Exists

Deer Flow currently mixes multiple live-state inputs:

- LangGraph stream chunks
- persisted thread snapshots
- workspace-only runtime events
- public `/v1/responses` run ledgers
- docs/playground specific adapters
- observability/debug traces

The replacement direction is to make one canonical event path primary and push
everything else into replay, projection, or debug roles.

## Claude Code Reference

The architecture reference is Claude Code's split between:

- `query.ts`: runtime loop
- `QueryEngine.ts`: normalization and session-facing event emission
- `coreSchemas.ts`: stable serializable SDK schema

Deer Flow should copy that separation, not just copy event names.

## Target Layers

1. Runtime Loop
2. Canonical QueryEngine
3. Canonical Event Ledger
4. Read Model Projector
5. Gateway Adapter
6. Frontend Consumers

### Runtime Loop

Consumes raw model/tool/runtime outputs and emits internal canonical events.

### Canonical QueryEngine

Owns event normalization, ordering, replay cursor semantics, and stable
session-facing emission. This is the only place allowed to turn raw runtime
signals into canonical run events.

### Canonical Event Ledger

Stores the canonical event stream with monotonic per-run ordering. This is the
source of truth for public replay and reconnect continuation.

### Read Model Projector

Derives UI-friendly state from canonical events plus persisted snapshots. It is
allowed to create view models, but not to invent a second live-event contract.

### Gateway Adapter

Adapts the canonical ledger into northbound contracts such as
`response.run_event` and `openagents.run_events`.

### Frontend Consumers

Render normalized canonical events or read models. They must not rely on raw
trace/debug payloads as the primary live contract.

## Canonical V1 Event Budget

The v1 canonical run-event budget stays intentionally small:

- `run_started`
- `assistant_delta`
- `assistant_message`
- `tool_started`
- `tool_finished`
- `question_requested`
- `question_answered`
- `run_completed`
- `run_failed`

Anything else must remain:

- snapshot-only
- projection-only
- debug-only

## Current Mapping

Today the closest public contract lives in gateway `PublicAPIRunEvent`. Phase 1
uses that budget as the canonical naming baseline while the internal
QueryEngine path is introduced.

Current code touchpoints:

- gateway contract:
  `backend/gateway/internal/model/public_api.go`
- gateway event shaping:
  `backend/gateway/internal/service/public_api_service.go`
- frontend public adapter:
  `frontend/app/src/core/public-api/events.ts`
- frontend public types:
  `frontend/app/src/core/public-api/api.ts`
- workspace runtime status:
  `frontend/app/src/core/threads/types.ts`

## Boundary Rules

### Allowed to read raw runtime chunks

- runtime loop
- canonical QueryEngine
- debug tooling

### Not allowed to read raw runtime chunks as primary contract

- workspace message rendering
- public docs
- public playground
- public API SDK-facing consumers

### Allowed to synthesize terminal view state

- read model projector
- UI adapters

### Not allowed to invent a new live-event vocabulary

- per-page frontend helpers
- gateway compatibility shims
- trace viewers

## Deletions Required By The End State

- unpublished oversized event payload designs
- duplicated frontend/gateway reshaping paths for the same live signal
- frontend code that treats raw `messages`, `messages-tuple`, or debug traces as
  a first-class live contract
- silent dual old/new event fallback logic

## Phase 1 Output

Phase 1 does not fully migrate runtime execution. It establishes:

- one documented canonical run-event vocabulary
- one typed public/frontend event contract using that vocabulary
- one typed gateway event contract using that vocabulary

That gives later QueryEngine and ledger work a stable seam instead of adding
more stringly typed branches.
