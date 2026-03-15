Read these docs before changing runtime/backend/sandbox/remote architecture:
@./docs/runtime-architecture.md
@./docs/remote-backend.md
@./backend/agents/AGENTS.md

Repository-wide runtime architecture rules:

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
