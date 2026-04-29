# OpenAgents Agent-First Authoring Final Plan

> **Execution:** Use `executing-plans` to implement this plan task-by-task.

**Goal:** Move agent and skill authoring to a filesystem-first `.openagents` lifecycle with thread-local drafting, explicit save/push confirmation, and minimal command UX while keeping `deepagents` autonomous planning intact.

**Architecture:** Keep the current `deepagents` runtime model: each run assembles an agent, seeds archived files into the per-thread runtime, and lets `SkillsMiddleware` plus filesystem tools do the work. Add a controlled authoring lifecycle around that runtime: draft inside the thread, persist only through explicit save/push tools, and store all durable agent/skill assets under `.openagents`.

**Tech Stack:** Python runtime, `deepagents`, LangGraph middleware, Next.js frontend, filesystem archives

---

## 1. Current Runtime Facts

These points matter because the new design must fit the real execution path instead of fighting it.

- `backend/agents/src/agents/lead_agent/agent.py`
  - `create_deep_agent(...)` is the real runtime assembly point.
  - `deepagents` already provides `SkillsMiddleware` and filesystem tools.
  - OpenAgents only adds thread/uploads/title/image/artifacts middlewares.
- `backend/agents/src/config/agent_runtime_seed.py`
  - Archived `AGENTS.md`, `config.yaml`, and copied `skills/` are seeded into the thread runtime.
  - Seeding only uploads missing files, so thread-local edits survive later turns.
- `backend/agents/src/config/agent_materialization.py`
  - Current agent creation persists directly to the external archive and copies shared skills immediately.
- `backend/agents/src/config/runtime_db.py`
  - Agent runtime config is currently loaded from DB first, archive second.
  - This conflicts with the desired “agent definitions are files, not DB rows” direction.
- `backend/agents/src/agents/middlewares/thread_data_middleware.py`
  - Runtime already manages `workspace/`, `uploads/`, and `outputs/`.
  - There is no first-class `authoring/` path yet.

## 2. Final Product Rules

### 2.1 Durable source of truth

All durable agent and skill assets live under `.openagents`.

```text
.openagents/
  agents/
    dev/<agent>/
    prod/<agent>/
  skills/
    shared/<skill>/
    store/
      dev/<skill>/
      prod/<skill>/
  threads/
    <thread_id>/
      user-data/
        workspace/
        uploads/
        outputs/
        authoring/
          agents/<agent>/
          skills/<skill>/
  commands/
    common/
      create-agent.md
      create-skill.md
      save-agent-to-store.md
      save-skill-to-store.md
      push-agent-prod.md
      push-skill-prod.md
      promote-skill-shared.md
```

### 2.2 Runtime vs authoring vs archive

- `workspace/`
  - scratch area for arbitrary execution
- `agents/{status}/{agent}` under thread runtime
  - live runtime copy of an already materialized agent
  - useful for iterative dev-agent testing because `deepagents` reads skills from here
- `authoring/`
  - staging area for new agents/skills that are not yet part of the durable archive
- `.openagents/agents/*` and `.openagents/skills/*`
  - durable archives only

### 2.3 Commands are not the workflow engine

Slash commands should be thin entry points, not hidden orchestration.

- `/create-agent`
  - convenience trigger for “start agent authoring”
  - forwards a normalized user intent to the agent
  - does not grant persistence by itself
- `/create-skill`
  - convenience trigger for “start skill authoring”
  - does not grant persistence by itself
- `/save-*`, `/push-*`, `/promote-*`
  - explicit authorization for durable filesystem mutation

The model still plans autonomously. Commands only:

- reduce ambiguity
- provide a clean UI affordance
- authorize risky persistence operations

### 2.4 Do not rely on prompt-only enforcement

Prompt text may explain available directories and confirmation rules, but actual safety must be enforced by runtime context and tool visibility.

## 3. Storage And Reference Model

### 3.1 Keep `skill_refs`, but generalize `source_path`

`config.yaml` remains the agent description file, and `skill_refs` still decides what gets copied into runtime.

Recommended change:

- stop treating skills as only `public` or `custom`
- store `skill_refs[].source_path` as a relative path inside `.openagents/skills`

Examples:

