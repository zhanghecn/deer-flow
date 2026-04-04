Read these docs before changing agent/runtime/backend/skills behavior:
@../../docs/guides/documentation-boundaries.md
@../../docs/architecture/agent-authoring-command-contract.md
@../../docs/architecture/opencode-alignment-and-skill-boundary.md
@../../docs/architecture/runtime-semantic-boundary.md
@../../docs/architecture/runtime-architecture.md
@../../docs/architecture/knowledge-base.md
@../../docs/testing/README.md
@../../docs/testing/knowledge-base/TEST_SPEC.md
@../../docs/testing/knowledge-base/PITFALLS.md
@./docs/AGENT_PROTOCOL.md
@./docs/ARCHITECTURE.md
@./docs/CONFIGURATION.md

For broader development workflow and commands:
@./CLAUDE.md

Critical agent protocol rules for future work:

- Documentation boundary rule:
  - `docs/**`, repo/service `README.md`, and `CONTRIBUTING.md` are repository engineering docs for humans
  - `AGENTS.md` / `CLAUDE.md` are coding-agent collaboration docs for people or agents changing this repo
  - `.openagents/**`, archived agent prompts, copied skills, and runtime prompt/tool contracts are runtime-agent contracts consumed by OpenAgents itself
  - do not mix those layers when auditing "current project docs" unless the task explicitly asks to review runtime agent behavior
  - inside repo `docs/`, default current-doc layers are `architecture/`, `guides/`, and `testing/`; `plans/` and `history/` are supporting context only

- `lead_agent` is an explicit built-in agent and a reserved name.
- Missing runtime `agent_name` should normalize to `lead_agent`, not to a special `None` branch.
- `dev` and `prod` are archive versions only, not runtime mode switches.
- Runtime local vs sandbox selection belongs to Python startup/config only.
- Slash commands are workflow-routing primitives, not semantic parsers.
- Do not regex or heuristically infer `target_agent_name`, `target_skill_name`, or other authoring targets from natural-language user text in frontend, gateway, backend command resolution, or middleware.
- Only explicit structured UI selections may populate target identifiers outside the model, and only when the UI already knows that identifier from a dedicated field or picker rather than message-text parsing.
- Agent/object understanding belongs to the runtime model. Tool calls such as `setup_agent(...)` must carry explicit authoring targets instead of relying on inferred ambient runtime context.
- Outside the model, only syntax parsing, machine-readable payload parsing, explicit UI fields, tool arguments/results, and safety validation may drive runtime behavior.
- Do not inspect free-form user prose or assistant prose in middleware/helpers to infer domain mode, KB mode, next-step routing, question gating, or output policy.
- If runtime behavior needs a non-model decision, move that decision into an explicit structured field or tool/result contract instead of adding keyword tables, fuzzy matching, or regex heuristics.
- This repository's agent runtime is general-purpose. Do not keep patching one failing example by adding example-specific prompt text, one-off tools, or special-case middleware.
- When a scenario exposes a real product gap, prefer harness/runtime/tool-contract/eval changes that improve the generic agent path instead of embedding that scenario into prompts or tool wiring.
- Archived reusable skills now materialize from authored roots under `.openagents/system/skills/` and `.openagents/custom/skills/`.
- `.openagents/skills/store/{dev,prod}` is a legacy migration input only. Do not treat it as the canonical write target for new runtime or authoring work.
- Agent-owned copies live in `agents/{status}/{name}/skills/`.
- Agent-owned prompt lives in `agents/{status}/{name}/AGENTS.md`.
- `lead_agent` also uses `agents/{status}/lead_agent/AGENTS.md` and `agents/{status}/lead_agent/skills/` like every other agent.
- `lead_agent` does not implicitly read the full archived skills library anymore. Its default archived skill set is explicit and currently includes `bootstrap`.
- `1 thread = 1 agent/runtime binding`. Existing thread opens must restore the persisted binding; switching agent/archive/runtime must create a new thread instead of mutating the old one.
- The persisted runtime binding lives in Gateway `thread_bindings` and currently includes `agent_name`, `agent_status`, `model_name`, `execution_backend`, and `remote_session_id`.
- Thread-scoped read requests before the first run may carry explicit runtime identity headers (`x-model-name`, `x-agent-name`, `x-agent-status`, `x-execution-backend`, `x-remote-session-id`) to seed an unbound thread view. Treat them as request input only when no persisted binding exists; never let them override an existing `thread_bindings` row.
- Go/Gateway owns archive CRUD, publish, thread list/title/delete APIs, and local archive writes.
- Python runtime currently persists `thread_bindings` runtime bindings, owns backend selection, runtime seeding, and execution.
- Runtime must read from thread-local copies under `/mnt/user-data/...`, not directly mutate archived files.
- Agent-visible execution paths must stay on the unified virtual path contract under `/mnt/user-data/...`.
- Host filesystem paths such as `.openagents/...` or `/root/project/...` are backend implementation details and must never be hardcoded into skills, prompts, or agent-authored commands.
- All agents, including `lead_agent`, load skills from their thread-local copied runtime directory under `/mnt/user-data/agents/{status}/{name}/skills/`.
- 如果任务声称“对齐 opencode”，必须先检查本地参考仓库 `../opencode`（当前绝对路径 `/root/project/ai/opencode`），并明确范围到底是 slash command、command template、skill discovery，还是显式 `skill` 工具。
- 不要把 slash-command 对齐错误扩大成 runtime skill 全架构重写。
- OpenAgents 当前唯一 canonical skill 链路是：
  - archived skill 位于 `.openagents/system/skills/...` 或 `.openagents/custom/skills/...`
  - `setup_agent(..., skills=[{source_path: "..."}])` 负责 materialize 到 agent archive copied skills
  - `lead_agent` 的 copied skills 位于 `.openagents/system/agents/{status}/lead_agent/skills/...`
  - 自定义 agent 的 copied skills 位于 `.openagents/custom/agents/{status}/{name}/skills/...`
  - runtime prompt 只暴露 copied skill 的名称/描述/虚拟路径
  - 模型使用普通文件工具读取 `/mnt/user-data/agents/{status}/{name}/skills/.../SKILL.md`
