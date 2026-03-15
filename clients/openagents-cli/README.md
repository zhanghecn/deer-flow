# openagents-cli

`openagents-cli` is the Bun-based remote execution worker for OpenAgents. It
connects to the LangGraph remote relay sidecar, claims backend protocol
requests, and executes them on the connected machine while preserving the
virtual runtime path contract under `/mnt/user-data/...`.

## What It Does

- creates remote sessions
- connects one machine to one session
- maps `/mnt/user-data/...` virtual paths to local directories
- executes shell and filesystem operations for the `remote` backend

## Commands

```bash
bun run src/index.ts doctor
bun run src/index.ts sessions
bun run src/index.ts session create --json
bun run src/index.ts connect --new --workspace /path/to/project
```

Interactive mode is available by running the CLI with no command. Supported
slash commands:

```text
/sessions
/agents
/new
/connect <session_id> <token>
/doctor
/exit
```

## Path Mapping

The worker keeps the agent-visible contract stable:

| Virtual Path | Local Path |
| --- | --- |
| `/mnt/user-data/workspace` | chosen `--workspace` directory |
| `/mnt/user-data/uploads` | `<runtime-root>/uploads` |
| `/mnt/user-data/outputs` | `<runtime-root>/outputs` |
| `/mnt/user-data/agents` | `<runtime-root>/agents` |

Default runtime root:

```text
~/.openagents-cli/sessions/<session_id>/
```

## Build

```bash
bun test
bun run build
```

This writes `dist/openagents-cli`. Put that binary on your `PATH` if you want
to launch it directly as `openagents-cli`.