```yaml
skill_refs:
  - name: bootstrap
    source_path: shared/bootstrap
  - name: contract-risk-rating
    source_path: store/prod/contract-risk-rating
```

This is simpler than keeping a fixed `category` enum and matches the new directory model.

### 3.2 Agent-owned skills stay private after copy

Once a skill is copied into `.openagents/agents/{status}/{agent}/skills/...`, it is that agent’s private implementation.

No global DB row is needed.

## 4. Accurate Runtime Flow

### 4.1 Agent run assembly

```text
user message
  |
  v
frontend sends thread_id + agent_name + model + context
  |
  v
lead_agent.make_lead_agent()
  |
  | resolve model / agent config
  | build backend
  | seed runtime files into /mnt/user-data/agents/{status}/{agent}
  | set skills source to runtime /agents/{status}/{agent}/skills
  v
create_deep_agent(...)
  |
  | deepagents SkillsMiddleware loads SKILL.md from runtime copy
  | deepagents filesystem tools operate inside /mnt/user-data
  v
agent autonomously reads/writes/tests
```

### 4.2 New skill authoring

```text
User: /create-skill 做一个合同风险分级 skill
  |
  v
frontend resolves command template + attaches command metadata
  |
  v
agent decides:
  - inspect current skills
  - use skill-creator
  - use find-skills
  - search web if useful
  - validate with runtime tools
  |
  v
/mnt/user-data/authoring/skills/contract-risk-rating/
  SKILL.md
  scripts/
  references/
  tests/
  |
  v
User: /save-skill-to-store
  |
  v
save_skill_to_store tool copies authoring draft
  ->
.openagents/skills/store/dev/contract-risk-rating/
  |
  v
User: /push-skill-prod
  |
  v
.openagents/skills/store/prod/contract-risk-rating/
  |
  v
optional /promote-skill-shared
  |
  v
.openagents/skills/shared/contract-risk-rating/
```

### 4.3 New agent authoring

```text
User: /create-agent 我想创建个合同审查智能体
  |
  v
agent checks available bootstrap/shared/store skills
  |
  | bootstrap handles clarification
  | decide whether to reuse skill / find skill / create skill
  v
/mnt/user-data/authoring/agents/contract-review/
  AGENTS.md
  config.yaml
  skills/
  |
  v
User: /save-agent-to-store
  |
  v
save_agent_to_store tool copies draft
  ->
.openagents/agents/dev/contract-review/
  |
  v
frontend opens existing unified chat page with:
  agent_name=contract-review
  agent_status=dev
  |
  v
agent iterates inside thread runtime copy
  |
  v
User: /push-agent-prod
  |
  v
.openagents/agents/prod/contract-review/
```

### 4.4 Dev self-optimization loop

```text
dev agent test chat
  |
  v
runtime copy seeded to /mnt/user-data/agents/dev/<agent>
  |
  | agent inspects bad answer
  | agent edits AGENTS.md or agent-owned skills in runtime copy
  | user retests in same thread
  v
when satisfied:
  /save-agent-to-store
  |
  v
runtime copy -> .openagents/agents/dev/<agent>
```

This loop is important because it reuses the existing seeded runtime instead of inventing a generic sync system.

## 5. Command Model

### 5.1 Two command classes

Use two command classes.

- Soft commands
  - `/create-agent`
  - `/create-skill`
  - `/improve-agent`
  - `/improve-skill`
  - these normalize intent only
- Hard commands
  - `/save-agent-to-store`
  - `/save-skill-to-store`
  - `/push-agent-prod`
  - `/push-skill-prod`
  - `/promote-skill-shared`
  - these authorize durable mutation

### 5.2 Recommended command registry schema

Store registry files under `.openagents/commands/common/`.

Recommended fields:

```yaml
name: create-skill
kind: soft
description: Start drafting a reusable skill in the current thread.
prompt_template: |
  You are starting a skill authoring task.
  User request:
  {{user_text}}
suggested_agent_status: dev
```

```yaml
name: save-agent-to-store
kind: hard
description: Persist the current drafted or runtime-edited agent into .openagents/agents/dev.
allowed_action: save_agent_to_store
```

### 5.3 Frontend behavior

When the user types `/...`:

- show smart suggestions in the input box
- resolve the command from the registry
- send:
  - original user text
  - command name
  - command kind
  - allowed action if any
  - normalized prompt text if the command defines one

Important:

- the frontend may prepend or replace text for convenience
- but authorization must be carried as structured metadata, not only as text

## 6. Tool Gating Recommendation

### 6.1 Keep prod clean

Prod agents must not receive persistence/promotion tools.

### 6.2 Do not inject every authoring tool on every run

The user is correct that too many tools increases model burden.

Recommended rule:

- normal chat run
  - no save/push/promote tools visible
- dev run + matching hard command
  - inject only the one or few authorized persistence tools for that turn

### 6.3 Best injection point

Because tools are passed into `create_deep_agent(...)` before middleware executes, the best implementation point is runtime assembly in:

- `backend/agents/src/agents/lead_agent/agent.py`
- `backend/agents/src/tools/tools.py`

Middleware can still help attach command context, but final tool filtering should happen before agent construction so the model never sees irrelevant tools.

## 7. New Persistence Tools

### 7.1 Skill persistence tools

- `save_skill_to_store`
  - source: `/mnt/user-data/authoring/skills/<skill>` or explicit runtime draft path
  - target: `.openagents/skills/store/dev/<skill>`
  - validate required files before copy
  - create timestamped backup when overwriting
- `push_skill_prod`
  - source: `.openagents/skills/store/dev/<skill>`
  - target: `.openagents/skills/store/prod/<skill>`
- `promote_skill_shared`
  - source: `.openagents/skills/store/prod/<skill>`
  - target: `.openagents/skills/shared/<skill>`

### 7.2 Agent persistence tools

- `save_agent_to_store`
  - source:
    - `/mnt/user-data/authoring/agents/<agent>` for new agents
    - or `/mnt/user-data/agents/dev/<agent>` for iterative dev edits
  - target: `.openagents/agents/dev/<agent>`
  - validate `AGENTS.md` and `config.yaml`
  - validate each `skill_ref`
  - create timestamped backup when overwriting
- `push_agent_prod`
  - source: `.openagents/agents/dev/<agent>`
  - target: `.openagents/agents/prod/<agent>`

### 7.3 No generic sync tool

Do not add a generic bidirectional `sync_tool`.

Explicit save/push/promote actions are safer, simpler, and match the actual lifecycle.

## 8. Minimal Prompt Changes

Only add neutral environment facts to the system prompt.

Allowed:

- draft authoring path exists under `/mnt/user-data/authoring`
- persistence needs explicit confirmation

Do not encode rigid workflow like:

- always use tool A before tool B
- always ask question X first
- always create skill before agent

That logic belongs to the model plus skills such as `bootstrap`, `find-skills`, and `skill-creator`.

## 9. Implementation Tasks

### Task 1: Normalize `.openagents` storage and skill addressing

**Files:**
- Modify: `backend/agents/src/config/paths.py`
- Modify: `backend/agents/src/config/skills_config.py`
- Modify: `backend/agents/src/skills/loader.py`
- Modify: `backend/agents/src/config/agents_config.py`
- Modify: `backend/agents/src/config/agent_materialization.py`
- Modify: `backend/agents/src/config/agent_runtime_seed.py`
- Test: `backend/agents/tests/test_skills_loader.py`
- Test: `backend/agents/tests/test_lead_agent_backend.py`
- Create: `backend/agents/tests/test_agent_materialization_paths.py`

**Step 1: Write the failing tests**

- Cover `.openagents/skills/shared`
- Cover `.openagents/skills/store/dev`
- Cover `.openagents/skills/store/prod`
- Cover `skill_refs[].source_path` using generalized relative paths

**Step 2: Run test to verify it fails**

Run: `pytest backend/agents/tests/test_skills_loader.py backend/agents/tests/test_lead_agent_backend.py backend/agents/tests/test_agent_materialization_paths.py -v`

**Step 3: Write minimal implementation**

- add new path helpers
- generalize skill scanning and source path parsing
- keep runtime seed behavior unchanged except for new path semantics

**Step 4: Run test to verify it passes**

Run: `pytest backend/agents/tests/test_skills_loader.py backend/agents/tests/test_lead_agent_backend.py backend/agents/tests/test_agent_materialization_paths.py -v`

