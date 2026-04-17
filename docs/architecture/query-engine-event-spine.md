# QueryEngine Event Spine

This note is the implementation-facing boundary for the OpenAgents event-spine
replacement.

## Why This Exists

OpenAgents currently has too many partial sources of truth for one turn:

- LangGraph stream chunks
- persisted turn snapshots
- workspace-only runtime events
- docs and playground adapters
- observability traces

The replacement direction is to make one canonical event path primary and push
everything else into replay, projection, or debug roles.

## Reference Sources

The architectural reference is Claude Code's separation of responsibilities:

- `/root/project/ai/claude-code/src/query.ts`
- `/root/project/ai/claude-code/src/QueryEngine.ts`
- `/root/project/ai/claude-code/src/entrypoints/sdk/coreSchemas.ts`
- `/root/project/ai/claude-code/src/cli/print.ts`
  - especially `drainCommandQueue` for queue draining, ordering, and failure
    handling around streamed output

OpenAgents should copy the separation, not the brand-specific schema.

## Canonical Northbound Contract

The first-party contract exposed to customers is:

1. `POST /v1/turns`
2. SSE turn events
3. `GET /v1/turns/{id}` snapshot recovery

This means:

- `/v1/turns` is the source of truth for external integrations
- language SDKs, if any, are thin clients over `/v1/turns`
- no hand-written client library may invent its own event names or omit stable
  server fields

## Target Layers

1. Runtime Loop
2. Canonical QueryEngine
3. Canonical Event Ledger
4. Read Model Projector
5. Gateway Turns Adapter
6. Frontend or External Consumers

### Runtime Loop

Consumes raw model, tool, and runtime outputs. It may be noisy and provider
specific.

### Canonical QueryEngine

Owns normalization, ordering, replay cursor semantics, and session-facing event
emission. This is the only layer allowed to turn raw runtime signals into the
canonical event stream.

### Canonical Event Ledger

Stores the canonical event stream with monotonic per-turn ordering. This is the
source of truth for replay and reconnect continuation.

### Read Model Projector

Derives UI-friendly state from canonical events plus finalized snapshots. It
may create view models, but it must not invent a second event contract.

### Gateway Turns Adapter

Adapts the canonical ledger into the native `/v1/turns` vocabulary and snapshot
shape.

### Frontend or External Consumers

Render normalized canonical events or read models. They must not depend on raw
LangGraph chunks or trace payloads as the primary live contract.

## Canonical V1 Event Budget

The v1 event budget exposed through `/v1/turns` stays intentionally small:

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

Anything else must remain:

- snapshot-only
- projection-only
- debug-only

## Implementation Invariants

1. Raw runtime chunks are normalized exactly once.
   - normalization belongs in the QueryEngine path
   - downstream adapters must not reinterpret the same raw source differently
2. The gateway preserves semantic meaning.
   - it may rename internal fields into `/v1/turns` wire fields
   - it may not create per-surface special event vocabularies
3. Read models merge stream text deterministically.
   - preserve whitespace
   - detect cumulative replay versus token delta
   - replace from `assistant.message.completed`
   - finalize from `GET /v1/turns/{id}`
4. Rich rendering happens after finalization.
   - incomplete Markdown is not a stable transport format
5. Error semantics remain explicit.
   - transport and HTTP errors stay request-level failures
   - `turn.failed` stays a turn-level terminal event

## Current Mapping

Current code touchpoints for the native turns path:

- gateway turn contract:
  `backend/gateway/internal/model/turns.go`
- gateway turn normalization:
  `backend/gateway/internal/service/turns_service.go`
- frontend public types:
  `frontend/app/src/core/public-api/api.ts`
- frontend event normalization:
  `frontend/app/src/core/public-api/events.ts`
- frontend read model:
  `frontend/app/src/core/public-api/run-session.ts`
- standalone external demo:
  `frontend/demo/src/app.tsx`

## Boundary Rules

### Allowed to read raw runtime chunks

- runtime loop
- canonical QueryEngine
- debug tooling

### Not allowed to read raw runtime chunks as the primary contract

- workspace message rendering
- docs pages
- demos
- downloadable client helpers

### Allowed to synthesize terminal view state

- read model projector
- UI adapters

### Not allowed to invent a new live-event vocabulary

- per-page frontend helpers
- gateway compatibility shims
- hand-written SDK wrappers
- trace viewers

## Deletions Required By The End State

- unpublished oversized event payload designs
- duplicate frontend and gateway reshaping for the same live signal
- frontend code that treats raw `messages`, `messages-tuple`, or debug traces as
  a first-class live contract
- silent dual old/new fallback logic
- repo-owned multi-language SDK contracts that drift from `/v1/turns`

## Phase Output

The desired end state is:

- one documented canonical turns vocabulary
- one typed gateway event contract using that vocabulary
- one read-model strategy shared across internal UI and external demos
- thin language wrappers or code examples derived from the same contract

That gives later QueryEngine and ledger work a stable seam instead of adding
more stringly typed branches.
