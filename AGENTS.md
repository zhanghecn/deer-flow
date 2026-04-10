Read these docs before changing runtime/backend/sandbox/remote architecture:
@./docs/guides/documentation-boundaries.md
@./docs/architecture/agent-authoring-command-contract.md
@./docs/architecture/opencode-alignment-and-skill-boundary.md
@./docs/architecture/runtime-semantic-boundary.md
@./docs/architecture/runtime-architecture.md
@./docs/architecture/remote-backend.md
@./docs/architecture/knowledge-base.md
@./docs/testing/README.md
@./docs/testing/knowledge-base/TEST_SPEC.md
@./docs/testing/knowledge-base/PITFALLS.md
@./backend/agents/AGENTS.md
# 注释要求
您必须写注释

# rules
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
- Comment discipline rule:
  - code comments are a repository-wide requirement, not a backend-only convention
  - add concise comments or docstrings for non-obvious control flow, state ownership, invariants, config precedence, and security assumptions
  - comments should explain why the code is shaped that way, what contract it preserves, or what operators/maintainers must know; do not add trivial line-by-line narration
  - when changing confusing code, improve the nearby comments in the same patch instead of leaving the next reader to reconstruct intent from logs, tests, or git history
  - required comment cases include:
    - path rewriting or path contract preservation
    - config/env precedence and strict no-fallback behavior
    - persistence/restore behavior for stateful flows
    - lifecycle decisions such as acquire/reuse/release/startup/shutdown
    - security, isolation, permission, or multi-tenant assumptions
- Legacy-removal rule:
  - do not preserve legacy runtime/model/backend behavior with compatibility fallbacks once the repository has chosen a new canonical contract
  - when replacing a deprecated path, remove the old branch instead of keeping dual resolution, silent aliasing, or "try old, then new" behavior
  - do not read the same product contract from multiple sources of truth just to preserve older setups; migrate stored data and fail explicitly on invalid stale values
  - if a hard cut requires a migration, write the migration and delete the fallback in the same change set
- Slash-command rule:
  - slash commands are routing and template-selection primitives, not natural-language semantic parsers
  - frontend, gateway, and backend middleware must not regex or heuristically infer target agents, target skills, or other business entities from free-form user text
  - only explicit structured UI selections may populate target identifiers outside the model, and only when those identifiers come from dedicated fields or selections rather than message-text parsing
  - command/object understanding belongs to the runtime model; tool calls must carry explicit targets instead of relying on inferred runtime context
- Runtime semantic boundary rule:
  - outside the model, only syntax-level parsing, machine-readable payload parsing, explicit UI fields, tool arguments/results, and safety validation are allowed
  - frontend, gateway, and backend middleware must not inspect free-form user prose or assistant prose and then infer business mode, target runtime, review mode, question gating, or other semantic intent
  - if a non-model layer needs a business decision, expose that decision as an explicit structured field or tool/result contract instead of adding keyword tables, fuzzy matching, or regex heuristics
- Generic-agent / harness-first rule:
  - treat this project as a general-purpose agent runtime, not a single-demo or single-example workflow
  - do not keep adding example-specific prompt glue, one-off tool additions, or special-case middleware just to make one scenario pass
  - when a capability gap is real, first fix it in the harness/runtime/tool contract/eval path so the improvement generalizes across tasks
  - only add new prompts, tools, or workflow constraints when they represent a reusable product contract rather than a patch for one example
- Runtime skill contract rule:
  - slash-command 对齐 `opencode` 时，必须先检查本地参考仓库 `../opencode`（当前绝对路径 `/root/project/ai/opencode`），并明确写清楚对齐的是 command routing / template loading / skill discovery / explicit skill tool 中的哪一层
  - 不要把 “对齐 opencode” 扩大解释成 OpenAgents runtime skill 全架构自动应当如何实现
  - skill 相关架构至少涉及 3 套不同机制：`opencode` 的显式 `skill` 工具、Deep Agents `skills=` / `SkillsMiddleware` / `skills_metadata`、以及 OpenAgents agent-owned copied skills；修改前必须先区分清楚，禁止混写
  - 在新的唯一 skill 链路完成 end-to-end 代码接线、trace 可见性、状态验证、以及真实 UI 测试前，不要在 `AGENTS.md` 中写“只能 direct read `SKILL.md`”“不能再用 `skills=`”“不能有 `skill` 工具”这类绝对化约束
  - when an agent's domain behavior is primarily defined by attached copied skills, keep `AGENTS.md` thin and let copied `SKILL.md` remain the single detailed workflow source
  - do not duplicate a skill's full checklist, step order, or output contract into `AGENTS.md`, because that creates a second weaker instruction source that drifts from the copied skill
  - if the same domain skill must support different task shapes such as editable-file review vs knowledge-base chat review, define those modes in `SKILL.md` itself rather than in frontend heuristics or extra prompt glue
  - changing an archived store skill does not silently rewrite existing agent-owned copied skills; copied skill refresh must happen through an explicit agent update/materialization flow
- Runtime mode flag rule:
  - frontend defaults must not hard-force planner-style runtime flags such as `is_plan_mode` onto every chat turn
  - non-`lead_agent` domain agents, especially ones governed by attached copied skills, should default to direct execution unless a dedicated UI control explicitly opts into planner/todo behavior
  - avoid front-end policy that broadens runtime behavior for all agents by default; keep those choices explicit and structured
- Knowledge asset storage rule:
  - knowledge-base file assets use a dedicated Knowledge Asset Store; PostgreSQL is not the binary asset source of truth
  - `KNOWLEDGE_OBJECT_STORE` must be explicitly configured; do not reintroduce a missing-env fallback to filesystem
  - production/shared environments must use `minio`; local `filesystem` is only for explicitly configured debugging or development
  - when removing filesystem-backed KB storage from an environment, migrate persisted `storage_ref` rows and document packages in the same change set instead of relying on dual-read fallbacks

Repository-wide testing index:

- Read `./docs/testing/README.md` before closing any knowledge-base, agent UX, runtime integration, or preview/citation task.
- Knowledge-base changes are not considered tested by API/unit tests alone.
- When the user asks for a "real test" or current-code browser verification, default to `docker/docker-compose-prod.yaml`.
- Use the correct prod entrypoint for the surface under test:
  - agent management / admin console: `http://127.0.0.1:8081`
  - user-facing app / workspace flows: `http://127.0.0.1:8083`
- Required knowledge-base test phases are:
  - headed browser user-flow test on `http://localhost:3000`
  - agent internal audit on `http://localhost:5173`
  - current-code stack verification when long-running dev processes may still be serving old code
