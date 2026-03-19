Read these docs before changing agent/runtime/backend/skills behavior:
@../../docs/runtime-architecture.md
@./docs/AGENT_PROTOCOL.md
@./docs/ARCHITECTURE.md
@./docs/CONFIGURATION.md

For broader development workflow and commands:
@./CLAUDE.md

Critical agent protocol rules for future work:

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
- Go/Gateway owns CRUD, publish, DB persistence, and local archive writes.
- Python runtime owns backend selection, runtime seeding, and execution.
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
- Open API should resolve `prod` agents only.
- `setup_agent` must receive an explicit `target_agent_name` or `agent_name` in runtime context. Do not rely on a special bootstrap-only runtime branch.
- Do not re-introduce `skills_mode`, `soul`/`SOUL.md`, legacy agent directory fallbacks, or `exclude_groups`-style compatibility paths.
- Do not re-register `file:read`, `file:write`, or `bash` in app config. File access and shell execution come from deepagents `FilesystemMiddleware` only.

When extending the protocol, including dependency-style extensions:

- Add new agent-owned assets under `agents/{status}/{name}/...`.
- Materialize/copy them during create, update, and publish.
- Seed them into `/mnt/user-data/...` during Python runtime startup.
- Keep local and sandbox runtimes on the same virtual path contract.
- Do not put runtime backend choice into Go APIs, DB config, or agent manifests.
