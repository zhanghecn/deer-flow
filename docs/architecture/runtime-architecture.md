# Runtime Architecture

This document explains the runtime execution architecture in one place.

It exists for two reasons:

- future maintainers need a stable mental model before changing backend code
- coding agents need short, explicit rules that separate runtime layers cleanly

Related contract:

- slash-command and authoring-target ownership lives in `docs/architecture/agent-authoring-command-contract.md`
- broader syntax-vs-semantics boundary lives in `docs/architecture/runtime-semantic-boundary.md`
- slash commands route workflows; they must not absorb natural-language target inference that belongs to the runtime model

## One-Sentence Model

OpenAgents runtime is split into three layers:

- data plane: how the agent reads, writes, uploads, downloads, and executes
- control plane: how a managed sandbox is created, reused, discovered, and destroyed
- transport: how operations are relayed to a remote worker process

## Hard-Cut Rule

When the repository replaces a runtime, model, or backend contract with a new canonical one,
do not keep the old path alive with compatibility fallback logic.

Examples of prohibited patterns:

- read models from both database and config just in case one is stale
- silently retry a deprecated backend path after the canonical path fails
- keep a legacy subprocess execution path after ownership moved to a service/worker
- accept stale legacy identifiers and map them implicitly at runtime forever

Required approach:

- migrate persisted data to the new canonical contract
- remove the deprecated branch
- fail explicitly on invalid stale inputs that remain after the migration

## Terminology

| Current Name | Preferred Meaning | Plane | Responsibility |
| --- | --- | --- | --- |
| `BackendProtocol` | runtime data-plane protocol | data plane | file operations |
| `SandboxBackendProtocol` | shell-capable runtime backend | data plane | file operations plus `execute()` |
| `SandboxProvider` | sandbox provisioner / lifecycle manager | control plane | allocate, reuse, release, shutdown |
| `AioSandboxProvider` | managed sandbox provisioner implementation | control plane | selects local-container vs provisioner-backed sandbox mode |
| `RemoteShellBackend` | remote runtime backend | data plane | relays backend operations to a remote session |
| remote relay store/server/CLI | remote transport | transport | queue, poll, execute, respond |

## Current Topology

```text
                         Agent Graph / Filesystem Tools
                                      |
                                      v
                   build_runtime_workspace_backend(...)
                                      |
          +---------------------------+---------------------------+
          |                           |                           |
          v                           v                           v
   local runtime backend      managed sandbox backend      remote runtime backend
   LocalShellBackend          provider -> sandbox          RemoteShellBackend
   direct host execution      managed lifecycle            relay to CLI
```

The factory decides which runtime backend to use:

- `local` vs `sandbox` comes from Python startup config
- `remote` is selected per request with:
  - `configurable.execution_backend = "remote"`
  - `configurable.remote_session_id = "<session-id>"`

## Thread Runtime Binding

Runtime identity is thread-scoped, not process-scoped and not "current UI state".

- `1 thread = 1 agent/runtime binding`
- The binding is persisted in Gateway PostgreSQL `thread_bindings`
- Current binding fields include:
  - `thread_id`
  - `user_id`
  - `agent_name`
  - `agent_status`
  - `model_name`
  - `execution_backend`
  - `remote_session_id`

Operational rules:

- Opening an existing thread must restore that thread's persisted agent/runtime binding
- Before the first run persists a binding, thread-scoped read requests such as `/state` and `/history` may carry explicit runtime identity headers:
  - `x-model-name`
  - `x-agent-name`
  - `x-agent-status`
  - `x-execution-backend`
  - `x-remote-session-id`
