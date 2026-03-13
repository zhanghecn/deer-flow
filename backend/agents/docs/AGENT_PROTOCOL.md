# Agent Definition Protocol

This document defines the unified definition/materialization contract shared by
`backend/agents` and `backend/gateway`.

## Goals

- Agent creation is driven by two inputs:
  - agent-owned `AGENTS.md`
  - selected skills copied from the shared skills library
- Shared skills live in one archive and are never edited in place by individual agents.
- Each agent is materialized into separate `dev` and `prod` directories to avoid prompt, skill, and memory pollution.
- Local debugging uses the host filesystem.
- Runtime sandbox selection is decided by Python startup configuration, not by agent metadata stored through Go.
- The default `lead_agent` is the catch-all agent, but it still follows the same copied-skill protocol as every other agent.
- Agent and skill definitions are filesystem archives, not database rows.

## Three Layers

### 1. Definition Layer

- Shared skills archive:
  - `.openagents/skills/shared/.../SKILL.md`
  - `.openagents/skills/store/dev/.../SKILL.md`
  - `.openagents/skills/store/prod/.../SKILL.md`
- `.openagents/skills/` is the single maintained shared-skill source of truth.
- There is no repo-side `skills/public` mirror in the active architecture.
- Agent-owned files:
  - `agents/{status}/{name}/AGENTS.md`
  - `agents/{status}/{name}/config.yaml`
- `config.yaml` is the manifest for local materialization and now includes:
  - `agents_md_path`
  - `skill_refs[]`
  - normal agent metadata such as `model`, `tool_groups`, `mcp_servers`
- There are no `agents`, `skills`, or `agent_skills` database tables in the current architecture.
- Agent versions coexist as directories under `agents/dev/` and `agents/prod/`.

### 2. Materialization Layer

- `materialize_agent_definition()` copies selected skills from the shared archive into:
  - `agents/{status}/{name}/skills/...`
- The copied skill directory is owned by the agent.
- This prevents one agent from mutating a shared skill and affecting every other agent.
- Publishing is filesystem promotion:
  - `agents/dev/{name}` -> `agents/prod/{name}`
- Publish only changes the archived version from `dev` to `prod`.
- Runtime backend selection is not part of publish; Python decides it at startup.

### 3. Runtime Layer

- Per-thread runtime data remains isolated under:
  - `threads/{thread_id}/user-data/{workspace,uploads,outputs}`
- Python chooses the runtime backend at startup:
  - local debug: `LocalShellBackend(root_dir=threads/{thread_id}/user-data, virtual_mode=True)`
  - sandbox runtime: resolve `sandbox.use` / `OPENAGENTS_SANDBOX_PROVIDER`, instantiate the provider in Python, and acquire a sandbox that implements deepagents `BaseSandbox`
- Archived files are not mounted directly into the agent anymore. Python seeds a thread-local runtime copy through backend upload/download APIs:
  - every agent, including `lead_agent`: `agents/{status}/{name}/**` -> `/mnt/user-data/agents/{status}/{name}/**`
- deepagents then reads only the runtime copy:
  - skills source:
    - every agent, including `lead_agent`: `/mnt/user-data/agents/{status}/{name}/skills/`
  - memory source:
    - every agent, including `lead_agent`: `/mnt/user-data/agents/{status}/{name}/AGENTS.md`
- This prevents runtime edits from polluting archived `dev/prod` definitions while keeping local and sandbox execution on the same virtual paths.

## ASCII Flow

```text
 shared skills archive                     archived agent definition
 .openagents/skills/{shared,store/*}       agents/{status}/{name}
            |                                         |
            | materialize selected skills             | keep AGENTS.md + config.yaml
            +--------------------+--------------------+
                                 |
                                 v
                    +------------+-------------+
                    | archived dev/prod tree   |
                    | local filesystem only    |
                    +------------+-------------+
                                 |
                                 | Python startup
                                 v
                 +---------------+----------------+
                 | resolve runtime backend in     |
                 | Python (`sandbox.use` / env)   |
                 +---------------+----------------+
                                 |
                 +---------------+----------------+
                 |                                |
                 v                                v
       +---------+---------+            +---------+---------+
       | local debug       |            | sandbox runtime   |
       | LocalShellBackend |            | provider.acquire  |
       | root=user-data    |            | -> BaseSandbox    |
       +---------+---------+            +---------+---------+
                 |                                |
                 +---------------+----------------+
                                 |
                                 | seed runtime copy via backend upload API
                                 v
             +-------------------+-------------------+
             | thread runtime view                  |
             | /mnt/user-data/workspace             |
             | /mnt/user-data/uploads               |
             | /mnt/user-data/outputs               |
             | /mnt/user-data/agents/{status}/{name}|
             +-------------------+-------------------+
                                 |
                                 v
             +-------------------+-------------------+
             | deepagents runtime                    |
             | skills -> runtime copy                |
             | AGENTS.md memory -> runtime copy      |
             +---------------------------------------+
```