- OpenAgents runtime 不再把 copied skills 接到 Deep Agents `skills=` / `SkillsMiddleware` / `skills_metadata` 上。不要把 Deep Agents 的通用库能力重新当成 OpenAgents runtime contract。
- `find-skills` 在 OpenAgents 里是发现策略 skill，不是新的 runtime skill 注入机制。
- `find-skills` 的固定策略是：先查本地 canonical archived library（`/mnt/skills/system/skills/...`、`/mnt/skills/custom/skills/...`）；`/mnt/skills/store/...` 只作为迁移期兼容输入。只有本地没有合适 skill，或用户明确要求安装外部 skill 时，才走 registry 搜索 / 安装。
- 如果 `find-skills` 找到的是本地 archived skill，最终仍然要通过 `setup_agent(..., skills=[{source_path: "..."}])` 完成装配，而不是靠额外 prompt glue 或前端推断。
- 以后审计“skill 是否生效”，优先检查 copied `SKILL.md` 是否 materialize、runtime prompt 是否暴露 attached skill、以及 trace 里模型是否真的读取了 copied `SKILL.md`；不要再把 `skills_metadata` 当成必要证据。
- Changing an archived authored skill does not retroactively mutate existing agent-owned copies already archived under `.openagents/system/agents/...` or `.openagents/custom/agents/...`. Refresh those copied skills only through an explicit agent update/materialization flow such as `setup_agent` or the agent update API.
- When a copied skill defines the user-visible review/report structure, keep the runtime prompt thin and let the skill remain the primary runtime contract. Do not mirror the whole skill into a second giant system-prompt summary.
- Inside SKILL docs, use relative-path guidance like `<current-skill-dir>` instead of hardcoding archived-library or host-specific roots.
- When an agent's core domain behavior comes from copied skills, keep its `AGENTS.md` thin. Do not restate the copied skill's full workflow, checklist, or output contract in `AGENTS.md`; that creates a second weaker runtime contract that can drift from the copied `SKILL.md`.
- Frontend/runtime defaults must not force planner-style execution (`is_plan_mode`) onto every agent turn. Non-`lead_agent` domain agents with copied skills should default to direct execution unless the UI explicitly opts into planner/todo behavior.
- If a domain skill must support different task shapes such as editable-file workflows and knowledge-base review workflows, define those modes in `SKILL.md` itself. Do not solve that by front-end guessing, regex parsing, or by teaching a second parallel workflow in `AGENTS.md`.
- When an archived agent config already contains `skill_refs[].source_path`, preserve and materialize that exact source path. Do not collapse explicit refs back to bare skill names, because authored roots may contain same-named skills.
- `LocalShellBackend` is for local debugging only and must preserve the same internal path contract as sandbox mode. If local mode needs special mapping, fix the backend mapping layer instead of changing skills to host paths.
- `BackendProtocol` and `SandboxBackendProtocol` are data-plane interfaces. `SandboxProvider` is a control-plane interface. Do not collapse sandbox lifecycle allocation back into data-plane runtime backends.
- `AioSandboxProvider` is not synonymous with single-machine sandbox mode. It is a managed sandbox provisioner that can drive local container sandboxes, provisioner-backed sandboxes, or externally managed sandbox endpoints.
- Comment discipline is mandatory for runtime/backend/sandbox work:
  - add concise comments/docstrings around non-obvious path rewriting, config precedence, thread binding restore/persist behavior, lifecycle caching/locking, and security/isolation assumptions
  - prefer comments that state invariants and operator-relevant intent, not comments that merely restate Python syntax
  - when touching a confusing code path, improve the surrounding comments in the same patch instead of leaving the next reader to reconstruct the execution model from logs alone
