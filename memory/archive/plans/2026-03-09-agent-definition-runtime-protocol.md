# Agent Definition Runtime Protocol Implementation Plan

> **Execution:** Use `executing-plans` to implement this plan task-by-task.

**Goal:** Unify agent creation/runtime protocol so agents are defined by `AGENTS.md` plus selected skills, materialized into dev/prod filesystem layouts, and executed through sandbox-friendly backends without mixing database content storage and runtime files.

**Architecture:** Split the system into two layers. The definition layer stores agent metadata plus references to local files/selected skills, while the runtime layer consumes a materialized agent directory containing `AGENTS.md`, copied skills, and status-specific config. The default `lead_agent` remains the global entrypoint and exposes all archived skills; named agents expose only their own copied skills.

**Tech Stack:** Python/FastAPI backend, deepagents backends, local filesystem materialization, PostgreSQL-backed runtime metadata, pytest.

---

### Task 1: Define the unified agent manifest and materialization helpers

**Files:**
- Modify: `backend/agents/src/config/agents_config.py`
- Modify: `backend/agents/src/config/paths.py`
- Create: `backend/agents/src/config/agent_materialization.py`
- Test: `backend/agents/tests/test_custom_agent.py`

**Step 1: Write the failing test**

```python
def test_materialize_agent_definition_copies_selected_skills(tmp_path):
    ...
    assert (agent_dir / "AGENTS.md").read_text() == "domain instructions"
    assert (agent_dir / "skills" / "data-analysis" / "SKILL.md").exists()
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/agents/tests/test_custom_agent.py -k materialize -v`
Expected: FAIL because no materialization helper or manifest-aware config exists yet.

**Step 3: Write minimal implementation**

```python
class AgentSkillRef(BaseModel):
    name: str
    source: str
    category: str | None = None


class AgentMaterializedDefinition(BaseModel):
    name: str
    status: str
    agents_md_path: str
    skill_refs: list[AgentSkillRef]
```

Add helpers to:
- resolve agent dev/prod directories
- read/write config with `skill_refs`, `agents_md_path`, `sandbox_mode`
- copy referenced skills from the global skills library into `agents/{status}/{name}/skills/`

**Step 4: Run test to verify it passes**

Run: `pytest backend/agents/tests/test_custom_agent.py -k materialize -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/config/agents_config.py backend/agents/src/config/paths.py backend/agents/src/config/agent_materialization.py backend/agents/tests/test_custom_agent.py
git commit -m "feat: add agent materialization helpers"
```

### Task 2: Update agent CRUD protocol around AGENTS.md references and skill selection

**Files:**
- Modify: `backend/agents/src/gateway/routers/agents.py`
- Modify: `backend/agents/src/config/agents_config.py`
- Test: `backend/agents/tests/test_custom_agent.py`

**Step 1: Write the failing test**

```python
def test_create_agent_persists_manifest_and_copies_selected_skills(client, tmp_path):
    response = client.post("/api/agents", json={
        "name": "industry-analyst",
        "agents_md": "You are an industry analyst.",
        "description": "Analyze a vertical",
        "skills": [{"name": "data-analysis"}],
    })
    assert response.status_code == 201
    assert response.json()["skills"][0]["name"] == "data-analysis"
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/agents/tests/test_custom_agent.py -k "create_agent or update_agent or publish_agent" -v`
Expected: FAIL because current API ignores skill refs and does not expose manifest details.

**Step 3: Write minimal implementation**

```python
class AgentSkillSelection(BaseModel):
    name: str


class AgentCreateRequest(BaseModel):
    ...
    skills: list[AgentSkillSelection] = Field(default_factory=list)
```

Update CRUD so it:
- treats `AGENTS.md` as a local file under each agent directory
- writes only references/metadata into `config.yaml`
- materializes copied skills from the shared skills library
- keeps dev/prod separation for reads, updates, publish, and delete

**Step 4: Run test to verify it passes**

Run: `pytest backend/agents/tests/test_custom_agent.py -k "create_agent or update_agent or publish_agent" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/gateway/routers/agents.py backend/agents/src/config/agents_config.py backend/agents/tests/test_custom_agent.py
git commit -m "feat: align agent CRUD with manifest protocol"
```

### Task 3: Rewire lead agent runtime backend around default/global skills and named-agent sandboxes

**Files:**
- Modify: `backend/agents/src/agents/lead_agent/agent.py`
- Modify: `backend/agents/src/config/runtime_db.py`
- Test: `backend/agents/tests/test_lead_agent_backend.py`
- Test: `backend/agents/tests/test_lead_agent_model_resolution.py`

**Step 1: Write the failing test**

