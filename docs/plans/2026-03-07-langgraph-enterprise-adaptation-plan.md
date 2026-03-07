# LangGraph Enterprise Multi-Tenant Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep LangGraph built-in execution APIs, but fully align runtime model resolution, user isolation, history/checkpoint restore, and observability for enterprise multi-user + multi-agent usage without model fallback logic.

**Architecture:** Gateway only authenticates, injects user runtime context, and proxies requests. Python/LangGraph side owns all runtime decisions (model/agent/thread ownership) using database lookups keyed by `(user_id, thread_id, agent_name)`. Frontend sends explicit runtime parameters on run requests; history/rejoin/cancel rely on persisted thread runtime context and ownership checks.

**Tech Stack:** Go (Gin gateway), Python (LangGraph API runtime), Postgres (models/agents/thread runtime/ownership), frontend (LangGraph SDK React hooks), pytest + go test + curl e2e.

---

## Context7 Key Findings (for design constraints)

1. LangGraph persistence requires `configurable.thread_id`; checkpoints are keyed by thread.
2. `checkpoint_id` can replay/restore execution within one thread.
3. Standard workflow is `threads.create` -> `runs.stream` (or `runs.create`) -> `history/state`.
4. `runs/stream` supports rich body fields (`assistant_id`, `input`, `config`, `context`, `stream_mode`, etc.), so no need to replace LangGraph execution API.

## API Profile To Keep (No Custom Execution Rewrite)

1. `POST /threads`
2. `POST /threads/search`
3. `POST /threads/{thread_id}/runs/stream` (primary)
4. `GET /threads/{thread_id}/runs/{run_id}/stream` (rejoin stream)
5. `POST /threads/{thread_id}/history`
6. `POST /threads/{thread_id}/runs/{run_id}/cancel`

Everything else is blocked or not used by frontend.

## Target End-to-End Flow (ASCII)

```text
Browser
  |
  | POST /api/langgraph/threads/{tid}/runs/stream
  | body: input + config.configurable + context
  v
Gateway (Go)
  |-- JWT verify
  |-- inject user_id/thread_id into configurable
  |-- proxy only (no model DB composition)
  v
LangGraph API (Python)
  |-- request context extraction
  |-- ownership check: (user_id, thread_id)
  |-- runtime model resolve:
  |     configurable.model_name/model
  |  -> configurable.model_config.name
  |  -> agent.model (DB)
  |  -> thread_runtime_configs(thread_id,user_id)
  |-- persist thread runtime config (thread_id,user_id,model_name,agent_name)
  v
DeepAgent Graph Execution
  |
  | checkpoints + state persisted by checkpointer (thread_id keyed)
  v
History / restore / rejoin
  |-- history uses persisted thread runtime + ownership
  |-- checkpoint_id restore stays within same thread
```

## Ownership/Data Model (No fallback, No dead code)

```text
users
  1 --- N thread_ownerships (thread_id, user_id, assistant_id, created_at)
  1 --- N thread_runtime_configs (thread_id, user_id, agent_name, model_name, updated_at)

agents (agent_name -> default model/tool groups)
models (model_name -> config_json, enabled)
```

`thread_ownerships` is authoritative for access control.

---

### Task 1: Freeze Runtime Contract (frontend -> gateway -> python)

**Files:**
- Modify: `docs/LANGGRAPH_RUNTIME_ARCHITECTURE.md`
- Modify: `frontend/src/core/threads/hooks.ts`
- Test: `frontend` runtime request payload tests/snapshots (add if missing)

**Step 1: Write failing test/document check**

Add test/assertion that run payload always includes:
- `config.configurable.model_name` (or `model`)
- `config.configurable.thread_id`
- `context` mirrors runtime fields for compatibility

**Step 2: Run tests to verify failure**

Run: `cd frontend && pnpm test` (or project test command)
Expected: failing assertion for missing required runtime fields.

**Step 3: Implement minimal payload normalization**

Ensure one canonical payload builder is used by all send paths.

**Step 4: Run tests to verify pass**

Run: `cd frontend && pnpm test`
Expected: payload contract tests pass.

