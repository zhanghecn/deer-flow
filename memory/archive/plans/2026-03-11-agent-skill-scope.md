# Agent Skill Scope Implementation Plan

> **Execution:** Use `executing-plans` to implement this plan task-by-task.

**Goal:** Split skills into shared skills and agent-private skills, while keeping the current archived-agent and per-thread runtime model intact.

**Architecture:** Keep the shared skills library as the only reusable/global source of truth, and introduce agent-private skills as files owned by each archived agent. At runtime, inject both sources into deepagents as ordered skill sources so private skills can override shared ones when names collide.

**Tech Stack:** Go Gateway, Python runtime (`backend/agents`), PostgreSQL, Next.js frontend, deepagents SkillsMiddleware

---

### Task 1: Freeze The Target Model

**Files:**
- Modify: `backend/agents/docs/AGENT_PROTOCOL.md`
- Modify: `backend/agents/docs/ARCHITECTURE.md`
- Modify: `backend/gateway/README.md`

**Step 1: Document the target directory layout**

Target layout:

```text
skills/
  public/<skill>/
  custom/<skill>/

.openagents/agents/{status}/{agent}/
  AGENTS.md
  config.yaml
  skills/
    shared/<skill>/   # copied from shared library
    private/<skill>/  # owned only by this agent
```

**Step 2: Document runtime precedence**

Runtime skill sources:

```text
/mnt/user-data/agents/{status}/{agent}/skills/shared
/mnt/user-data/agents/{status}/{agent}/skills/private
```

Rule: load `shared` first, then `private`; same-name private skill overrides shared skill.

**Step 3: Document non-goals**

- Do not put agent-private skills into the global `skills` table in phase 1.
- Do not change thread/runtime isolation rules.
- Do not reuse the old global `enabled` flag as the authority for runtime injection.

### Task 2: Change Archived Agent Filesystem Semantics

**Files:**
- Modify: `backend/gateway/pkg/storage/fs.go`
- Modify: `backend/gateway/internal/service/agent_service.go`
- Test: `backend/gateway/pkg/storage/fs_test.go`
- Test: `backend/gateway/internal/service/agent_service_test.go`

**Step 1: Stop flattening copied shared skills into `skills/<name>`**

Write shared copies to:

```text
agents/{status}/{agent}/skills/shared/<name>
```

instead of:

```text
agents/{status}/{agent}/skills/<name>
```

**Step 2: Preserve `skills/private` during agent updates**

Replace only `skills/shared` during `Create/Update/Publish`.

Expected behavior:
- updating shared skill selection should not delete agent-private skills
- deleting an agent still removes the whole agent directory

**Step 3: Keep publish behavior simple**

`dev -> prod` continues to copy the whole archived agent directory, which naturally includes `skills/private`.

### Task 3: Extend Agent Manifest And Runtime Seeding

**Files:**
- Modify: `backend/agents/src/config/agents_config.py`
- Modify: `backend/agents/src/config/agent_materialization.py`
- Modify: `backend/agents/src/config/agent_runtime_seed.py`
- Modify: `backend/agents/src/config/paths.py`
- Modify: `backend/agents/src/config/builtin_agents.py`
- Test: `backend/agents/tests/test_custom_agent.py`
- Test: `backend/agents/tests/test_builtin_agent_archive.py`
- Test: `backend/agents/tests/test_lead_agent_backend.py`

**Step 1: Update shared skill refs**

Shared skill refs should materialize to:

```yaml
skill_refs:
  - name: data-analysis
    source_path: public/data-analysis
    materialized_path: skills/shared/data-analysis
```

**Step 2: Teach runtime seeding about private skills**

Seed these entries if they exist:

```text
AGENTS.md
config.yaml
skills/shared/**
skills/private/**
```

Implementation rule:
- shared skills still come from `skill_refs`
- private skills are discovered from archived agent filesystem

**Step 3: Keep lead_agent compatible**

Built-in `lead_agent` still defaults to shared public skills only.
Its `skills/private` directory is optional and empty by default.

### Task 4: Inject Multi-Source Skills At Runtime

**Files:**
- Modify: `backend/agents/src/agents/lead_agent/agent.py`
- Modify: `backend/agents/src/client.py`
- Modify: `backend/agents/src/agents/lead_agent/AGENTS.md`
- Test: `backend/agents/tests/test_lead_agent_backend.py`

**Step 1: Change runtime skill sources**

Current:

```python
skills=[_runtime_skills_path(agent_name, status)]
```

Target:

```python
skills=[
    f"/mnt/user-data/agents/{status}/{agent_name}/skills/shared",
    f"/mnt/user-data/agents/{status}/{agent_name}/skills/private",
]
```