- Those headers seed unbound threads only. They must never override an existing persisted `thread_bindings` row.
- Frontend thread URLs must be derived from the persisted binding, not from a global agent selector
- Switching agent, archive (`dev` / `prod`), or execution backend creates a new thread instead of mutating an existing thread
- Frontend "current agent" settings only provide defaults for a new conversation; they must not overwrite historical thread bindings
- Open API always resolves `prod` agent archives, but regular workspace threads may bind either `dev` or `prod`
- Frontend runtime-behavior defaults must stay minimal:
  - do not hard-force planner/todo execution (`is_plan_mode`) onto every thread
  - domain agents whose behavior is governed by copied skills should default to direct execution unless the UI explicitly opts into planner mode
  - reasoning/delegation toggles are runtime-behavior inputs, not a place to smuggle frontend policy into every agent run

## Why The Provider Exists

This is the part that usually causes confusion.

`BackendProtocol` only answers:

```text
I already have an execution environment.
How do I read, write, upload, download, and execute inside it?
```

It does not answer:

```text
Which sandbox belongs to this thread?
Should I reuse an existing sandbox?
How do I create one if it does not exist?
How do I find it again across processes?
When should I release or destroy it?
How do I switch between local-container and k8s-provisioned sandboxes?
```

Those are control-plane questions. That is why `SandboxProvider` exists.

## Control Plane vs Data Plane

### Data Plane

Use `BackendProtocol` or `SandboxBackendProtocol` when you already have a runtime.

Examples:

- read a file
- write a file
- edit a file
- upload or download bytes
- execute a shell command

### Control Plane

Use `SandboxProvider` when the runtime must be created or discovered first.

Examples:

- allocate one sandbox per thread
- rediscover the same sandbox after process restart
- release idle sandboxes
- choose local container mode vs provisioner-backed mode

## Why `sandbox` Needs A Provider But `local` And `remote` Do Not

```text
local:
Agent -> runtime backend -> host filesystem / host shell

sandbox:
Agent -> provider -> sandbox instance -> runtime backend -> sandbox filesystem / sandbox shell

remote:
Agent -> runtime backend -> relay -> CLI -> user machine
```

### Local

`local` is direct. The host process already has the execution environment.
No separate allocation step is needed.

### Sandbox

`sandbox` is managed. The system must first decide which sandbox instance to use
for a thread and may need to create one.

### Remote

`remote` is also direct from the runtime's point of view. The runtime backend
already knows which remote session it is addressing. The lifecycle belongs to
session registration and worker connection, not to sandbox provisioning.

## What `AioSandbox` Actually Means

`AioSandbox` is not "single-machine sandbox" by itself.

It is the HTTP sandbox runtime used behind multiple provisioning modes.

```text
LocalContainerBackend + AioSandbox
  = single-machine container sandbox

RemoteSandboxBackend + AioSandbox
  = provisioner-backed / k8s sandbox

ExistingSandboxBackend + AioSandbox
  = attach to an already-running sandbox service
```

That is why "AioSandbox" and "single-machine sandbox" are not synonyms.

## Compose-Managed Single-Machine Sandbox

For local development we now separate Docker lifecycle from Python runtime:

- Docker Compose owns the shared `sandbox-aio` container lifecycle
- Python runtime connects to it through `sandbox.base_url`
- thread isolation is preserved by rewriting `/mnt/user-data/...` into the mounted host thread tree

Concrete host/container contract:

- Compose host mount override: `OPENAGENTS_DOCKER_HOST_HOME` (default `../.openagents`)
- App-container runtime path: fixed `/openagents-home`
- Shared sandbox mount inside `sandbox-aio`: `/openagents`
- Fixed compose project name: `openagents-dev`
- Shared app secrets file: repo `.env`
- `gateway` and `langgraph` both mount the same root `.env` as `/app/.env`
- Non-secret runtime config stays in `config.yaml` / `gateway.yaml`
- Compose injects the few container-only fixed URLs inline
- Browser-facing URLs such as `ONLYOFFICE_SERVER_URL` stay host-view because the browser, not the container, dereferences them

This keeps `docker compose` usable directly from the `docker/` directory without
requiring a pre-exported absolute `OPENAGENTS_HOME`.

The fixed compose project name is operationally important. If different compose
invocations create different project names, `gateway` and `langgraph` can land
on different bridge networks and service DNS like `http://langgraph:2024` stops
resolving even though container names still exist.