**Step 5: Commit**

```bash
git add frontend/src/core/threads/hooks.ts docs/LANGGRAPH_RUNTIME_ARCHITECTURE.md
git commit -m "feat(frontend): enforce canonical langgraph runtime payload contract"
```

### Task 2: Add Thread Ownership Registry (Python side)

**Files:**
- Create: `gateway-go/migrations/006_thread_ownerships.up.sql`
- Modify: `backend/src/config/runtime_db.py`
- Create: `backend/tests/test_thread_ownership_store.py`

**Step 1: Write failing tests**

Add tests for:
- save ownership `(thread_id,user_id)` idempotently
- reject read/write if thread belongs to another user

**Step 2: Run tests to verify failure**

Run: `cd backend && pytest -q backend/tests/test_thread_ownership_store.py`
Expected: FAIL (methods/table not implemented yet).

**Step 3: Implement minimal DB store methods**

Add:
- `save_thread_ownership(thread_id, user_id, assistant_id)`
- `assert_thread_owner(thread_id, user_id)`

**Step 4: Run tests to verify pass**

Run: `cd backend && pytest -q backend/tests/test_thread_ownership_store.py`
Expected: PASS.

**Step 5: Commit**

```bash
git add gateway-go/migrations/006_thread_ownerships.up.sql backend/src/config/runtime_db.py backend/tests/test_thread_ownership_store.py
git commit -m "feat(backend): add thread ownership registry for multi-tenant isolation"
```

### Task 3: Enforce Ownership on LangGraph Thread Endpoints

**Files:**
- Create: `backend/src/http/middleware/thread_access_guard.py`
- Modify: `backend/src/server.py` (or app bootstrap where middleware is registered)
- Test: `backend/tests/test_thread_access_guard.py`

**Step 1: Write failing tests**

Cover endpoint access:
- owner can call `/threads/{tid}/history`
- non-owner gets `403`
- owner can call `/threads/{tid}/runs/{rid}/stream`

**Step 2: Run tests to verify failure**

Run: `cd backend && pytest -q backend/tests/test_thread_access_guard.py`
Expected: FAIL before middleware.

**Step 3: Implement middleware**

Extract `user_id` from runtime context/request, parse thread_id from path, enforce ownership via `assert_thread_owner`.

**Step 4: Run tests to verify pass**

Run: `cd backend && pytest -q backend/tests/test_thread_access_guard.py`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/http/middleware/thread_access_guard.py backend/src/server.py backend/tests/test_thread_access_guard.py
git commit -m "feat(backend): enforce thread ownership guard on langgraph thread routes"
```

### Task 4: Make First Run Persist Runtime Deterministically

**Files:**
- Modify: `backend/src/agents/lead_agent/agent.py`
- Modify: `backend/src/config/runtime_db.py`
- Test: `backend/tests/test_lead_agent_model_resolution.py`

**Step 1: Write failing tests**

Cases:
- first run with explicit model persists `(thread_id,user_id,model_name)`
- history request without explicit model succeeds after first run
- missing model on first run returns strict 400 (no fallback)

**Step 2: Run tests to verify failure**

Run: `cd backend && pytest -q backend/tests/test_lead_agent_model_resolution.py`
Expected: at least one case failing.

**Step 3: Implement minimal resolver hardening**

Keep strict precedence, no default model. Persist runtime only after successful resolution.

**Step 4: Run tests to verify pass**

Run: `cd backend && pytest -q backend/tests/test_lead_agent_model_resolution.py`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/agents/lead_agent/agent.py backend/src/config/runtime_db.py backend/tests/test_lead_agent_model_resolution.py
git commit -m "feat(backend): deterministic thread runtime persistence without model fallback"
```

### Task 5: Gateway As Pure Auth + Context Injector + Proxy Debug

**Files:**
- Modify: `gateway-go/internal/handler/langgraph_runtime.go`
- Modify: `gateway-go/internal/proxy/proxy.go`
- Modify: `gateway-go/internal/middleware/cors.go`
- Test: `gateway-go/internal/handler/langgraph_runtime_test.go`
- Test: `gateway-go/internal/middleware/cors_test.go`

