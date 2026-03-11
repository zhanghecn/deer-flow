# Agent-First Authoring And Persistence Plan

> **Execution:** Use `executing-plans` to implement this plan task-by-task.

**Goal:** Turn agent and skill authoring into an agent-first, one-dialog workflow while keeping runtime isolation, filesystem portability, and optional manual editing.

**Architecture:** Use the local filesystem as the single source of truth for agent definitions and skill packages. Keep thread runtime isolated and disposable, and introduce explicit persistence/promote tools instead of a generic bidirectional sync mechanism.

**Tech Stack:** Python runtime, Go gateway, local filesystem archives, sandbox runtime, Next.js frontend

---

## 1. Product Direction

### 1.1 Product principles

- External experience must be a single dialog entry.
- The lead agent should decide when to create agents, search/install skills, test, persist, and publish.
- Human manual editing is fallback only, not the primary path.
- `AGENTS.md` plus skills are the core composition model for professional agents.
- The large model is only the engine; the agent system must own execution, persistence, and release flow.
- Portability is a first-class requirement: an agent should be exportable/importable as plain files.

### 1.2 Source of truth

The source of truth should be filesystem, not database:

```text
skills/
  shared-dev/      # or compatibility-mapped from current custom/
  shared-prod/     # or compatibility-mapped from current public/

.openagents/agents/
  dev/<agent>/
  prod/<agent>/
```

Database should remain only for operational metadata:

- auth/users
- threads
- runtime bindings
- observability
- models
- optional indexes/cache

Database should not be the source of truth for:

- agent definitions
- `AGENTS.md`
- agent-owned skills
- shared skill package contents

## 2. Core Objects

### 2.1 Shared skills

Shared skills are reusable packages available to many agents.

Lifecycle:

```text
shared-dev -> test -> publish -> shared-prod
```

Intent:

- default copy source for new agents
- reusable ecosystem entry point
- suitable target for `find-skills` and skill store installs

### 2.2 Agent-owned skills

Once a skill is copied into an agent, it becomes agent-private and may be modified freely.

Intent:

- no global registration required
- can diverge from shared source without affecting others
- shipped together with the agent during export/import

Recommended layout:

```text
.openagents/agents/{status}/{agent}/
  AGENTS.md
  config.yaml
  skills/
    <skill-a>/
    <skill-b>/
```

Important decision:

- Do not distinguish “copied shared skill” and “private skill” after copy.
- Copy means ownership transfer into the agent package.

This is the simplification that best matches your product direction.

### 2.3 Thread runtime

Runtime thread data remains isolated:

```text
.openagents/threads/{thread_id}/user-data/
  workspace/
  uploads/
  outputs/
  agents/
```

Runtime copy is disposable unless explicitly persisted.

## 3. Key Architectural Decision

### 3.1 Do not build a generic `sync_tool`

A generic bidirectional `sync_tool` sounds flexible but is the wrong primitive.

Problems:

- direction is ambiguous
- delete semantics are dangerous
- merge/conflict behavior is unclear
- agent may accidentally persist runtime garbage
- debugging becomes hard because “what changed where” is opaque

### 3.2 Build explicit persistence tools instead

Use narrow, intention-revealing tools:

- `save_agent_definition`
- `install_shared_skill`
- `copy_shared_skill_to_agent`
- `save_agent_skill`
- `publish_agent`
- `publish_shared_skill`
- `export_agent_package`
- `import_agent_package`

Principle:

- runtime is for working
- archive is for persistence
- promotion is for release

No hidden sync.

## 4. Required User Flows

### 4.1 One-dialog agent creation

User says one sentence, for example:

- “帮我创建一个医疗政策研究智能体”
- “做一个销售陪练 agent”

Expected system behavior:

1. Lead agent clarifies only when necessary.
2. Lead agent creates or updates `AGENTS.md`.
3. Lead agent selects useful shared skills by default.
4. Lead agent copies chosen skills into `agents/dev/<agent>/skills/`.
5. Lead agent runs smoke tests.
6. Lead agent reports completion.