Recommended config rule:

```text
repo .env
  secrets only:
    DATABASE_URI, JWT_SECRET, API keys, REDIS_URI, ...

config.yaml / gateway.yaml
  host-run non-secret runtime config:
    storage paths, sandbox provider/base_url, runtime edition, gateway upstream defaults

docker-compose
  owns fixed in-network service URLs and service-only env
  mounts ../.env into app containers
  injects fixed container-only values inline

gateway/langgraph config files
  continue to read canonical runtime names only
  without extra docker-specific config files
```

## Runtime Path Contract

Every runtime backend must preserve the same agent-visible paths:

```text
/mnt/user-data/workspace
/mnt/user-data/tmp
/mnt/user-data/uploads
/mnt/user-data/outputs
/mnt/user-data/agents/{status}/{name}/...
/mnt/user-data/authoring/...
```

This contract is more important than the host implementation.

Examples:

- local mode may rewrite these paths to thread-local host directories
- `/mnt/user-data/tmp` is the shared scratch exception and may map to one runtime-global temp directory visible to multiple agents
- sandbox mode may mount them into a container
- remote mode may rewrite them to a CLI session workspace on the user machine

Prompts, skills, and tool instructions must only speak in terms of
`/mnt/user-data/...`.

## Concrete Architecture Diagram

```text
                                 ┌─────────────────────────────┐
                                 │      lead_agent graph       │
                                 │ tools: read/write/execute   │
                                 └──────────────┬──────────────┘
                                                │
                                                v
                          ┌─────────────────────────────────────┐
                          │ runtime backend factory             │
                          │ build_runtime_workspace_backend()   │
                          └───────┬─────────────────┬───────────┘
                                  │                 │
                    config/env ---┘                 └--- per-run request param
                                  │                     execution_backend=remote
                                  │
         +────────────────────────+────────────────────────+
         |                                                 |
         v                                                 v
   local / sandbox default                           remote override

   ┌────────────────────────────┐             ┌────────────────────────────┐
   │ local backend              │             │ remote backend             │
   │ LocalShellBackend          │             │ RemoteShellBackend         │
   │ direct host operations     │             │ request/response relay     │
   └────────────────────────────┘             └─────────────┬──────────────┘
                                                            │
                                                            v
                                                     openagents-cli
                                                     on user machine

   ┌────────────────────────────┐
   │ sandbox backend            │
   │ provider.acquire().get()   │
   └─────────────┬──────────────┘
                 │
                 v
          ┌───────────────────────┐
          │ SandboxProvider       │
          │ control plane         │
          └──────────┬────────────┘
                     │
        +------------+-------------+
        |                          |
        v                          v
 LocalContainerBackend      RemoteSandboxBackend
 start local container      call provisioner / k8s
```

## Maintenance Rules

- Do not put sandbox allocation logic into `BackendProtocol` implementations.
- Do not put Docker or k8s details into prompts, skills, or agent-facing docs.
- Do not make `lead_agent` branch on provider-specific details.
- Keep backend selection in the runtime backend factory.
- Keep thread-to-sandbox binding inside the provider/state store layer.
- Keep thread-to-remote-session binding inside request config and relay state.
- Preserve one virtual path contract for all execution modes.

## Extension Checklist

When adding a new runtime mode, answer these questions explicitly:

1. Is this a data-plane backend, a control-plane provisioner, or a transport?
2. Does it allocate a runtime, or does it assume one already exists?
3. How is `thread_id` or `session_id` bound to that runtime?
4. How are `/mnt/user-data/...` paths preserved?
5. Does the agent need to know any provider-specific detail?

If the answer to 5 is "yes", the layering is probably wrong.

## Short Mental Model

Use this shorthand when reasoning about the code:

```text
local   = direct backend
sandbox = provider first, backend second
remote  = direct backend plus relay transport
```

If a future change does not fit that model, document why before merging it.
