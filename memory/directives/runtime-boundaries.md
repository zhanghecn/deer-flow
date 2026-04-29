# Runtime Boundary Memory

## Data Plane, Control Plane, Transport

- Keep runtime execution separated into:
  - data plane: file and command operations through `BackendProtocol`
  - shell-capable data plane: `SandboxBackendProtocol`
  - control plane: sandbox allocation/reuse/release through `SandboxProvider`
  - transport: remote relay behavior selected per run
- Do not mix sandbox lifecycle logic back into runtime file-operation backends.
- Source: `AGENTS.md`;
  [docs/architecture/runtime-architecture.md](/root/project/ai/deer-flow/docs/architecture/runtime-architecture.md).

## Virtual Path Contract

- Prompts, skills, and agent-authored commands must stay on the virtual
  `/mnt/user-data/...` path contract.
- Do not hardcode host paths, Docker paths, Kubernetes details, or relay store
  paths into prompts, skills, or model-visible tool instructions.

## Documentation Layers

- `docs/architecture`, `docs/guides`, and `docs/testing` are current
  human-facing documentation.
- `memory/**` is coding-agent continuity memory.
- `AGENTS.md`, subtree `AGENTS.md`, and `CLAUDE.md` are coding-agent
  collaboration contracts.
- `.openagents/**`, runtime prompts, and copied skills are runtime-agent
  contracts and must not be conflated with repo contributor docs.
- Source: [docs/guides/documentation-boundaries.md](/root/project/ai/deer-flow/docs/guides/documentation-boundaries.md).

## Runtime Semantic Boundary

- Non-model layers may parse syntax, machine-readable payloads, explicit UI
  fields, tool arguments/results, and safety validation.
- Frontend, gateway, and backend middleware must not infer domain mode, target
  runtime, review mode, question gating, or other semantic intent from free-form
  user or assistant prose.
- If a non-model layer needs a business decision, expose it as an explicit
  structured field or tool/result contract.
- Source: [docs/architecture/runtime-semantic-boundary.md](/root/project/ai/deer-flow/docs/architecture/runtime-semantic-boundary.md).

## Skill Contract Boundary

- When aligning slash commands with `opencode`, inspect the local
  `/root/project/ai/opencode` reference first and state whether the change is
  about command routing, template loading, skill discovery, or explicit skill
  tools.
- Do not mix `opencode` explicit `skill` tools, Deep Agents `SkillsMiddleware`,
  and OpenAgents copied skills into one assumed mechanism.
- Keep detailed domain workflows in copied `SKILL.md` when attached skills define
  agent behavior; keep `AGENTS.md` thin.
- Source: `AGENTS.md`;
  [docs/architecture/opencode-alignment-and-skill-boundary.md](/root/project/ai/deer-flow/docs/architecture/opencode-alignment-and-skill-boundary.md).
