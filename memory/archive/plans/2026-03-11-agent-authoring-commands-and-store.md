# Agent Authoring Commands And Store Plan

> **Execution:** Use `executing-plans` to implement this plan task-by-task.

**Goal:** Let agents autonomously create and refine agents/skills in runtime, but require explicit user slash-command confirmation before anything is persisted to `dev` or promoted to `prod`.

**Architecture:** Runtime remains fully autonomous and isolated. Agents draft into staging space, users confirm via `/...` commands, and only then do controlled tools persist to filesystem stores. Skill creation and agent creation use separate lifecycles.

**Tech Stack:** Python runtime, deepagents, Go gateway, Next.js frontend, filesystem archive

---

## 1. Product Rules

### 1.1 Natural language does not persist

Normal chat should allow the agent to:

- inspect existing skills
- use `bootstrap`
- use `find-skills`
- use `skill-creator`
- search the web
- generate and revise drafts
- test and iterate

But normal chat should **not** directly mutate the external archive.

### 1.2 Slash commands are explicit confirmation

Persistence and release should happen only when the user issues a slash command.

Examples:

- `/save_skill_to_store`
- `/save_agent_to_store`
- `/push_agent_prod`
- `/push_skill_prod`
- `/promote_skill_shared`

This solves the “when should runtime sync out?” problem cleanly:

- runtime autonomy stays high
- destructive persistence stays explicit

### 1.3 Skill and agent creation should be separated

This should be treated as two different authoring flows:

- skill authoring flow
- agent authoring flow

An agent may use the skill flow during agent creation, but the stores and confirmation commands stay distinct.

## 2. Storage Model

### 2.1 Recommended directory model

```text
skills/
  shared/                    # curated foundational skills
  store/
    dev/<skill>/             # saved candidate skills
    prod/<skill>/            # approved reusable skills

.openagents/
  agents/
    dev/<agent>/
    prod/<agent>/
  threads/<thread>/user-data/
    workspace/
    uploads/
    outputs/
    authoring/
      agents/<agent>/
      skills/<skill>/
```

### 2.2 Meaning of each layer

- `skills/shared`
  - foundational base capabilities
  - manually curated
  - not every created skill belongs here

- `skills/store/dev`
  - saved skills discovered or created during conversations
  - candidate reusable assets
  - not auto-loaded globally

- `skills/store/prod`
  - approved reusable store skills
  - searchable / installable for future agents

- `.openagents/agents/dev`
  - saved agent packages under development

- `.openagents/agents/prod`
  - published production agents

- `threads/.../authoring`
  - per-thread draft staging
  - safe place for autonomous creation and revision

## 3. Why This Split Is Better

### 3.1 Shared core should stay small

Your latest direction is correct:

- shared skills are foundational infrastructure
- created/imported skills should not go there automatically

This avoids polluting the base capability set.

### 3.2 Skill store becomes the incubation layer

The correct flow for newly created or imported skills is:

```text
runtime draft -> save to skills/store/dev -> optional test/use -> optional push to store/prod -> optional human promote to shared
```

This gives three levels:

- draft
- reusable
- foundational

### 3.3 Agent-local skills remain copied assets

When an agent needs a skill, it may:

- copy from `skills/shared`
- copy from `skills/store/prod`
- create one from scratch

The copied version under the agent becomes the agent-owned implementation.

## 4. Runtime Flow

### 4.1 Agent creation flow

```text
User: "我想创建个合同审查智能体"
  |
  v
Current active agent
  |
  | checks existing skills
  | discovers bootstrap
  | uses bootstrap to clarify requirements
  | decides whether current skills are enough
  | searches shared/store/external sources if needed
  | creates missing skills if needed
  v
thread authoring draft
  /threads/<tid>/user-data/authoring/agents/contract-review/
    AGENTS.md
    config.yaml
    skills/
  |
  | agent tells user draft is ready
  v
User enters /save_agent_to_store
  |
  v
controlled save tool
  |
  v
.openagents/agents/dev/contract-review/
```

### 4.2 Skill creation flow

```text
User: "做一个合同风险分级 skill"
  |
  v
Current active agent
  |
  | decides:
  | - find existing?
  | - search external?
  | - create with skill-creator?
  v
thread authoring draft
  /threads/<tid>/user-data/authoring/skills/contract-risk-rating/
    SKILL.md
    scripts/
    references/
  |
  | validates and tests
  v
User enters /save_skill_to_store
  |
  v
controlled save tool
  |
  v
skills/store/dev/contract-risk-rating/
```

### 4.3 Agent test and self-optimization flow

```text
saved dev agent
  |
  v
frontend test page
  |
  | unified chat interface
  | agent_name = contract-review
  | agent_status = dev
  | model / mode = selected by user
  v
thread_id created automatically
  |
  | user keeps testing
  | agent can inspect the same thread_id context
  | agent can diagnose bad answers
  | agent can revise AGENTS.md or skills in draft area
  v
user confirms again with /save_agent_to_store
  |
  v
dev archive updated
```

### 4.4 Production publish flow

```text
User enters /push_agent_prod
  |
  v
publish tool
  |
  v
.openagents/agents/prod/<agent>
```

For skills:

```text
User enters /push_skill_prod
  |
  v
publish tool
  |
  v
skills/store/prod/<skill>
```

Optional curated promotion:

```text
human action / explicit command
  |
  v
skills/store/prod/<skill> -> skills/shared/<skill>
```

## 5. Slash Command Model

### 5.1 Slash commands are not direct text

User types:

```text
/save_agent_to_store
```

Frontend should not send this as raw chat text only.

Instead it should transform it into:

- structured command metadata
- a generated instruction prompt for the agent

### 5.2 Recommended command registry

Add a command registry like:

```text
frontend/app/src/core/commands/
  manifest.ts
  prompts/
    save-agent-to-store.md
    save-skill-to-store.md
    push-agent-prod.md
    push-skill-prod.md
    promote-skill-shared.md
```

Each command definition should include:

- command name
- description
- scope
- visibility
- dev-only flag
- prompt template
- optional argument schema

Example shape:

```ts
type AppCommand = {
  name: "/save_agent_to_store";
  description: string;
  scope: "global" | "agent_chat";
  devOnly: boolean;
  promptTemplate: string;
};
```

### 5.3 Recommended command transformation

Frontend turns:

```text
/save_agent_to_store
```

into something like:

```text
<command_request>
name: save_agent_to_store
target: current_agent
requirements:
- Save the current authoring draft for this agent into dev store.
- Validate AGENTS.md and skills before saving.
- If validation fails, explain what must be fixed instead of saving.
</command_request>
```

And also sends metadata:

```json
{
  "command_name": "save_agent_to_store"
}
```

This reduces model ambiguity while keeping the agent in control.

### 5.4 Suggested initial commands

- `/save_skill_to_store`
- `/save_agent_to_store`
- `/push_agent_prod`
- `/push_skill_prod`
- `/promote_skill_shared`
- `/test_current_agent`

Optional:

- `/discard_draft`
- `/open_agent_dev`
- `/open_skill_draft`

## 6. Frontend Feasibility

### 6.1 Current frontend is already close

Existing frontend already has:

- unified chat UI for lead and named agents
- model and mode selection
- command-style UI primitives from `cmdk`
- agent chat pages

Missing pieces are:

- slash command parsing
- slash command suggestion dropdown
- agent status selection in chat context
- dedicated dev test flow UI

### 6.2 Recommended agent test page behavior

The existing agent chat page can be extended rather than rewritten.

Needed additions:

- explicit `agent_status` selector: `dev | prod`
- model selector stays reused
- mode selector stays reused
- thread_id auto-created as now
- command suggestions shown when input starts with `/`

## 7. Backend Feasibility

### 7.1 Tool gating should be done by runtime status

Your idea is correct:

- authoring tools should be available only in dev
- prod must not expose save/publish/authoring mutation tools

### 7.2 Recommended enforcement point

Do this in tool resolution, not only in prompt text.

Reason:

- prompt-only restriction is weak
- actual tool availability should differ by status

Recommended rule:

```text
if agent_status == "prod":
  do not include authoring tools
if agent_status == "dev":
  include authoring tools
```

This can be implemented when assembling tools for `create_deep_agent`.

### 7.3 Recommended authoring tools

Minimal set:

- `save_agent_to_store`
- `save_skill_to_store`
- `push_agent_prod`
- `push_skill_prod`
- `promote_skill_shared`

Optional helpers:

- `validate_agent_draft`
- `validate_skill_draft`

## 8. Role Of config.yaml

Your direction here is also reasonable.

`config.yaml` should remain the machine-readable description of the agent.

Recommended contents:

- name
- description
- model
- tool_groups
- mcp_servers
- memory
- `skill_refs`

### 8.1 Keep `skill_refs`

Keeping `skill_refs` is still useful.

Not for storing the whole skill content, but for telling runtime:

- which skills should be copied into runtime
- where those skills came from
- whether they came from shared/store/agent-local sources

Suggested future structure:

```yaml
skill_refs:
  - name: legal-risk-rating
    source: shared
    path: skills/shared/legal-risk-rating
  - name: objection-handling
    source: store
    path: skills/store/prod/objection-handling
```

If a skill is agent-local only:

```yaml
  - name: custom-contract-check
    source: agent_local
    path: skills/custom-contract-check
```

## 9. Recommended Final Interaction Contract

### 9.1 What natural language does

Natural language is for:

- exploration
- clarification
- drafting
- testing
- refinement

### 9.2 What slash commands do

Slash commands are for:

- save
- publish
- promote
- discard

### 9.3 Why this is the right compromise

It keeps the future direction you want:

- agents stay highly autonomous
- users mostly stay in one dialog
- no manual config burden

But it also protects the archive:

- no accidental persistence
- no accidental prod mutation
- no broad runtime sync risk

## 10. Final Recommendation

The best refinement is:

- separate skill lifecycle from agent lifecycle
- add a draft staging area under thread runtime
- require slash-command confirmation for persistence and promotion
- keep newly created skills out of shared core by default
- treat `skills/shared` as curated foundation only
- use `skills/store` as the reusable incubation layer
- inject authoring tools only when `agent_status=dev`

## Acceptance Criteria

- A normal chat can autonomously draft an agent or skill without persisting it.
- `/save_skill_to_store` persists only the current skill draft into `skills/store/dev`.
- `/save_agent_to_store` persists only the current agent draft into `.openagents/agents/dev`.
- `/push_agent_prod` and `/push_skill_prod` are unavailable in prod runtime toolsets.
- Shared foundational skills are promoted only through explicit human-controlled action.