### 4.2 Shared skill acquisition

User says one sentence, for example:

- “给系统增加一个 PR review skill”
- “找一个可安装的 excel 数据清洗 skill”

Expected system behavior:

1. Lead agent delegates to hidden skill curator logic.
2. It may use:
   - `find-skills`
   - skill store
   - manual packaging/import
   - `skill-creator`
3. The result is persisted into `shared-dev`.
4. The system runs validation and test install.
5. If accepted, agent calls `publish_shared_skill` into `shared-prod`.

### 4.3 Agent-owned skill creation or modification

User says one sentence, for example:

- “给法务 agent 增加一个合同红线审查 skill”
- “把这个 agent 里的 research skill 改成只看英文来源”

Expected system behavior:

1. Agent creates or edits the skill under `agents/dev/<agent>/skills/<skill>/`.
2. Agent tests in that agent’s own dev runtime.
3. Agent persists explicitly.
4. When ready, agent calls `publish_agent`.

### 4.4 Import external `.skill` from runtime artifacts

This is the current isolation problem you identified.

Actual need is not “sync runtime to external” in general.

Actual need is:

- take a concrete artifact in thread runtime
- validate it
- persist it to a declared archive target

Therefore the correct tool is:

```text
install_shared_skill(source_runtime_path, target=shared-dev)
```

or:

```text
install_agent_skill(source_runtime_path, agent_name, target=dev)
```

This is explicit persistence, not sync.

## 5. Recommended Tool Model

### 5.1 Shared skill tools

- `create_shared_skill`
  - create a new shared-dev skill package from text/spec
- `install_shared_skill`
  - persist a `.skill` archive or folder into shared-dev
- `validate_shared_skill`
  - run frontmatter/structure/smoke checks
- `publish_shared_skill`
  - shared-dev -> shared-prod

### 5.2 Agent tools

- `setup_agent`
  - keep for creating `AGENTS.md` and base manifest
- `copy_shared_skill_to_agent`
  - copy one or more shared-prod/shared-dev skills into `agents/dev/<agent>/skills/`
- `save_agent_skill`
  - persist a generated/edited skill into `agents/dev/<agent>/skills/<skill>/`
- `publish_agent`
  - `agents/dev/<agent>` -> `agents/prod/<agent>`

### 5.3 Import/export tools

- `export_agent_package`
  - package full agent directory
- `import_agent_package`
  - unpack full agent directory into dev

### 5.4 Test tools

- `smoke_test_agent`
- `smoke_test_skill`
- `validate_skill_package`

Testing must be agent-callable, not a manual-only backend feature.

## 6. Persistence Semantics

### 6.1 Runtime edits are temporary

Any file created under thread runtime is temporary by default.

This includes:

- downloaded `.skill`
- generated `AGENTS.md`
- temporary skill drafts
- test outputs

### 6.2 Persistence is an explicit commit

To survive beyond the thread, the agent must call a persistence tool.

Examples:

- generated `AGENTS.md` -> `save_agent_definition`
- downloaded `.skill` -> `install_shared_skill`
- created agent-only skill -> `save_agent_skill`

This is the clean replacement for a broad sync design.

### 6.3 Publish is a release action

Publish should stay separate from save.

Examples:

- save shared skill into `shared-dev`
- publish shared skill into `shared-prod`
- save agent files into `agents/dev/<agent>`
- publish agent into `agents/prod/<agent>`

## 7. Manual Editing Fallback

### 7.1 Manual editing requirement

Manual editing must remain possible by directly editing files in VS Code.

This means all important assets must stay as normal files:

- `AGENTS.md`
- `config.yaml`
- `skills/*/SKILL.md`
- bundled scripts/references/assets

### 7.2 Browser editor requirement

If browser editing is added, it should be scope-limited.