- Hard-cut rule for legacy behavior:
  - do not keep compatibility fallbacks for deprecated runtime, model, gateway, or knowledge-indexing paths once a canonical path has been chosen
  - remove old branches instead of silently falling back from database -> config, request -> thread binding, or new endpoint -> legacy subprocess behavior
  - if persisted stale values must be handled, migrate them in storage and then reject any remaining invalid values explicitly
- Open API should resolve `prod` agents only.
- `setup_agent` must use an explicit `agent_name` tool argument for `lead_agent`. Only a non-`lead_agent` dev runtime may omit `agent_name` to update itself.
- Do not re-introduce `skills_mode`, `soul`/`SOUL.md`, legacy agent directory fallbacks, or `exclude_groups`-style compatibility paths.
- Do not re-register `file:read`, `file:write`, or `bash` in app config. File access and shell execution come from deepagents `FilesystemMiddleware` only.
- Knowledge-base retrieval keeps the global tool registry stable. Do not solve KB behavior by dynamically removing unrelated tools from the model-visible list.
- Knowledge-base file assets now go through a dedicated Knowledge Asset Store. Treat KB `storage_ref` values as opaque refs; they may be local relative paths or `s3://...` object refs.
- `KNOWLEDGE_OBJECT_STORE` must be explicitly configured. Do not reintroduce an implicit filesystem default when the env is missing.
- Production/shared KB environments must use `minio`; explicit `filesystem` is only for local development/debugging.
- KB filesystem refs still resolve under `.openagents/knowledge/users/...`, and MinIO/S3 object keys normalize to `users/...` instead of `knowledge/users/...`.
- If filesystem-backed KB refs are being retired in an environment, migrate the stored `storage_ref` rows and document packages first, then reject remaining stale local refs explicitly.
- Knowledge Asset Store is application-domain storage, not a runtime backend. Do not mix it with `BackendProtocol`, `SandboxBackendProtocol`, or `SandboxProvider`.
- The primary agent-facing KB protocol is `list_knowledge_documents` -> `get_document_tree` -> `get_document_evidence`.
- `get_document_tree_node_detail` and `get_document_image` are compatibility tools only. Keep them working, but do not make new prompts or middleware depend on them as the primary flow.
- `get_document_tree` is a bounded window, not a full-tree dump. Root requests may downshift from the requested depth to a top-level overview and return `window_mode=root_overview` / `collapsed_root_overview=true`. Expand the returned `node_id` branches instead of retrying the whole root tree.
- KB tree traversal stays on the same rule everywhere: root overview first, then branch expansion by `node_id`, then grounded evidence. Do not reintroduce direct full-text retrieval as the default first step.
- KB knowledge guidance is prompt-first. Do not reintroduce hidden post-answer retries once visible streaming has started.
- Keep the global tool registry stable for knowledge turns. Do not reintroduce tool-call blocking heuristics for generic tools; prefer prompt guidance plus trace-based verification.
- Knowledge citations and visual evidence share the same contract: `kb://citation` targets source previews and `kb://asset` targets inline image assets plus the same preview location.
- Knowledge answers must be grounded from the current turn's KB evidence. Do not rely on earlier-turn citations without refreshing evidence again.

When extending the protocol, including dependency-style extensions:

- Add new agent-owned assets under `agents/{status}/{name}/...`.
- Materialize/copy them during create, update, and publish.
- Seed them into `/mnt/user-data/...` during Python runtime startup.
- Keep local and sandbox runtimes on the same virtual path contract.
- Do not put runtime backend choice into Go APIs, DB config, or agent manifests.
