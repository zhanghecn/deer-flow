# Configuration Guide

This guide covers the runtime settings that matter for local execution,
single-machine sandboxing, k8s-backed sandboxing, and the remote backend.

## Core Config

`config.yaml` still owns the process-level runtime configuration.

Minimal example:

```yaml
runtime:
  edition: inmem
  jobs_per_worker: 4

storage:
  base_dir: .openagents

skills:
  path: .openagents/skills
  container_path: /mnt/skills

sandbox:
  use: src.sandbox.local:LocalSandboxProvider
```

Notes:

- `runtime.jobs_per_worker` controls LangGraph dev queue concurrency for local
  and Docker dev runs. Increase it when long-running runs would otherwise block
  newer threads behind a single worker.
- `storage.base_dir` is where archived agents, users, threads, and remote relay
  session state live.
- `skills.path` points at the legacy skills-library compatibility root used for
  `store/dev|prod` migration input and `/mnt/skills` exposure, not at per-agent
  copied skills.
- `skills.container_path` is only a compatibility mount for local execution.
  Active runtime skills are still read from `/mnt/user-data/agents/...`.

## Runtime Backend Modes

## LangGraph Queue Concurrency

`backend/agents/src/langgraph_dev.py` passes queue concurrency to LangGraph with
the following precedence:

1. `OPENAGENTS_LANGGRAPH_JOBS_PER_WORKER`
2. `N_JOBS_PER_WORKER`
3. `runtime.jobs_per_worker` in `config.yaml`
4. built-in dev default: `4`

Example override:

```bash
export OPENAGENTS_LANGGRAPH_JOBS_PER_WORKER=8
```

### 1. Local Debug

Use the local provider when you want one-machine debugging with no managed
sandbox lifecycle.

```yaml
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
```

Equivalent environment override:

```bash
export OPENAGENTS_SANDBOX_PROVIDER=src.sandbox.local:LocalSandboxProvider
```

Behavior:

- backend kind resolves to `local`
- execution happens on the current machine
- agent-visible paths still stay under `/mnt/user-data/...`

### 2. Single-Machine Managed Sandbox

Use `AioSandboxProvider` without a provisioner when you want an isolated sandbox
provider on one machine.

```yaml
sandbox:
  use: src.community.aio_sandbox:AioSandboxProvider
```

Behavior:

- backend kind resolves to `sandbox`
- provider lifecycle stays inside Python
- agent contract does not change

### 3. K8s Autoscaling Sandbox

Use the same provider with a provisioner URL when sandbox instances should be
created dynamically, including k8s-backed pods.

```yaml
sandbox:
  use: src.community.aio_sandbox:AioSandboxProvider
  provisioner_url: http://provisioner:8002
```

Operational notes:

- `make docker-start` should start the provisioner only when this mode is
  configured.
- kubeconfig and cluster-specific wiring belong to the provisioner deployment,
  not to agent prompts or skill docs.
- the LangGraph runtime should still only see a sandbox backend implementing the
  Deep Agents protocol.

### 4. Remote Backend

`remote` is not chosen in `config.yaml`. It is selected per run.

Required runtime params:

```text
configurable.execution_backend = "remote"
configurable.remote_session_id = "<session-id>"
```

Python example with the embedded client:

```python
from src.client import OpenAgentsClient

client = OpenAgentsClient()
response = client.chat(
    "Inspect the project and update the README.",
    thread_id="remote-demo",
    execution_backend="remote",
    remote_session_id="abc123session",
)
```

LangGraph/API callers must pass the same keys under `configurable`.

Rules:

- `remote` is the only per-request backend override.
- local and sandbox selection still come from process config/env.
- omitting `remote_session_id` is a hard error.

## Remote Relay Sidecar

The LangGraph dev runtime starts a relay sidecar automatically unless disabled.

Environment variables:

```bash
export OPENAGENTS_REMOTE_RELAY_ENABLED=true
export OPENAGENTS_REMOTE_RELAY_HOST=127.0.0.1
export OPENAGENTS_REMOTE_RELAY_PORT=2025
```

Defaults:

- relay enabled: `true`
- host: `127.0.0.1`
- port: `2025`

Relay state is stored under:

```text
.openagents/remote/sessions/<session_id>/
```

## openagents-cli

The remote worker CLI lives in `clients/openagents-cli`.

Development commands:

```bash
cd clients/openagents-cli
bun test
bun run build
```

Create or list sessions:

```bash
bun run src/index.ts session create --json
bun run src/index.ts sessions
```

Connect a machine to a session:

```bash
bun run src/index.ts connect \
  --session <session_id> \
  --token <client_token> \
  --workspace /path/to/project
```

Compiled binary:

- `bun run build` writes `clients/openagents-cli/dist/openagents-cli`
- place that binary on your `PATH` if you want to launch it directly as
  `openagents-cli`

## Skill And Agent Archives

Current ownership rules:

- canonical authored reusable skills:
  - `.openagents/system/skills/<skill>`
  - `.openagents/custom/skills/<skill>`
- legacy migration-only skill input:
  - `.openagents/skills/store/dev`
  - `.openagents/skills/store/prod`
- built-in agent-owned prompt/copies:
  - `.openagents/system/agents/{dev,prod}/{agent}/AGENTS.md`
  - `.openagents/system/agents/{dev,prod}/{agent}/skills`
- custom agent-owned prompt/copies:
  - `.openagents/custom/agents/{dev,prod}/{agent}/AGENTS.md`
  - `.openagents/custom/agents/{dev,prod}/{agent}/skills`

`config.yaml` should reference the archived skills library and agent manifests.
Runtime then copies archived agent files into `/mnt/user-data/...`.

## Models, MCP, And Secrets

Model and extension settings remain unchanged:

- model definitions live in `config.yaml`
- MCP and skill enablement live in `extensions_config.json`
- secrets should come from environment variables

## Best Practices

- Keep prompts and skills free of host-specific filesystem paths.
- Treat `dev` and `prod` as archive lifecycles, not runtime modes.
- Switch `local` and `sandbox` through config or environment.
- Switch `remote` through runtime request parameters only.
- Keep `.openagents/skills/store/{dev,prod}/` as the only maintained archived skill source.
