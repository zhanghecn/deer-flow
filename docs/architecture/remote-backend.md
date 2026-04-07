# Remote Backend

The remote backend lets an OpenAgents runtime operate a connected user machine
while keeping the same backend protocol used by local and sandbox execution.

## Components

- LangGraph runtime
  - submits backend protocol requests
- remote relay sidecar
  - exposes HTTP endpoints for session registration, polling, and responses
- filesystem relay store
  - persists session state under `.openagents/remote/sessions/`
- `openagents-cli`
  - runs on the user machine and executes the queued work

## Session Lifecycle

### 1. Start The Runtime

Run the LangGraph development runtime. It starts the relay sidecar unless
`OPENAGENTS_REMOTE_RELAY_ENABLED=false`.

Default relay address:

```text
http://127.0.0.1:2025
```

### 2. Create A Remote Session

```bash
cd clients/openagents-cli
bun run src/index.ts session create --json
```

Response:

```json
{
  "session_id": "c0ffee1234abcd",
  "client_token": "...",
  "created_at": "2026-03-15T00:00:00Z"
}
```

### 3. Connect A Worker

```bash
bun run src/index.ts connect \
  --session c0ffee1234abcd \
  --token <client_token> \
  --workspace /path/to/project
```

The worker:

- heartbeats the relay
- polls for requests
- rewrites virtual runtime paths to local machine paths
- executes commands and file operations

### 4. Invoke The Agent With `remote`

Pass the runtime params on the request:

```text
configurable.execution_backend = "remote"
configurable.remote_session_id = "c0ffee1234abcd"
```

Embedded client example:

```python
from src.client import OpenAgentsClient

client = OpenAgentsClient()
client.chat(
    "Generate a landing page and save the files.",
    thread_id="remote-thread",
    execution_backend="remote",
    remote_session_id="c0ffee1234abcd",
)
```

LangGraph HTTP callers must pass the same fields under `configurable`.

## Path Mapping

The agent still sees the normal runtime contract:

```text
/mnt/user-data/workspace
/mnt/user-data/tmp
/mnt/user-data/uploads
/mnt/user-data/outputs
/mnt/user-data/agents
```

`openagents-cli` maps those virtual paths to local directories:

| Virtual Path | Local Path |
| --- | --- |
| `/mnt/user-data/workspace` | chosen `--workspace` directory |
| `/mnt/user-data/tmp` | `<runtime-root>/tmp` |
| `/mnt/user-data/uploads` | `<runtime-root>/uploads` |
| `/mnt/user-data/outputs` | `<runtime-root>/outputs` |
| `/mnt/user-data/agents` | `<runtime-root>/agents` |

Default runtime root:

```text
~/.openagents-cli/sessions/<session_id>/
```

## Relay Store Layout

```text
.openagents/remote/sessions/<session_id>/
├── session.json
├── requests/
│   ├── pending/
│   └── active/
└── responses/
```

This store is shared by the runtime and the relay sidecar. It makes the remote
backend restart-friendly and inspectable during debugging.

## Supported Operations

The remote worker currently handles:

- `execute`
- `ls_info`
- `read`
- `grep_raw`
- `glob_info`
- `write`
- `edit`
- `upload_files`
- `download_files`

## Build A Standalone CLI

```bash
cd clients/openagents-cli
bun run build
```

Output:

```text
clients/openagents-cli/dist/openagents-cli
```

Place that binary on your `PATH` if you want to start it directly as
`openagents-cli`.

## Operational Notes

- `remote` is per-run and does not replace the configured default backend.
- `local` and `sandbox` remain process-level defaults for normal runs.
- Session tokens authenticate worker access to one remote session.
- Keep prompts and skills on virtual `/mnt/user-data/...` paths only.