**Step 1: Write failing tests**

- `last-event-id` preflight allowed
- 4xx/5xx upstream body logged with route/method
- no model resolution logic in gateway

**Step 2: Run tests to verify failure**

Run: `cd gateway-go && go test ./...`
Expected: FAIL before adjustments.

**Step 3: Implement minimal fixes**

Keep only:
- JWT auth
- inject `user_id` / `thread_id`
- transparent proxy
- debug logging for upstream errors

**Step 4: Run tests to verify pass**

Run: `cd gateway-go && go test ./...`
Expected: PASS.

**Step 5: Commit**

```bash
git add gateway-go/internal/handler/langgraph_runtime.go gateway-go/internal/proxy/proxy.go gateway-go/internal/middleware/cors.go gateway-go/internal/handler/langgraph_runtime_test.go gateway-go/internal/middleware/cors_test.go
git commit -m "refactor(gateway): keep auth+context injection only and improve upstream observability"
```

### Task 6: End-to-End Contract Tests (Go calls real Python agent)

**Files:**
- Create: `gateway-go/internal/e2e/langgraph_runtime_e2e_test.go`
- Modify: `gateway-go/Makefile` (optional e2e target)

**Step 1: Write failing e2e tests**

Scenario chain:
1. create thread
2. run stream with explicit model
3. history (without model) succeeds
4. cross-user history denied
5. run rejoin stream preflight passes `last-event-id`

**Step 2: Run tests to verify failure**

Run: `cd gateway-go && go test ./internal/e2e -v`
Expected: FAIL before full alignment.

**Step 3: Implement minimal harness/runtime setup**

Use env-configured LangGraph URL and test users/tokens.

**Step 4: Run tests to verify pass**

Run: `cd gateway-go && go test ./internal/e2e -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add gateway-go/internal/e2e/langgraph_runtime_e2e_test.go gateway-go/Makefile
git commit -m "test(e2e): verify langgraph multi-tenant runtime contract through gateway"
```

### Task 7: Frontend Compatibility + Error UX Stabilization

**Files:**
- Modify: `frontend/src/core/threads/hooks.ts`
- Modify: `frontend` stream/error handling files (`stream.lgp.tsx`, `manager.ts` related)
- Test: frontend integration tests for 400/403/CORS paths

**Step 1: Write failing tests**

- first message without model blocked client-side
- 400 `No model resolved` surfaced as actionable UI error
- 403 ownership shown as permission error

**Step 2: Run tests to verify failure**

Run: `cd frontend && pnpm test`
Expected: FAIL before UI mapping.

**Step 3: Implement minimal error mapping**

Map backend errors to stable front-end messages; avoid repeated noisy retries for non-retryable 4xx.

**Step 4: Run tests to verify pass**

Run: `cd frontend && pnpm test`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/core/threads/hooks.ts frontend/src/core/threads/* frontend/src/components/*
git commit -m "feat(frontend): stabilize langgraph runtime error UX and non-retryable handling"
```

---

## Acceptance Criteria

1. First run requires explicit model; no hidden default model fallback.
2. After first successful run, `history` works without resending model.
3. Cross-user access on same `thread_id` is denied with `403`.
4. Rejoin stream passes CORS preflight including `last-event-id`.
5. Gateway never queries model DB; Python owns runtime/model/ownership decisions.
6. `go test ./...`, backend `pytest -q`, and key frontend tests all pass.

## Rollout Order

1. Migrations + backend ownership store.
2. Backend ownership middleware.
3. Resolver persistence hardening.
4. Gateway observability/cors polish.
5. E2E contract tests.
6. Frontend error UX alignment.

## References (Context7 sources)

- https://docs.langchain.com/oss/python/langgraph/local-server
- https://docs.langchain.com/oss/python/langgraph/persistence
- https://docs.langchain.com/oss/python/langgraph/add-memory
- https://docs.langchain.com/oss/javascript/langgraph/persistence
- https://github.com/langchain-ai/langgraph/blob/main/libs/sdk-py/README.md
- https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint/README.md

