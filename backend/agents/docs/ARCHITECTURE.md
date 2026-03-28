# Architecture Overview

This document describes the current OpenAgents backend architecture after the
runtime backend unification.

If you need the explicit control-plane vs data-plane explanation, or the reason
the sandbox provider exists at all, read:

- `docs/architecture/runtime-architecture.md`

## System Overview

```text
Browser / Admin UI
        |
        v
     Nginx :2026
        |
        +---------------------------+
        |                           |
        v                           v
LangGraph runtime :2024        Gateway API :8001
        |                           |
        |                           +-- agent CRUD / publish
        |                           +-- skills APIs
        |                           +-- uploads / artifacts metadata
        |
        +-- lead_agent graph
        +-- middleware chain
        +-- runtime backend factory
        +-- remote relay sidecar :2025
```

The frontend runs on `:3000`. The admin/monitoring UI runs on `:5173`.

## Core Runtime

The main entry point is `src/agents/lead_agent/agent.py`.

Responsibilities:

- resolve the effective agent archive
- build the Deep Agents graph
- seed archived agent files into the runtime backend
- expose filesystem and shell tools through one backend protocol
- emit observability data for the admin console

## Runtime Backend Factory

Backend construction is centralized under `src/runtime_backends/`.

```text
build_runtime_workspace_backend(...)
    |
    +-- local    -> LocalShellBackend
    +-- sandbox  -> provider.acquire(...).get(...)
    +-- remote   -> RemoteShellBackend(session_id=...)
```

Selection rules:

- `local` vs `sandbox` comes from Python config or
  `OPENAGENTS_SANDBOX_PROVIDER`.
- `remote` is chosen per run with:
  - `configurable.execution_backend = "remote"`
  - `configurable.remote_session_id = "<session-id>"`

This keeps backend switching out of the agent graph logic and prevents
`lead_agent` from owning provider-specific branches.

## Unified Path Contract

Every backend must preserve the same agent-visible paths:

- `/mnt/user-data/workspace`
- `/mnt/user-data/uploads`
- `/mnt/user-data/outputs`
- `/mnt/user-data/agents/{status}/{name}/AGENTS.md`
- `/mnt/user-data/agents/{status}/{name}/skills/...`

Host-side implementations vary, but prompts, skills, and tools must behave as if
the runtime always lives under `/mnt/user-data/...`.

## Agent And Skill Archives

Archived definitions live under `.openagents/`.

```text
.openagents/
├── skills/{shared,store/dev,store/prod}/...
└── agents/{dev,prod}/{agent}/
    ├── AGENTS.md
    ├── config.yaml
    └── skills/...
```

Ownership rules:

- Shared skills belong only in `.openagents/skills/`.
- Vertical or domain prompt ownership belongs in
  `.openagents/agents/{dev,prod}/{agent}/AGENTS.md`.
- Runtime copies are seeded from those archives into `/mnt/user-data/...`.

## Runtime Backends

### Local

Used for local debugging on one machine.

- `LocalShellBackend` is rooted at the thread's `user-data` directory.
- Path rewriting preserves the `/mnt/user-data/...` illusion.
- Shared skills may still be mounted through the configured compatibility route,
  but the active agent reads copied runtime skills from `/mnt/user-data/agents/...`.

### Sandbox

Used for managed isolation through the sandbox provider contract.

- Current integrated provider: `src.community.aio_sandbox:AioSandboxProvider`
- Works for:
  - single-machine sandbox use
  - provisioner-backed sandbox lifecycle
  - k8s autoscaling sandbox pods

The LangGraph runtime only needs a backend implementing the Deep Agents sandbox
protocol. Provisioning details stay inside the provider.

### Remote

Used when an agent should operate a connected user machine.

- Runtime backend implementation: `src/runtime_backends/remote.py`
- Relay store: `.openagents/remote/sessions/<session_id>/...`
- Relay HTTP sidecar: `src/remote/server.py`
- Worker CLI: `clients/openagents-cli`

The remote backend does not bypass the normal tool layer. It simply relays the
same backend protocol calls over a session queue.

## Remote Relay Flow

```text
agent tool call
    |
    v
RemoteShellBackend.submit_request(...)
    |
    v
.openagents/remote/sessions/<id>/requests/pending/*.json
    |
    v
relay sidecar HTTP poll endpoint
    |
    v
openagents-cli worker on user machine
    |
    +-- map /mnt/user-data/workspace -> local workspace
    +-- map /mnt/user-data/uploads   -> local runtime uploads
    +-- map /mnt/user-data/outputs   -> local runtime outputs
    +-- map /mnt/user-data/agents    -> local runtime agent copy
    |
    v
response submitted back to relay
    |
    v
RemoteShellBackend.wait_for_response(...)
```

## K8s Provisioner Mode

`AioSandboxProvider` can run against a provisioner service that creates sandbox
pods on demand.

Architecture intent:

- LangGraph keeps the same backend factory contract.
- Provisioner-specific kubeconfig and pod lifecycle handling stay inside the
  sandbox provider and provisioner service.
- Switching between one-machine sandbox and k8s autoscaling should only require
  config changes, not agent code changes.

## Middleware Chain

Key runtime middlewares:

- `UploadsMiddleware`
  - injects uploaded file context
- `FilesystemMiddleware`
  - exposes file and shell tools over the selected runtime backend
- `ArtifactsMiddleware`
  - records generated files for preview/download
- `TitleMiddleware`
  - derives a lightweight first-turn title without an extra model call
- `ContextWindowMiddleware`
  - persists prompt occupancy for monitoring
- `MemoryMiddleware`
  - queues long-term memory extraction
- `ClarificationMiddleware`
  - interrupts for explicit clarification turns

Thread runtime paths are now resolved from `thread_id` inside tool/backend helpers
instead of being precomputed into graph state by a dedicated middleware.

## Observability

The admin UI at `http://localhost:5173` is expected to show:

- model/tool request traces
- workflow progression
- agent runtime state snapshots
- generated artifacts and related metadata

This data should remain backend-agnostic. Whether execution happened on local,
sandbox, or remote, the trace shape should stay coherent.

## Design Principles

- One runtime backend protocol
- One agent-visible path contract
- One shared skills archive
- Agent-owned prompts and copied skills
- No legacy host-path instructions in prompts or skills
- Backend choice isolated from agent definition lifecycle
