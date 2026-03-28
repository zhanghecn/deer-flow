# Unified Runtime Backends And Remote CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify OpenAgents runtime execution behind one backend protocol that cleanly supports local debug, managed sandbox, and remote client-backed execution, while keeping agent/skill runtime paths on the `/mnt/user-data/...` contract.

**Architecture:** Keep `Deep Agents` + `LangGraph` as the orchestration layer and move backend selection into a dedicated runtime backend factory instead of hardcoding it inside `lead_agent`. Remote execution will use the same backend protocol as sandbox mode by introducing a filesystem-backed relay contract plus a Bun CLI client that executes commands and file transfers on a user machine while preserving the agent-visible virtual path contract.

**Tech Stack:** Python, FastAPI/Starlette sidecar in LangGraph runtime, `deepagents.backends`, Go gateway unchanged unless proxy/docs updates are needed, Bun + TypeScript for `openagents-cli`, pytest.

---

### Task 1: Write Failing Tests For Unified Backend Selection

**Files:**
- Modify: `backend/agents/tests/test_lead_agent_backend.py`
- Modify: `backend/agents/tests/test_client.py`

**Step 1: Write the failing test**

Add tests that assert:
- default runtime still resolves `local` from config/env
- sandbox still resolves from `OPENAGENTS_SANDBOX_PROVIDER`
- `configurable.execution_backend=remote` + `configurable.remote_session_id` selects the remote backend
- missing `remote_session_id` raises a clear error
- embedded `OpenAgentsClient` forwards remote backend overrides into runnable config

**Step 2: Run test to verify it fails**

Run: `cd backend/agents && uv run pytest tests/test_lead_agent_backend.py tests/test_client.py -v`

Expected: FAIL because remote runtime selection fields and backend factory behavior do not exist yet.

**Step 3: Write minimal implementation**

Create/modify:
- `backend/agents/src/agents/lead_agent/agent.py`
- `backend/agents/src/client.py`
- new backend factory module(s) under `backend/agents/src/runtime_backends/`

Add explicit runtime fields for remote backend selection and route backend construction through the new factory.

**Step 4: Run test to verify it passes**

Run: `cd backend/agents && uv run pytest tests/test_lead_agent_backend.py tests/test_client.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/tests/test_lead_agent_backend.py backend/agents/tests/test_client.py backend/agents/src/agents/lead_agent/agent.py backend/agents/src/client.py backend/agents/src/runtime_backends
git commit -m "feat: unify runtime backend selection"
```

### Task 2: Add Remote Relay Store And Python Remote Backend

**Files:**
- Create: `backend/agents/src/remote/__init__.py`
- Create: `backend/agents/src/remote/models.py`
- Create: `backend/agents/src/remote/store.py`
- Create: `backend/agents/src/remote/server.py`
- Create: `backend/agents/src/runtime_backends/remote.py`
- Modify: `backend/agents/src/langgraph_dev.py`
- Modify: `backend/agents/src/config/app_config.py`
- Modify: `backend/agents/src/config/paths.py`
- Modify: `backend/agents/src/config/sandbox_config.py` only if shared runtime config fields are required
- Modify: `backend/agents/tests/test_remote_sandbox_backend.py`
- Create: `backend/agents/tests/test_remote_backend_runtime.py`

**Step 1: Write the failing test**

Add tests that assert:
- remote session/request/response files are created under `.openagents/remote/...`
- remote backend can enqueue `execute`, `upload_files`, and `download_files` requests
- responses unblock the waiting backend call
- relay server endpoints register a session, poll requests, submit responses, and update heartbeat/status
- `langgraph_dev` starts the relay sidecar when enabled

**Step 2: Run test to verify it fails**

Run: `cd backend/agents && uv run pytest tests/test_remote_backend_runtime.py tests/test_remote_sandbox_backend.py -v`

Expected: FAIL because the remote relay modules and sidecar do not exist.

**Step 3: Write minimal implementation**

