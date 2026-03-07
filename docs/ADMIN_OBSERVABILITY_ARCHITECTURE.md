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
   | - llm start/end/error (with token usage)
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
   | list traces / trace events / runtime threads / checkpoint status
   v
Frontend /workspace/admin
   |
   | trace timeline, parent-child tree, token summary,
   | runtime threads, admin account management
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
- per-event token usage + payload snapshot + timing

## Why `checkpoints` Tables Might Be Missing

If LangGraph runs in local in-memory mode, Postgres checkpoint tables are not created.

Current check result in this environment only shows project tables:

- `users`, `agents`, `skills`, `models`, `thread_runtime_configs`, `thread_ownerships`, `threads`, ...
- no `checkpoints` / `checkpoint_blobs` / `checkpoint_writes`

So admin page exposes a checkpoint status endpoint:

- `enabled=false`: checkpoint persistence not active
- `enabled=true`: required tables detected in PostgreSQL

## Thread Tables: Why Three Exist

Current schema has:

- `threads`: business-facing thread metadata (title, created_at, etc.)
- `thread_ownerships`: hard tenant isolation (`thread_id -> user_id`)
- `thread_runtime_configs`: per-thread runtime binding (`agent_name`, `model_name`)

They are split by responsibility, but this can feel redundant operationally.

### Practical recommendation

For enterprise long-term maintenance, unify to a single authoritative runtime binding table in a later migration (e.g. `thread_bindings`) and keep `threads` only for UI metadata. This reduces cross-table drift.

## Admin Scope and RBAC

- Admin endpoints are under `/api/admin/*`
- Require JWT + `role=admin`
- Non-admin users are blocked at middleware
- Bootstrap rule: first registered account is automatically assigned `admin`

## Current UI Tabs

- `智能体监控`: trace list + event stream tree + token summary
- `Checkpoint / Threads`: checkpoint table status + runtime thread list
- `管理账号`: grant/revoke admin role