## Current Runtime Rules

- Both `dev` and `prod` are local archived definitions on disk.
- Python chooses the execution backend at startup from sandbox env/config.
- If sandbox is enabled in Python config, Python resolves the configured provider and acquires a sandbox backend.
- If sandbox is not enabled, Python uses `LocalShellBackend` rooted at the thread's `user-data` directory.
- The Python runtime now carries that protocol explicitly.
- The Go gateway now materializes the same filesystem layout that the Python runtime expects.
- Shared skills live under `OPENAGENTS_HOME/skills/`; agent-owned copies stay under `agents/{status}/{name}/skills/`.
- Open API resolves agents by `(name, status="prod")` only.
- Runtime seeding targets thread-local virtual paths, so runtime edits do not mutate archived `dev/prod` files.

## Path Contract

Three path spaces exist and must not be mixed:

### 1. Agent-visible runtime paths

These are the only paths the agent should reason about during execution:

- `/mnt/user-data/workspace/...`
- `/mnt/user-data/uploads/...`
- `/mnt/user-data/outputs/...`
- `/mnt/user-data/agents/{status}/{name}/AGENTS.md`
- `/mnt/user-data/agents/{status}/{name}/skills/...`

### 2. Host filesystem paths

These are implementation details outside the agent contract:

- `.openagents/threads/{thread_id}/user-data/...`
- `.openagents/skills/...`
- `/root/project/...`

They may appear in backend code or local debugging, but must never be hardcoded into
skills, prompts, or agent-authored commands.

### 3. HTTP artifact routes

These are UI/gateway paths only:

- `/api/threads/{thread_id}/artifacts/...`

They are not execution paths for the agent.

## Skill Runtime Rules

- `SkillsMiddleware` must expose runtime-visible backend paths, not host-specific paths.
- The runtime-visible skill path is the source of truth, regardless of whether the
  backend is local or sandboxed.
- The agent must load skills from `/mnt/user-data/agents/{status}/{name}/skills/`.
- Unlike tool-driven skill loaders that expose host file URLs directly, OpenAgents
  relies on `SkillsMiddleware` + `{skills_locations}` to advertise runtime-visible
  backend paths. Keep those paths on the unified runtime contract and do not swap
  them back to archive or host paths.
- When a loaded `SKILL.md` references relative files such as `scripts/generate.py`
  or `templates/report.md`, resolve them relative to that `SKILL.md` parent directory.
- Skill docs must not hardcode host paths or local-debug-only paths just because
  `LocalShellBackend` happens to rewrite them on the host.

## Why This Protocol

- `AGENTS.md` belongs to the agent, not to the shared skills archive.
- Skills are reusable building blocks and should be selected by reference, then copied.
- `dev` and `prod` need separate prompts, skills, and memory buckets.
- The default `lead_agent` should remain the broad exploration agent, but through its own archived/copied skill set rather than implicit access to the full shared archive.

## Gateway Responsibilities

- `backend/gateway` owns CRUD, publish, and filesystem persistence for archived agent definitions.
- On create/update/publish it writes:
  - agent-owned `AGENTS.md`
  - agent-owned `config.yaml`
  - copied agent-local `skills/`
- On publish it promotes the `dev` definition to `prod` without deleting the `dev` archive.
- On create/update/publish it always writes local archived files first:
  - `agents/{status}/{name}/AGENTS.md`
  - `agents/{status}/{name}/skills/...`
  - `agents/{status}/{name}/config.yaml`
- Runtime then seeds those archived files into the chosen runtime backend through backend file APIs.
- Relative `OPENAGENTS_HOME` paths are resolved from the project root so Go and Python share the same `.openagents` tree and the same top-level `skills/` archive.
- Go does not decide whether the runtime uses sandbox. That decision belongs to Python startup/config only.

## Runtime Sandbox Contract

- `src.community.aio_sandbox.AioSandbox` is now a deepagents-compatible sandbox backend.
- It inherits the OpenAgents sandbox base, which itself extends deepagents `BaseSandbox`.
- `AioSandboxProvider` remains responsible for provisioning/reusing the actual container or remote sandbox.
- `lead_agent.build_backend()` is responsible for:
  - deciding local vs sandbox at Python startup
  - acquiring the sandbox when needed
  - seeding archived agent files into the runtime backend