```python
def test_build_backend_named_agent_mounts_agent_definition_and_thread_workspace(tmp_path):
    backend = build_backend("thread-1", agent_name="analyst", status="prod")
    assert "/skills/" in backend.routes
    assert "/agent/" in backend.routes

def test_build_backend_default_agent_exposes_all_archived_skills(tmp_path):
    backend = build_backend("thread-1", agent_name=None)
    assert backend.routes["/skills/"].cwd == (tmp_path / "skills").resolve()
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/agents/tests/test_lead_agent_backend.py backend/agents/tests/test_lead_agent_model_resolution.py -v`
Expected: FAIL because current backend uses `/public-skills/` and does not expose a unified agent-definition route.

**Step 3: Write minimal implementation**

```python
def build_backend(...):
    routes = {"/agent/": FilesystemBackend(...)}
    if agent_name:
        routes["/skills/"] = FilesystemBackend(root_dir=str(agent_skills_dir), virtual_mode=True)
    else:
        routes["/skills/"] = FilesystemBackend(root_dir=str(paths.skills_dir), virtual_mode=True)
```

Update runtime DB config objects if needed so runtime has enough status/config metadata to resolve the right materialized directory and sandbox mode.

**Step 4: Run test to verify it passes**

Run: `pytest backend/agents/tests/test_lead_agent_backend.py backend/agents/tests/test_lead_agent_model_resolution.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/agents/lead_agent/agent.py backend/agents/src/config/runtime_db.py backend/agents/tests/test_lead_agent_backend.py backend/agents/tests/test_lead_agent_model_resolution.py
git commit -m "feat: unify lead agent runtime backend protocol"
```

### Task 4: Update bootstrap/setup flow so generated agents follow the same protocol

**Files:**
- Modify: `backend/agents/src/tools/builtins/setup_agent_tool.py`
- Test: `backend/agents/tests/test_custom_agent.py`

**Step 1: Write the failing test**

```python
def test_setup_agent_tool_uses_same_materialization_protocol(...):
    ...
    assert (agent_dir / "config.yaml").read_text().find("skill_refs") != -1
```

**Step 2: Run test to verify it fails**

Run: `pytest backend/agents/tests/test_custom_agent.py -k setup_agent -v`
Expected: FAIL because bootstrap creation writes ad-hoc files directly.

**Step 3: Write minimal implementation**

```python
result = materialize_agent_definition(...)
```

Reuse the same helper as CRUD so bootstrap-generated agents are not a separate protocol.

**Step 4: Run test to verify it passes**

Run: `pytest backend/agents/tests/test_custom_agent.py -k setup_agent -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/tools/builtins/setup_agent_tool.py backend/agents/tests/test_custom_agent.py
git commit -m "feat: align setup_agent with agent manifest protocol"
```

### Task 5: Document the protocol and verification flow

**Files:**
- Modify: `backend/agents/README.md`
- Modify: `backend/agents/CLAUDE.md`
- Modify: `backend/agents/docs/ARCHITECTURE.md`
- Create: `backend/agents/docs/AGENT_PROTOCOL.md`

**Step 1: Write the failing test**

No automated test; use documentation review checklist.

**Step 2: Run verification to show the gap**

Run: `rg -n "public-skills|agents_md TEXT|double write|skill_refs|materialization" backend/agents/README.md backend/agents/CLAUDE.md backend/agents/docs/ARCHITECTURE.md`
Expected: missing or outdated protocol wording.

**Step 3: Write minimal implementation**

Document:
- definition vs runtime materialization
- AGENTS.md ownership rules
- skill library vs copied agent skills
- dev/prod lifecycle
- local filesystem debug vs VM/sandbox runtime
- ASCII flowchart for create/publish/run

**Step 4: Run verification to confirm docs are updated**

Run: `rg -n "definition layer|materialization|skill_refs|sandbox|dev/prod|ASCII" backend/agents/README.md backend/agents/CLAUDE.md backend/agents/docs/ARCHITECTURE.md backend/agents/docs/AGENT_PROTOCOL.md`
Expected: matches the new protocol terminology.

**Step 5: Commit**

```bash
git add backend/agents/README.md backend/agents/CLAUDE.md backend/agents/docs/ARCHITECTURE.md backend/agents/docs/AGENT_PROTOCOL.md
git commit -m "docs: describe unified agent runtime protocol"
```

### Task 6: Run the relevant regression suite

**Files:**
- Test: `backend/agents/tests/test_custom_agent.py`
- Test: `backend/agents/tests/test_lead_agent_backend.py`
- Test: `backend/agents/tests/test_lead_agent_model_resolution.py`

**Step 1: Write the failing test**

Already covered by previous tasks.

**Step 2: Run the tests**

Run: `pytest backend/agents/tests/test_custom_agent.py backend/agents/tests/test_lead_agent_backend.py backend/agents/tests/test_lead_agent_model_resolution.py -v`
Expected: PASS

**Step 3: Run targeted lint if needed**

Run: `ruff check backend/agents/src backend/agents/tests`
Expected: PASS

**Step 4: Record residual risks**

Note any uncovered Go gateway/database sync gaps if they remain outside this change set.

**Step 5: Commit**

```bash
git add .
git commit -m "test: verify unified agent runtime protocol"
```
