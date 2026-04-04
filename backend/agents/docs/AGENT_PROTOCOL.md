# Agent Definition And Runtime Protocol

This document defines the filesystem contract shared by `backend/gateway`,
`backend/agents`, and the remote execution CLI.

## Goals

- Keep canonical authored skills under `.openagents/system/skills/` and
  `.openagents/custom/skills/`.
- Keep `.openagents/skills/store/{dev,prod}/` only as a legacy migration input.
- Keep each agent's prompt and copied skills under its own archived directory.
- Seed every run into the same agent-visible runtime paths under
  `/mnt/user-data/...`.
- Let Python choose the runtime backend without changing the agent protocol.
- Let `remote` reuse the same backend protocol as `local` and `sandbox`.

## Source Of Truth

With the default `storage.base_dir: .openagents`, the host-side layout is:

```text
.openagents/
├── system/
│   ├── skills/<skill>/SKILL.md
│   └── agents/{dev,prod}/lead_agent/
│       ├── AGENTS.md
│       ├── config.yaml
│       └── skills/<skill>/...
├── custom/
│   ├── skills/<skill>/SKILL.md
│   └── agents/{dev,prod}/<agent>/
│       ├── AGENTS.md
│       ├── config.yaml
│       └── skills/<skill>/...
├── skills/
│   └── store/
│       ├── dev/<skill>/SKILL.md
│       └── prod/<skill>/SKILL.md
├── threads/<thread_id>/user-data/
└── remote/sessions/<session_id>/
```

Rules:

- Canonical authored skills live under `.openagents/system/skills/` and
  `.openagents/custom/skills/`.
- `.openagents/skills/store/{dev,prod}/` is retained only so migration and
  compatibility code can read older skill refs explicitly.
- Reserved built-in agents such as `lead_agent` live under
  `.openagents/system/agents/{status}/{name}/`.
- Custom authored agents live under `.openagents/custom/agents/{status}/{name}/`.
- Vertical or domain prompts belong in each agent's own `AGENTS.md`.
- Agent-owned copied skills belong in each agent's own `skills/`.

## Three Layers

### 1. Definition Layer

Gateway owns archived agent definitions and archived skill references.

- Reusable authored skills live under `.openagents/system/skills/` and
  `.openagents/custom/skills/`.
- `.openagents/skills/store/{dev,prod}/` is not a canonical write target.
- Built-in reserved agent archives live under
  `.openagents/system/agents/{status}/{name}/`.
- Custom agent archives live under `.openagents/custom/agents/{status}/{name}/`.
- `config.yaml` stores normal agent metadata plus copied `skill_refs`.
- Publishing is filesystem promotion from `dev` to `prod`.

### 2. Materialization Layer

Materialization copies selected archived skills into an agent-owned archive:

```text
.openagents/system/skills/... -> .openagents/system/agents/{status}/{name}/skills/...
.openagents/custom/skills/... -> .openagents/custom/agents/{status}/{name}/skills/...
```

This prevents one agent from mutating the archived skill library for every other agent.

### 3. Runtime Layer

Python seeds archived files into a thread-scoped runtime view before agent tools
use them:

```text
/mnt/user-data/workspace
/mnt/user-data/uploads
/mnt/user-data/outputs
/mnt/user-data/agents/{status}/{name}/AGENTS.md
/mnt/user-data/agents/{status}/{name}/skills/...
```

Deep Agents reads only from these runtime-visible paths.

## Runtime Backend Selection

The runtime backend is selected in Python, not in Go agent metadata.

### Default Backends

- `local`
  - Selected when sandbox config resolves to
    `src.sandbox.local:LocalSandboxProvider`.
  - Uses `LocalShellBackend` rooted at the thread `user-data` directory.
  - Preserves the same `/mnt/user-data/...` contract for local debugging.
- `sandbox`
  - Selected when sandbox config resolves to any non-local provider.
  - Today this is typically `src.community.aio_sandbox:AioSandboxProvider`.
  - The provider can run on one machine or through the provisioner-backed k8s
    mode without changing the agent contract.

### Remote Backend

`remote` is selected per run through runtime params:

```text
configurable.execution_backend = "remote"
configurable.remote_session_id = "<session-id>"
```

Rules:

- `remote` is the only backend selectable per request.
- `local` and `sandbox` remain process-level config decisions.
- Missing `remote_session_id` is a runtime error.
- The return type stays on the same Deep Agents backend protocol as `local` and
  `sandbox`.

## Remote Relay Contract

The remote backend uses a filesystem-backed relay store under:

```text
.openagents/remote/sessions/<session_id>/
├── session.json
├── requests/
│   ├── pending/
│   └── active/
└── responses/
```

Components:

- LangGraph runtime
  - submits backend protocol requests
  - waits for responses
- Remote relay HTTP sidecar
  - registers sessions
  - authenticates CLI workers with a session token
  - exposes poll and submit endpoints
- `openagents-cli`
  - connects a user machine to one remote session
  - maps `/mnt/user-data/...` to local folders
  - executes filesystem and shell operations on behalf of the agent

Supported remote operations:

- `execute`
- `ls_info`
- `read`
- `grep_raw`
- `glob_info`
- `write`
- `edit`
- `upload_files`
- `download_files`

## Agent-Visible Path Contract

These are the only execution paths the agent should reason about:

- `/mnt/user-data/workspace/...`
- `/mnt/user-data/uploads/...`
- `/mnt/user-data/outputs/...`
- `/mnt/user-data/agents/{status}/{name}/AGENTS.md`
- `/mnt/user-data/agents/{status}/{name}/skills/...`

Do not hardcode host paths such as `.openagents/...` or `/root/project/...`
into prompts, skills, or agent-authored shell commands.

## Skill Runtime Rules

- The runtime prompt must advertise runtime-visible copied-skill paths, not archive paths.
- A skill may refer to files relative to its own `SKILL.md` directory.
- Skill docs should not assume local-debug-only host paths.
- Runtime edits affect the seeded runtime copy, not the archived source files.

## Responsibilities

### Gateway

- CRUD for agents and archived skill metadata
- materialization into `.openagents/system/agents/{status}/{name}/` or
  `.openagents/custom/agents/{status}/{name}/`
- publish flow from `dev` to `prod`

### Python Runtime

- resolve the runtime backend factory
- seed archived agent files into the runtime backend
- keep `/mnt/user-data/...` stable across local, sandbox, and remote execution

### Remote CLI

- claim work from the relay
- map virtual paths to local directories
- execute filesystem and shell actions reliably on the connected machine

## Why This Split

- Archived store skills stay reusable and centrally managed.
- Agent prompts stay agent-owned.
- `dev` and `prod` remain archive lifecycles, not execution modes.
- Local debug, managed sandbox, k8s sandbox, and remote execution all share one
  runtime protocol instead of separate code paths.
