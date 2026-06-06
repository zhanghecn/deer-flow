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

## Root-Cause-First Runtime Prompt Design

- Do not treat prompt text as the first fix for a runtime behavior problem.
  Before changing `AGENTS.md`, copied `SKILL.md`, or subagent prompts, inspect
  the agent-visible system prompt, injected context, attached skills, runtime
  files, and trace/tool calls to identify the actual cause. If the issue is
  stale archive data, duplicated contracts, missing mounted context, wrong tool
  exposure, or an old runtime artifact, fix that source instead of coercing the
  model with more instructions.
- Write runtime prompts from the agent's observable point of view. Do not use
  platform/operator concepts unless they are actually present in the model's
  current context and useful for the task. Examples of usually wrong prompt
  language: "SDK 调用", "主 agent", "工具面板", "旧工具", "产品报告第 01 阶段",
  or internal API names that the model cannot observe as task inputs.
- A prompt is an input/output and tool-use contract for the runtime model, not
  an architecture note for developers. If middleware already injects attached
  knowledge metadata and `mount_path`, a domain skill should not restate the
  entire generic knowledge retrieval recipe or hardcode path templates. It can
  refer to the attached knowledge context and focus only on domain-specific
  evidence requirements.
- Avoid using "禁止/不要/只能" to force a target behavior unless it is a real
  safety, permission, tenant-isolation, or destructive-action boundary. For
  ordinary workflow selection, prefer clear positive task routing and observable
  success criteria. If the wording starts to list many things the model must
  not do, stop and look for a wrong abstraction, duplicated contract, or missing
  product capability.
- Keep `AGENTS.md` thin and agent-legible: role, when to use each attached
  skill, and what final output should look like. Detailed domain workflows
  belong in copied `SKILL.md`, but those skills must still be written as
  instructions to the runtime agent using terms it can observe.
- Subagent prompts must be phrased for that subagent's own view. Do not tell a
  subagent about "主 agent" obligations, internal audit plumbing, or platform
  implementation details unless those are included as explicit inputs to the
  subagent. Pass concrete files, snippets, expected output shape, and stop
  conditions instead.
- Any prompt fix must have a falsifiable verification path: a fresh thread,
  internal trace review, and evidence that the model read the intended files or
  used the intended tools because the correct context was available, not merely
  because the prompt threatened failure.
- Source: user review on 2026-06-04 after bazi runtime-prompt issues; see also
  [docs/guides/documentation-boundaries.md](/root/project/ai/deer-flow/docs/guides/documentation-boundaries.md),
  [docs/architecture/runtime-semantic-boundary.md](/root/project/ai/deer-flow/docs/architecture/runtime-semantic-boundary.md),
  and
  [docs/architecture/opencode-alignment-and-skill-boundary.md](/root/project/ai/deer-flow/docs/architecture/opencode-alignment-and-skill-boundary.md).

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