**Step 5: Commit**

```bash
git add backend/agents/src/config/paths.py backend/agents/src/config/skills_config.py backend/agents/src/skills/loader.py backend/agents/src/config/agents_config.py backend/agents/src/config/agent_materialization.py backend/agents/src/config/agent_runtime_seed.py backend/agents/tests/test_skills_loader.py backend/agents/tests/test_lead_agent_backend.py backend/agents/tests/test_agent_materialization_paths.py
git commit -m "feat: move skills and agent refs to openagents storage"
```

### Task 2: Make agent definition loading file-first and add authoring paths

**Files:**
- Modify: `backend/agents/src/agents/lead_agent/agent.py`
- Modify: `backend/agents/src/agents/middlewares/thread_data_middleware.py`
- Modify: `backend/agents/src/config/runtime_db.py`
- Modify: `backend/agents/src/agents/lead_agent/prompt.py`
- Test: `backend/agents/tests/test_thread_data_middleware.py`
- Test: `backend/agents/tests/test_lead_agent_model_resolution.py`
- Create: `backend/agents/tests/test_agent_config_resolution.py`

**Step 1: Write the failing tests**

- file archive is preferred for agent definition loading
- DB is used only for runtime data and models
- thread metadata includes `authoring` paths

**Step 2: Run test to verify it fails**

Run: `pytest backend/agents/tests/test_thread_data_middleware.py backend/agents/tests/test_lead_agent_model_resolution.py backend/agents/tests/test_agent_config_resolution.py -v`

**Step 3: Write minimal implementation**

- move agent definition lookup to filesystem-first or filesystem-only
- extend thread data with `authoring_path`, `authoring_agents_path`, `authoring_skills_path`
- add only neutral prompt text for the authoring path

**Step 4: Run test to verify it passes**

Run: `pytest backend/agents/tests/test_thread_data_middleware.py backend/agents/tests/test_lead_agent_model_resolution.py backend/agents/tests/test_agent_config_resolution.py -v`

**Step 5: Commit**

```bash
git add backend/agents/src/agents/lead_agent/agent.py backend/agents/src/agents/middlewares/thread_data_middleware.py backend/agents/src/config/runtime_db.py backend/agents/src/agents/lead_agent/prompt.py backend/agents/tests/test_thread_data_middleware.py backend/agents/tests/test_lead_agent_model_resolution.py backend/agents/tests/test_agent_config_resolution.py
git commit -m "feat: add authoring paths and file-first agent loading"
```

### Task 3: Add explicit persistence tools

**Files:**
- Create: `backend/agents/src/tools/builtins/save_agent_to_store_tool.py`
- Create: `backend/agents/src/tools/builtins/save_skill_to_store_tool.py`
- Create: `backend/agents/src/tools/builtins/push_agent_prod_tool.py`
- Create: `backend/agents/src/tools/builtins/push_skill_prod_tool.py`
- Create: `backend/agents/src/tools/builtins/promote_skill_shared_tool.py`
- Modify: `backend/agents/src/tools/builtins/__init__.py`
- Modify: `backend/agents/src/tools/tools.py`
- Create: `backend/agents/tests/test_authoring_persistence_tools.py`

**Step 1: Write the failing tests**

- save from authoring draft to dev store
- save from runtime dev copy to dev store
- overwrite creates backup
- invalid manifest is rejected
- prod promotion is blocked without source existence

**Step 2: Run test to verify it fails**

Run: `pytest backend/agents/tests/test_authoring_persistence_tools.py -v`

**Step 3: Write minimal implementation**

- add explicit copy/validate/backup tools
- avoid delete-sync semantics
- keep each tool single-purpose

**Step 4: Run test to verify it passes**

Run: `pytest backend/agents/tests/test_authoring_persistence_tools.py -v`

**Step 5: Commit**

```bash
git add backend/agents/src/tools/builtins/save_agent_to_store_tool.py backend/agents/src/tools/builtins/save_skill_to_store_tool.py backend/agents/src/tools/builtins/push_agent_prod_tool.py backend/agents/src/tools/builtins/push_skill_prod_tool.py backend/agents/src/tools/builtins/promote_skill_shared_tool.py backend/agents/src/tools/builtins/__init__.py backend/agents/src/tools/tools.py backend/agents/tests/test_authoring_persistence_tools.py
git commit -m "feat: add explicit authoring persistence tools"
```