Implement:
- a filesystem-backed relay store under `OPENAGENTS_HOME/remote/sessions/<session_id>/...`
- request/response envelopes for `execute`, `upload_files`, `download_files`
- a `RemoteShellBackend`/`RemoteSandbox` implementation that extends the OpenAgents sandbox base and waits for relay responses
- a small HTTP sidecar in the LangGraph runtime process for session registration, long-poll request delivery, response submission, and health

**Step 4: Run test to verify it passes**

Run: `cd backend/agents && uv run pytest tests/test_remote_backend_runtime.py tests/test_remote_sandbox_backend.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/remote backend/agents/src/runtime_backends/remote.py backend/agents/src/langgraph_dev.py backend/agents/tests/test_remote_backend_runtime.py backend/agents/tests/test_remote_sandbox_backend.py
git commit -m "feat: add remote runtime relay backend"
```

### Task 3: Refactor Local And Sandbox Builders Behind One Runtime Backend Factory

**Files:**
- Create: `backend/agents/src/runtime_backends/__init__.py`
- Create: `backend/agents/src/runtime_backends/factory.py`
- Create: `backend/agents/src/runtime_backends/local.py`
- Create: `backend/agents/src/runtime_backends/sandbox.py`
- Modify: `backend/agents/src/agents/lead_agent/agent.py`
- Modify: `backend/agents/tests/test_lead_agent_backend.py`
- Modify: `backend/agents/docs/AGENT_PROTOCOL.md`
- Modify: `backend/agents/docs/ARCHITECTURE.md`
- Modify: `backend/agents/docs/CONFIGURATION.md`

**Step 1: Write the failing test**

Extend tests to assert:
- `lead_agent` no longer contains branching backend construction logic beyond calling the factory
- local mode still mounts `/mnt/skills` only as a compatibility route
- sandbox mode still acquires a provider-backed sandbox implementing the same protocol
- remote mode uses the same `BackendProtocol` return type

**Step 2: Run test to verify it fails**

Run: `cd backend/agents && uv run pytest tests/test_lead_agent_backend.py -v`

Expected: FAIL because the old direct local/sandbox builders are still wired inline.

**Step 3: Write minimal implementation**

Move backend-specific logic out of `lead_agent/agent.py` into `runtime_backends/*` and leave `lead_agent` responsible only for runtime context resolution and graph construction.

**Step 4: Run test to verify it passes**

Run: `cd backend/agents && uv run pytest tests/test_lead_agent_backend.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/runtime_backends backend/agents/src/agents/lead_agent/agent.py backend/agents/docs/AGENT_PROTOCOL.md backend/agents/docs/ARCHITECTURE.md backend/agents/docs/CONFIGURATION.md
git commit -m "refactor: centralize runtime backend factory"
```

### Task 4: Build The Bun Remote Client (`openagents-cli`)

**Files:**
- Create: `clients/openagents-cli/package.json`
- Create: `clients/openagents-cli/tsconfig.json`
- Create: `clients/openagents-cli/README.md`
- Create: `clients/openagents-cli/src/index.ts`
- Create: `clients/openagents-cli/src/cli.ts`
- Create: `clients/openagents-cli/src/config.ts`
- Create: `clients/openagents-cli/src/session.ts`
- Create: `clients/openagents-cli/src/protocol.ts`
- Create: `clients/openagents-cli/src/runtime.ts`
- Create: `clients/openagents-cli/src/path-map.ts`
- Create: `clients/openagents-cli/src/shell.ts`
- Create: `clients/openagents-cli/src/files.ts`
- Create: `clients/openagents-cli/src/logger.ts`
- Create: `clients/openagents-cli/src/types.ts`
- Create: `clients/openagents-cli/tests/path-map.test.ts`
- Create: `clients/openagents-cli/tests/runtime.test.ts`

**Step 1: Write the failing test**

Add tests that assert:
- virtual paths under `/mnt/user-data/...` map to a client-local runtime root
- shell commands rewrite virtual paths before execution
- file upload/download operations preserve bytes and error codes
- the polling loop claims work, executes it, and posts responses

