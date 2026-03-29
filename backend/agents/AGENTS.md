Read these docs before changing agent/runtime/backend/skills behavior:
@../../docs/guides/documentation-boundaries.md
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
- Shared skills live in `.openagents/skills/{shared,store/dev,store/prod}/`.
- `.openagents/skills/` is the only maintained shared skill source. Do not recreate or rely on a repo-side `skills/public` mirror.
- Agent-owned copies live in `agents/{status}/{name}/skills/`.
- Agent-owned prompt lives in `agents/{status}/{name}/AGENTS.md`.
- `lead_agent` also uses `agents/{status}/lead_agent/AGENTS.md` and `agents/{status}/lead_agent/skills/` like every other agent.
- `lead_agent` does not implicitly read the full shared skills archive anymore. Its default archived skill set is explicit and currently includes `bootstrap`.
- `1 thread = 1 agent/runtime binding`. Existing thread opens must restore the persisted binding; switching agent/archive/runtime must create a new thread instead of mutating the old one.
- The persisted runtime binding lives in Gateway `thread_bindings` and currently includes `agent_name`, `agent_status`, `model_name`, `execution_backend`, and `remote_session_id`.
- Thread-scoped read requests before the first run may carry explicit runtime identity headers (`x-model-name`, `x-agent-name`, `x-agent-status`, `x-execution-backend`, `x-remote-session-id`) to seed an unbound thread view. Treat them as request input only when no persisted binding exists; never let them override an existing `thread_bindings` row.
- Go/Gateway owns archive CRUD, publish, thread list/title/delete APIs, and local archive writes.
- Python runtime currently persists `thread_bindings` runtime bindings, owns backend selection, runtime seeding, and execution.
- Runtime must read from thread-local copies under `/mnt/user-data/...`, not directly mutate archived files.
- Agent-visible execution paths must stay on the unified virtual path contract under `/mnt/user-data/...`.
- Host filesystem paths such as `.openagents/...` or `/root/project/...` are backend implementation details and must never be hardcoded into skills, prompts, or agent-authored commands.
- All agents, including `lead_agent`, load skills from their thread-local copied runtime directory under `/mnt/user-data/agents/{status}/{name}/skills/`.
- `SkillsMiddleware` is the correct layer for skill path semantics. The `{skills_locations}` prompt block must list runtime-visible backend paths such as `/mnt/user-data/agents/{status}/{name}/skills/`, not archive paths or host paths.
- SKILL bodies should assume the model already knows each skill's runtime `SKILL.md` location from `SkillsMiddleware`. Inside SKILL docs, use relative-path guidance like `<current-skill-dir>` instead of hardcoding shared-archive or host-specific roots.
- When an archived agent config already contains `skill_refs[].source_path`, preserve and materialize that exact source path. Do not collapse explicit refs back to bare skill names, because shared/store scopes may contain same-named skills.
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
- `setup_agent` must receive an explicit `target_agent_name` or `agent_name` in runtime context. Do not rely on a special bootstrap-only runtime branch.
- Do not re-introduce `skills_mode`, `soul`/`SOUL.md`, legacy agent directory fallbacks, or `exclude_groups`-style compatibility paths.
- Do not re-register `file:read`, `file:write`, or `bash` in app config. File access and shell execution come from deepagents `FilesystemMiddleware` only.
- Knowledge-base retrieval keeps the global tool registry stable. Do not solve KB behavior by dynamically removing unrelated tools from the model-visible list.
- Knowledge-base file assets now go through a dedicated Knowledge Asset Store. Treat KB `storage_ref` values as opaque refs; they may be local relative paths or `s3://...` object refs.
- KB filesystem refs still resolve under `.openagents/knowledge/users/...`, but MinIO/S3 object keys should normalize to `users/...` instead of `knowledge/users/...`. Legacy `s3://.../knowledge/users/...` refs must remain readable for compatibility.
- Knowledge Asset Store is application-domain storage, not a runtime backend. Do not mix it with `BackendProtocol`, `SandboxBackendProtocol`, or `SandboxProvider`.
- The primary agent-facing KB protocol is `list_knowledge_documents` -> `get_document_tree` -> `get_document_evidence`.
- `get_document_tree_node_detail` and `get_document_image` are compatibility tools only. Keep them working, but do not make new prompts or middleware depend on them as the primary flow.
- `get_document_tree` is a bounded window, not a full-tree dump. Root requests may downshift from the requested depth to a top-level overview and return `window_mode=root_overview` / `collapsed_root_overview=true`. Expand the returned `node_id` branches instead of retrying the whole root tree.
- KB tree traversal stays on the same rule everywhere: root overview first, then branch expansion by `node_id`, then grounded evidence. Do not reintroduce direct full-text retrieval as the default first step.
- KB response recovery is multi-round. If the model answers an attached-document question without current-turn evidence or exact citations, middleware may keep retrying until the response is grounded or the recovery cap is hit. Do not assume a single retry pass.
- KB enforcement happens at prompt + middleware + tool-call blocking layers. Do not reintroduce model-visible tool filtering helpers for attached-document turns.
- Knowledge citations and visual evidence share the same contract: `kb://citation` targets source previews and `kb://asset` targets inline image assets plus the same preview location.
- Knowledge answers must be grounded from the current turn's KB evidence. Do not rely on earlier-turn citations without refreshing evidence again.

When extending the protocol, including dependency-style extensions:

- Add new agent-owned assets under `agents/{status}/{name}/...`.
- Materialize/copy them during create, update, and publish.
- Seed them into `/mnt/user-data/...` during Python runtime startup.
- Keep local and sandbox runtimes on the same virtual path contract.
- Do not put runtime backend choice into Go APIs, DB config, or agent manifests.
