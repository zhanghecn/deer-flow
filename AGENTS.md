Read these docs before changing runtime/backend/sandbox/remote architecture:
@./docs/guides/documentation-boundaries.md
@./docs/architecture/runtime-architecture.md
@./docs/architecture/remote-backend.md
@./docs/architecture/knowledge-base.md
@./docs/testing/README.md
@./docs/testing/knowledge-base/TEST_SPEC.md
@./docs/testing/knowledge-base/PITFALLS.md
@./backend/agents/AGENTS.md

Repository-wide runtime architecture rules:

- Documentation boundary rule:
  - repository engineering docs (`README.md`, `CONTRIBUTING.md`, `docs/**`, service `README.md`) are for humans
  - `AGENTS.md` / subtree `AGENTS.md` / `CLAUDE.md` are for coding agents modifying this repo
  - runtime prompts and skills under `.openagents/**` plus runtime prompt code are a separate runtime-agent contract layer
  - when auditing whether "project docs" match the code, default to the first two layers unless the task explicitly asks about runtime agent behavior
  - inside `docs/`, treat `architecture/`, `guides/`, and `testing/` as current-doc layers; `plans/` and `history/` are not default source of truth

- Treat runtime execution as three separate layers:
  - data plane: file and command operations
  - control plane: sandbox allocation and lifecycle
  - transport: relaying operations to a remote worker
- `BackendProtocol` is the unified data-plane contract for agent-visible file operations.
- `SandboxBackendProtocol` is the shell-capable variant of `BackendProtocol`.
- `SandboxProvider` is a control-plane abstraction. It allocates, reuses, and releases managed sandboxes. Do not mix that lifecycle logic back into runtime file-operation backends.
- `local` is a direct runtime backend for local debugging.
- `sandbox` is a managed runtime backend and must go through a provider/provisioner layer.
- `remote` is a direct runtime backend plus relay transport. It is selected per run, not as a process-wide default.
- Keep prompts, skills, and agent-authored commands on the virtual `/mnt/user-data/...` path contract only.
- Do not hardcode host paths, Docker paths, kube details, or relay store paths into prompts, skills, or tool instructions.
- If you add a new backend type, document:
  - what is data plane
  - what is control plane
  - how thread/session identity is bound
  - how the `/mnt/user-data/...` contract is preserved

Repository-wide testing index:

- Read `./docs/testing/README.md` before closing any knowledge-base, agent UX, runtime integration, or preview/citation task.
- Knowledge-base changes are not considered tested by API/unit tests alone.
- Required knowledge-base test phases are:
  - headed browser user-flow test on `http://localhost:3000`
  - agent internal audit on `http://localhost:5173`
  - current-code stack verification when long-running dev processes may still be serving old code