**Step 2: Run test to verify it fails**

Run: `cd clients/openagents-cli && bun test`

Expected: FAIL because the CLI package does not exist.

**Step 3: Write minimal implementation**

Implement a Bun-based CLI inspired by `../opencode`’s headless attach model:
- `openagents-cli connect`
- `openagents-cli session create`
- `openagents-cli doctor`

The client should:
- register/connect to the relay
- choose a local workspace root
- map `/mnt/user-data/{workspace,uploads,outputs,agents}` to local directories
- execute queued `execute`, `upload_files`, and `download_files` operations

**Step 4: Run test to verify it passes**

Run: `cd clients/openagents-cli && bun test`

Expected: PASS

**Step 5: Commit**

```bash
git add clients/openagents-cli
git commit -m "feat: add bun remote execution client"
```

### Task 5: Document Runtime Parameters, Skill/Agent Ownership, And Remote Usage

**Files:**
- Modify: `README.md`
- Modify: `backend/agents/README.md`
- Modify: `backend/agents/docs/AGENT_PROTOCOL.md`
- Modify: `backend/agents/docs/ARCHITECTURE.md`
- Modify: `backend/agents/docs/CONFIGURATION.md`
- Create: `docs/architecture/remote-backend.md`

**Step 1: Write the failing test**

No code test. Define the required doc changes:
- explain that `.openagents/skills/` is the only shared skill source
- explain that vertical/domain prompt ownership belongs in `.openagents/agents/{dev,prod}/{agent}/AGENTS.md`
- document `configurable.execution_backend=remote` and `configurable.remote_session_id`
- document `openagents-cli` startup and relay connection

**Step 2: Run doc validation**

Run: `rg -n "runtime_backend|skills/public|skills_mode|SOUL.md|remote_session_id|execution_backend" README.md backend/agents/README.md backend/agents/docs docs`

Expected: old or missing terms surface the doc gaps that need cleanup.

**Step 3: Write minimal implementation**

Update the docs to describe the final architecture only. Remove or rewrite stale wording that implies shared runtime skill mutation, legacy mirrors, or direct host-path usage from agent-visible instructions.

**Step 4: Run validation**

Run: `rg -n "skills/public|skills_mode|SOUL.md" README.md backend/agents/README.md backend/agents/docs docs`

Expected: no stale legacy references in the touched docs.

**Step 5: Commit**

```bash
git add README.md backend/agents/README.md backend/agents/docs docs/architecture/remote-backend.md
git commit -m "docs: document unified backends and remote client"
```

### Task 6: End-To-End Verification And Cleanup

**Files:**
- Modify: touched files only as needed from test findings

**Step 1: Run backend tests**

Run:

```bash
cd backend/agents && uv run pytest \
  tests/test_lead_agent_backend.py \
  tests/test_client.py \
  tests/test_remote_backend_runtime.py \
  tests/test_remote_sandbox_backend.py \
  tests/test_aio_sandbox_backend.py -v
```

Expected: PASS

**Step 2: Run CLI tests**

Run:

```bash
cd clients/openagents-cli && bun test
```

Expected: PASS

**Step 3: Manual runtime validation**

Validate:
- `local` mode from `config.yaml`
- sandbox mode by switching `OPENAGENTS_SANDBOX_PROVIDER` / `sandbox.use`
- remote mode by starting the relay sidecar, connecting `openagents-cli`, and invoking the agent with `execution_backend=remote`

**Step 4: Frontend flow validation**

Use:
- `http://localhost:3000`
- `http://localhost:5173`

Exercise:
- click `Surprise`
- generate HTML artifact
- request PPT generation
- preview artifact
- inspect agent internal state in admin UI

**Step 5: Clean-code pass**

Refactor touched code for:
- smaller functions
- intention-revealing names
- comments only where protocol or path-mapping behavior is genuinely non-obvious
- removal of transitional or fallback-only branches that are no longer part of the target architecture

**Step 6: Final verification**

Run:

```bash
git status --short
```

Expected: only intentional implementation changes remain.