**Step 2: Preserve override order**

Because deepagents uses last-one-wins, `private` must be appended after `shared`.

**Step 3: Update agent prompt guidance**

Agent instructions should explicitly say:
- reusable skills come from shared library copies
- agent-private skills live under `skills/private`
- when a name exists in both places, use the private version

### Task 5: Add Agent-Private Skill CRUD

**Files:**
- Modify: `backend/gateway/internal/model/dto.go`
- Modify: `backend/gateway/internal/model/models.go`
- Add: `backend/gateway/internal/handler/agent_private_skills.go`
- Add: `backend/gateway/internal/service/agent_private_skill_service.go`
- Test: `backend/gateway/internal/service/agent_service_test.go`

**Step 1: Keep phase-1 storage file-based**

Do not add a new DB table yet.

Private skill APIs operate on:

```text
agents/{status}/{agent}/skills/private/<skill>/SKILL.md
```

**Step 2: Add minimal endpoints**

Recommended endpoints:

```text
GET    /api/agents/{name}/private-skills
POST   /api/agents/{name}/private-skills
GET    /api/agents/{name}/private-skills/{skill}
PUT    /api/agents/{name}/private-skills/{skill}
DELETE /api/agents/{name}/private-skills/{skill}
```

**Step 3: Enforce local naming rules only**

- private skill names only need to be unique inside one agent
- same private skill name may exist in different agents
- same name as a shared skill is allowed and means override

### Task 6: Update Agent APIs And Frontend

**Files:**
- Modify: `backend/gateway/internal/model/dto.go`
- Modify: `frontend/app/src/core/agents/types.ts`
- Modify: `frontend/app/src/core/agents/api.ts`
- Modify: agent management UI under `frontend/app/src/app/workspace/agents/`
- Modify: `frontend/app/src/core/skills/api.ts` only if shared/private views are combined in UI

**Step 1: Split API semantics**

Agent create/update requests should use:

```json
{
  "shared_skills": ["data-analysis", "deep-research"]
}
```

instead of the ambiguous current:

```json
{
  "skills": ["data-analysis", "deep-research"]
}
```

**Step 2: Return both skill sets**

Agent response should distinguish:
- `shared_skills`
- `private_skills`

**Step 3: Update UI**

Agent page should expose two panels:
- Shared skills: pick from global catalog
- Private skills: create/edit/delete skill files owned by this agent

### Task 7: Clean Up Legacy Enable Semantics

**Files:**
- Modify: `backend/agents/src/config/extensions_config.py`
- Modify: `backend/agents/src/gateway/routers/skills.py`
- Modify: `frontend/app/src/core/skills/api.ts`
- Test: `backend/agents/tests/test_skills_loader.py`

**Step 1: Make a product decision**

Pick one:
- shared skill `enabled` only controls catalog visibility
- or remove this switch from the product

**Step 2: Avoid fake runtime control**

Do not imply that global `enabled=false` removes a skill from an already materialized agent runtime.

**Step 3: If kept, rename the meaning in docs/UI**

Suggested wording:
- `visible`
- or `installable`

instead of `enabled`

### Task 8: Migration And Compatibility

**Files:**
- Modify: `backend/gateway/internal/service/agent_service.go`
- Modify: `backend/agents/src/config/builtin_agents.py`
- Modify: `backend/agents/src/config/agent_runtime_seed.py`
- Test: compatibility coverage in existing agent tests

**Step 1: Migrate old archived paths**

If old manifest uses:

```yaml
materialized_path: skills/<name>
```

normalize it to:

```yaml
materialized_path: skills/shared/<name>
```

at load time where practical.

**Step 2: Keep old agents readable**

Old agents without `skills/private` must still run.

**Step 3: Migrate built-in lead agent once**

On archive ensure:
- rewrite old `skills/<name>` layout to `skills/shared/<name>`
- preserve future `skills/private`

## Recommended Rollout

1. Implement Tasks 1-4 first.
2. Verify one shared skill and one private override skill can both load.
3. Implement Task 5 for file-based private skill CRUD.
4. Implement Task 6 for UI and API cleanup.
5. Decide Task 7 separately; do not mix it into the first refactor unless necessary.

## Acceptance Criteria

- Shared skills remain reusable across agents.
- Each agent can own private skills without putting them in the global skill library.
- Updating shared skill selection does not delete agent-private skills.
- Runtime loads both shared and private skill sources in deterministic order.
- Same-name private skill overrides same-name shared skill for that agent only.
- Existing agents without private skills continue to work.