Do not open the full repository by default.

Allowed scopes:

- shared skill workspace only
- one agent dev directory only
- one exported package temp directory only

Recommended examples:

- edit shared skill:
  - root = `skills/shared-dev/<skill>`
- edit agent:
  - root = `.openagents/agents/dev/<agent>`

This keeps manual editing safe without complex ACL design.

## 8. Single-Dialog UX Model

Externally there is only one dialog.

Internally the lead agent may delegate to hidden specialist roles such as:

- skill curator
- agent builder
- package validator
- release manager

But these are implementation details.

User-facing rule:

- user should not need to choose between tools, file modes, or sync modes
- user states intent
- agent plans and executes
- system exposes manual edit only as fallback

## 9. Concrete Flow Recommendations

### 9.1 Shared skill adding flow

Recommended flow:

1. User asks in main dialog.
2. Lead agent decides whether to:
   - search with `find-skills`
   - create with `skill-creator`
   - import from store/archive
3. Persist to `shared-dev`.
4. Validate and smoke test.
5. If accepted, call `publish_shared_skill`.

This can be implemented by a hidden “shared skill curator” agent or by lead agent plus tools.

### 9.2 Agent-specific skill adding flow

Recommended flow:

1. User asks in main dialog while targeting a specific agent.
2. Lead agent edits or creates skill under `agents/dev/<agent>/skills/`.
3. Agent tests the skill in dev mode.
4. Agent persists explicitly.
5. Agent calls `publish_agent` when ready.

### 9.3 Agent definition flow

Recommended flow:

1. User asks for a new professional agent.
2. System generates `AGENTS.md`.
3. System copies default shared skills as starter kit.
4. System customizes copied skills as needed.
5. System runs smoke tests.
6. System persists to dev.
7. System publishes to prod on request or policy.

## 10. What To Change In Current System

### 10.1 Remove DB ownership of agent definitions

Current direction stores agent/skill metadata in PostgreSQL.

Target direction:

- filesystem is source of truth
- database only caches or indexes if needed

This means:

- agent CRUD should operate on archive directories first
- import/export should be filesystem-native
- DB dependency should not block agent portability

### 10.2 Reframe current skill install

Current install path writes global skills from a thread artifact into shared storage.

That is already close to the right idea.

What is missing is:

- target scope selection
- agent-owned install path
- explicit save/publish semantics

### 10.3 Expand built-in tools

Current built-in authoring tool is mainly `setup_agent`.

Needed next:

- shared skill persistence tools
- agent skill persistence tools
- publish tools
- validation tools

## 11. Minimal Viable Implementation Order

### Phase 1: Correct persistence model

- Keep runtime/archive isolation
- Add explicit save/install/publish tools
- Do not build generic sync

### Phase 2: Filesystem-first definitions

- Make filesystem the source of truth for agent and skill packages
- Downgrade DB to metadata/index role

### Phase 3: One-dialog automation

- Lead agent orchestrates all authoring flows
- Hidden specialist agents are optional internals

### Phase 4: Manual fallback UX

- Add scoped browser editor
- Open only a bounded directory

## 12. Final Recommendation

Your idea should be normalized into this rule set:

- Shared skills are reusable packages in shared archive.
- Once copied into an agent, the skill is private and freely editable.
- Thread runtime stays isolated and temporary.
- Nothing leaves runtime unless an explicit persistence tool commits it.
- Do not build a generic `sync_tool`; build explicit save/install/publish tools.
- Keep only one dialog in the product surface; all complexity stays behind the agent.

## Acceptance Criteria

- A user can create a new professional agent with one sentence.
- A user can add a shared skill with one sentence.
- A user can add or modify an agent-owned skill with one sentence.
- The agent can import a `.skill` generated or downloaded in runtime and persist it intentionally.
- Manual editing remains possible through normal files and optionally a scoped web editor.
- Agent packages remain portable without relying on database state.
