# Admin Observability Architecture

## Goal

Build production monitoring without Smith:

- Trace every run (model calls, tool calls, subagent/task flow)
- Aggregate token usage
- Provide admin-only backend UI for monitoring and runtime inspection
- Keep gateway responsibilities minimal: auth + forwarding + admin APIs

## End-to-End Flow (ASCII)

```text
User Browser
   |
   | POST /api/langgraph/threads/{thread_id}/runs/stream
   | context: { model_name, agent_name, ... }
   v
Gateway-go
   |
   | 1) JWT auth -> user_id
   | 2) Inject x-user-id / x-thread-id
   | 3) Proxy to LangGraph
   v
LangGraph API (2024)
   |
   | create run + call make_lead_agent(config, runtime)
   v
Python lead_agent factory
   |
   | resolve user/thread/model/agent
   | attach AgentTraceCallbackHandler (trace_id)
   v
LangGraph / DeepAgent execution
   |
   | callback emits:
   | - chain start/end/error
   | - llm start/end/error (with token usage, structured request messages, registered tools, request settings)
   | - tool start/end/error
   | - task tool => subagent branch id (task_run_id)
   v
PostgreSQL
   |
   | agent_traces
   | agent_trace_events
   v
Gateway Admin APIs (/api/admin/*)
   |
   | list traces / trace events / runtime storage / checkpoint status
   v
Frontend /workspace/admin
   |
   | trace timeline, parent-child tree, token summary,
   | runtime storage, cleanup jobs, admin account management
   v
Admin Operator
```

## Trace Data Model

### `agent_traces`

One row per run trace.

- `trace_id` primary key
- `root_run_id`
- `user_id`, `thread_id`, `agent_name`, `model_name`
- `status` (`running|completed|error`)
- token totals (`input_tokens`, `output_tokens`, `total_tokens`)
- `started_at`, `finished_at`, `error`, `metadata`

### `agent_trace_events`

Ordered event stream under a trace.

- `trace_id` + `event_index` preserve execution order
- `run_id`, `parent_run_id` build run tree
- `run_type` (`chain|llm|tool`), `event_type` (`start|end|error`)
- `tool_name`, `task_run_id` (used to isolate subagent branches)
- per-event token usage + structured payload snapshot + timing
- LLM `start` payload keeps `model_request.messages`, `model_request.tools`,
  request settings/options, and provider extras with field-level truncation instead of a
  single flat preview string

## Why `checkpoints` Tables Might Be Missing

If LangGraph runs in local in-memory mode, Postgres checkpoint tables are not created.

Current check result in this environment only shows project tables:

- `users`, `agents`, `skills`, `models`, `thread_bindings`, ...
- no `checkpoints` / `checkpoint_blobs` / `checkpoint_writes`

So admin page exposes a checkpoint status endpoint:

- `enabled=false`: checkpoint persistence not active
- `enabled=true`: required tables detected in PostgreSQL

## Thread Runtime Binding

Current schema is unified:

- `thread_bindings`: single authoritative table for runtime binding and tenant ownership
  (`thread_id -> user_id`, plus `agent_name` / `assistant_id` / `model_name`)

Thread metadata itself is sourced from LangGraph `threads` storage/APIs, not from gateway-local thread tables.

## Runtime Storage Administration

The admin runtime storage page exposes logical user/thread aggregation without
changing the agent-visible `/mnt/user-data/...` contract.

Admin-only endpoints:

- `GET /api/admin/runtime/storage/summary`
- `GET /api/admin/runtime/storage/users`
- `GET /api/admin/runtime/storage/users/:user_id`
- `GET /api/admin/runtime/storage/threads`
- `GET /api/admin/runtime/storage/threads/:thread_id`
- `POST /api/admin/runtime/storage/cleanup/preview`
- `POST /api/admin/runtime/storage/cleanup/jobs`
- `GET /api/admin/runtime/storage/cleanup/jobs/:job_id`
- `GET /api/admin/runtime/storage/cleanup/policies`
- `PUT /api/admin/runtime/storage/cleanup/policies/:action`

Storage scanning walks `.openagents/users/{user_id}/threads` and reads
checkpoint metadata on a background interval. HTTP requests read the cached
snapshot unless `refresh=true` is passed. Filesystem statistics stay
directory-level only; file contents are not stored or returned.

Cleanup intentionally has one destructive action:

- `full_thread_delete`: keeps the existing product order: LangGraph
  `DELETE /threads/{thread_id}`, then checkpoint rows, `thread_bindings`, and
  finally the host thread directory.

Full delete candidates are blocked when a thread has a running trace, an
interrupt marker in checkpoint state, an authoring draft directory, or recent
activity relative to the requested threshold. The old
`.openagents/threads/{thread_id}` layout is only a one-time migration input;
live runtime paths must resolve through `user_id + thread_id`.

Scheduled and manually-created cleanup jobs intentionally expose only
whole-session deletion. The scheduler always computes a preview first; it only
creates cleanup jobs after an admin has explicitly enabled the policy and
switched it out of dry-run mode. Partial actions such as checkpoint pruning and
runtime-cache eviction are not executable through admin cleanup jobs because
they can leave a session present but missing recoverability or runtime context.

## Admin Scope and RBAC

- Admin endpoints are under `/api/admin/*`
- Require JWT + `role=admin`
- Non-admin users are blocked at middleware
- Bootstrap rule: first registered account is automatically assigned `admin`
- Admin operators can manage per-user public API keys through
  `/api/admin/users/:user_id/tokens`
- Admin thread inspection reuses the thread owner's persisted binding when
  opening runtime workspace or design board sessions, so debug reads land in
  the real tenant-scoped runtime instead of the admin operator's own context

## Current UI Tabs

- `智能体监控`: trace list + event stream tree + token summary
- Admin UI groups raw events by `run_id` before rendering, so operators inspect one run at
  a time (timeline row or 3D node) in a detail dialog instead of expanding individual
  start/end events
- Run detail panels prioritize readable blocks (messages, tool cards, request config, outputs)
  and keep raw JSON in collapsed advanced inspectors
- `Runtime Storage`: checkpoint/filesystem summary, user -> thread storage
  explorer, scheduled whole-session delete settings, thread detail drawer,
  delete preview, and delete job status
- Thread-level debug flows may escalate from trace review into runtime workspace
  or design-board inspection while still honoring the original thread owner
- `管理账号`: grant/revoke admin role

## Context Window Semantics

- `ContextWindow` is recorded as a dedicated `system` event from Python callbacks.
- The payload comes from persisted LangGraph state `context_window`, not from trace token totals.
- `trace.total_tokens` answers "how expensive was the whole run".
- `context_window.approx_input_tokens / max_input_tokens` answers "how full is the active prompt right now".
- Admin UI should treat these as separate metrics and present them separately.

See [CONTEXT_WINDOW_AND_SUMMARIZATION_NOTES.md](CONTEXT_WINDOW_AND_SUMMARIZATION_NOTES.md) for the engineering notes behind this split.