### Task 4: Add command registry and per-turn tool authorization

**Files:**
- Create: `.openagents/commands/common/create-agent.md`
- Create: `.openagents/commands/common/create-skill.md`
- Create: `.openagents/commands/common/save-agent-to-store.md`
- Create: `.openagents/commands/common/save-skill-to-store.md`
- Create: `.openagents/commands/common/push-agent-prod.md`
- Create: `.openagents/commands/common/push-skill-prod.md`
- Create: `.openagents/commands/common/promote-skill-shared.md`
- Modify: `frontend/app/src/components/workspace/input-box.tsx`
- Modify: `frontend/app/src/components/ai-elements/prompt-input.tsx`
- Modify: `frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx`
- Create: `frontend/app/src/core/commands/index.ts`
- Create: `frontend/app/src/core/commands/types.ts`
- Create: `frontend/app/src/core/commands/transform.ts`

**Step 1: Write the failing tests**

- slash command suggestion
- slash command parsing
- prompt normalization for soft commands
- command metadata emission for hard commands

**Step 2: Run test to verify it fails**

Run: `pnpm --filter app test`

**Step 3: Write minimal implementation**

- add registry loader
- add input suggestions
- attach structured command intent to outgoing requests
- do not build a separate workflow engine in the frontend

**Step 4: Run test to verify it passes**

Run: `pnpm --filter app test`

**Step 5: Commit**

```bash
git add .openagents/commands/common frontend/app/src/components/workspace/input-box.tsx frontend/app/src/components/ai-elements/prompt-input.tsx frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx frontend/app/src/core/commands/index.ts frontend/app/src/core/commands/types.ts frontend/app/src/core/commands/transform.ts
git commit -m "feat: add slash command registry and authoring intents"
```

### Task 5: Gate authoring tools by dev mode and command intent

**Files:**
- Modify: `backend/agents/src/agents/lead_agent/agent.py`
- Modify: `backend/agents/src/tools/tools.py`
- Create: `backend/agents/tests/test_authoring_tool_gating.py`

**Step 1: Write the failing tests**

- prod runs never see persistence tools
- dev runs without hard command never see persistence tools
- dev runs with `save-agent-to-store` only see the matching save tool

**Step 2: Run test to verify it fails**

Run: `pytest backend/agents/tests/test_authoring_tool_gating.py -v`

**Step 3: Write minimal implementation**

- read command intent from request config
- filter tools before `create_deep_agent(...)`
- keep runtime tool surface minimal

**Step 4: Run test to verify it passes**

Run: `pytest backend/agents/tests/test_authoring_tool_gating.py -v`

**Step 5: Commit**

```bash
git add backend/agents/src/agents/lead_agent/agent.py backend/agents/src/tools/tools.py backend/agents/tests/test_authoring_tool_gating.py
git commit -m "feat: gate authoring tools by mode and command"
```

## 10. Practical Recommendations

- Prefer runtime assembly gating over middleware-only tool injection, because middleware runs after tool lists are already chosen.
- Reuse the existing unified chat page for dev-agent testing; only add status/context handling, not a separate testing product first.
- Keep command files and agent/skill packages editable as normal files so VS Code remains the fallback.
- Do not over-automate promotion into `shared`; keep that as an explicit, rarer action.

## 11. Final Decision Summary

- Put all durable skills under `.openagents/skills`.
- Keep `config.yaml` and `skill_refs`.
- Let the model plan freely with `bootstrap`, `find-skills`, and `skill-creator`.
- Use slash commands only as explicit user confirmation and UX shortcuts.
- Persist through explicit tools, not a generic sync mechanism.
- Filter persistence tools per turn so the model does not carry unnecessary tool burden.

Plan complete and saved to `memory/archive/plans/2026-03-11-openagents-agent-first-authoring-final.md`. Two execution options:

**1. Continue Here (this session)** - Execute tasks in order here, with review checkpoints as needed

**2. Parallel Session (separate)** - Open a new session with `executing-plans` for batched execution and checkpoints

**Which approach?**
