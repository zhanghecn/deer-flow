# User-Agent Memory Scope Implementation Plan

> **Execution:** Use `executing-plans` to implement this plan task-by-task.

**Goal:** Replace the legacy global/per-agent memory system with a single user-agent scoped design controlled explicitly by each agent definition.

**Architecture:** Memory becomes an agent-level capability stored in agent manifests and `agents.config_json`, while runtime read/write paths are keyed by `user_id + agent_name + agent_status`. There is no global memory fallback, no alternate scope, and no prompt injection unless the selected agent explicitly enables memory with a configured extraction model.

**Tech Stack:** Python runtime, FastAPI routers, Go gateway, PostgreSQL agent metadata, filesystem-backed per-user memory storage, pytest, Go tests.

---

### Task 1: Define a single user-agent memory policy on agent manifests

**Files:**
- Modify: `backend/agents/src/config/agents_config.py`
- Modify: `backend/agents/src/config/agent_materialization.py`
- Modify: `backend/agents/src/config/runtime_db.py`
- Modify: `backend/gateway/internal/model/dto.go`
- Modify: `backend/gateway/internal/service/agent_service.go`
- Test: `backend/agents/tests/test_custom_agent.py`
- Test: `backend/gateway/internal/service/agent_service_test.go`

**Step 1: Write the failing test**

```python
def test_materialize_agent_definition_persists_memory_policy(tmp_path):
    config = materialize_agent_definition(
        name="analyst",
        agents_md="You are an analyst.",
        memory={"enabled": True, "model_name": "memory-model"},
        paths=_make_paths(tmp_path),
    )
    assert config.memory.enabled is True
    assert config.memory.model_name == "memory-model"
```

**Step 2: Run test to verify it fails**

Run: `PYTHONPATH=backend/agents uv run --project backend/agents pytest backend/agents/tests/test_custom_agent.py -k memory_policy -v`
Expected: FAIL because agent manifests do not expose memory policy yet.

**Step 3: Write minimal implementation**

```python
class AgentMemoryConfig(BaseModel):
    enabled: bool = False
    model_name: str | None = None
    debounce_seconds: int = 30
    max_facts: int = 100
    fact_confidence_threshold: float = 0.7
    injection_enabled: bool = True
    max_injection_tokens: int = 2000
```

Include `memory` on:
- Python `AgentConfig`
- filesystem `config.yaml` manifests
- Go `CreateAgentRequest` / `UpdateAgentRequest`
- Go `agents.config_json`
- Python runtime DB loader

Reject invalid states early:
- `memory.enabled=true` requires non-empty `memory.model_name`
- if `memory` is omitted, treat it as disabled
- do not support any `scope` field

**Step 4: Run test to verify it passes**

Run: `PYTHONPATH=backend/agents uv run --project backend/agents pytest backend/agents/tests/test_custom_agent.py -k memory_policy -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/config/agents_config.py backend/agents/src/config/agent_materialization.py backend/agents/src/config/runtime_db.py backend/gateway/internal/model/dto.go backend/gateway/internal/service/agent_service.go backend/agents/tests/test_custom_agent.py backend/gateway/internal/service/agent_service_test.go
git commit -m "feat: add agent-level memory policy"
```

### Task 2: Remove legacy global/per-agent memory paths and require user-agent storage

**Files:**
- Modify: `backend/agents/src/config/paths.py`
- Modify: `backend/agents/src/agents/memory/updater.py`
- Modify: `backend/agents/src/agents/memory/queue.py`
- Test: `backend/agents/tests/test_custom_agent.py`
- Test: `backend/agents/tests/test_memory_upload_filtering.py`

**Step 1: Write the failing test**

```python
def test_get_memory_file_path_requires_user_and_agent(tmp_path):
    with pytest.raises(ValueError, match="user_id"):
        _get_memory_file_path(user_id=None, agent_name="analyst", agent_status="dev")
```

**Step 2: Run test to verify it fails**

Run: `PYTHONPATH=backend/agents uv run --project backend/agents pytest backend/agents/tests/test_custom_agent.py -k user_agent_memory_path -v`
Expected: FAIL because current helpers still support global/per-agent files.

**Step 3: Write minimal implementation**

```python
def user_agent_memory_file(self, user_id: str, agent_name: str, status: str = "dev") -> Path:
    return self.user_dir(user_id) / "agents" / status / agent_name.lower() / "memory.json"
```

Update runtime helpers so every memory load/save/update requires:
- `user_id`
- `agent_name`
- `agent_status`

Delete legacy path branches for:
- global `memory.json`
- agent-owned `agents/{status}/{name}/memory.json`

**Step 4: Run test to verify it passes**

Run: `PYTHONPATH=backend/agents uv run --project backend/agents pytest backend/agents/tests/test_custom_agent.py -k user_agent_memory_path -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/config/paths.py backend/agents/src/agents/memory/updater.py backend/agents/src/agents/memory/queue.py backend/agents/tests/test_custom_agent.py backend/agents/tests/test_memory_upload_filtering.py
git commit -m "refactor: enforce user-agent memory scope"
```

### Task 3: Rewire runtime prompt injection and updates to use agent policy only

**Files:**
- Modify: `backend/agents/src/agents/lead_agent/prompt.py`
- Modify: `backend/agents/src/agents/lead_agent/agent.py`
- Modify: `backend/agents/src/client.py`
- Modify: `backend/agents/src/gateway/routers/memory.py`
- Test: `backend/agents/tests/test_client.py`
- Test: `backend/agents/tests/test_lead_agent_backend.py`

**Step 1: Write the failing test**

```python
def test_memory_context_requires_enabled_agent_policy_and_user_id():
    assert _get_memory_context(user_id=None, agent_name="analyst", agent_status="dev", memory_config=enabled_cfg) == ""
```

**Step 2: Run test to verify it fails**

Run: `PYTHONPATH=backend/agents uv run --project backend/agents pytest backend/agents/tests/test_client.py -k memory_context -v`
Expected: FAIL because prompt injection still reads global config.

**Step 3: Write minimal implementation**

```python
memory_context = _get_memory_context(
    user_id=user_id,
    agent_name=agent_name,
    agent_status=agent_status,
    memory_config=agent_config.memory,
)
```

Rules:
- no agent memory policy => no memory injection
- enabled policy but missing `user_id` on thread-scoped/cloud request => hard error
- Python memory endpoints must require `user_id`, `agent_name`, and `agent_status`
- embedded client helper methods should accept explicit identifiers instead of hidden global state

**Step 4: Run test to verify it passes**

Run: `PYTHONPATH=backend/agents uv run --project backend/agents pytest backend/agents/tests/test_client.py -k memory -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/agents/src/agents/lead_agent/prompt.py backend/agents/src/agents/lead_agent/agent.py backend/agents/src/client.py backend/agents/src/gateway/routers/memory.py backend/agents/tests/test_client.py backend/agents/tests/test_lead_agent_backend.py
git commit -m "feat: bind runtime memory to user-agent scope"
```

### Task 4: Align gateway memory API with the same user-agent contract

**Files:**
- Modify: `backend/gateway/internal/handler/memory.go`
- Test: `backend/gateway/internal/service/agent_service_test.go`

**Step 1: Write the failing test**

```go
func TestMemoryHandlerRejectsMissingAgentName(t *testing.T) {
    // GET /api/memory without agent_name should return 400
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend/gateway && go test ./internal/... -run Memory -v`
Expected: FAIL because the handler still reads `users/{id}/memory.json`.

**Step 3: Write minimal implementation**

```go
agentName := strings.TrimSpace(c.Query("agent_name"))
agentStatus := defaultStatus(c.Query("agent_status"))
memPath := filepath.Join(h.fs.UserDir(userID.String()), "agents", agentStatus, agentName, "memory.json")
```

Rules:
- require `agent_name`
- allow `agent_status` with strict `dev|prod` validation
- do not expose any global memory endpoint semantics

**Step 4: Run test to verify it passes**

Run: `cd backend/gateway && go test ./internal/... -run Memory -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/gateway/internal/handler/memory.go backend/gateway/internal/service/agent_service_test.go
git commit -m "feat: align gateway memory API with user-agent scope"
```

### Task 5: Update local config/docs and remove misleading global config

**Files:**
- Modify: `config.example.yaml`
- Modify: `config.yaml`
- Modify: `backend/agents/README.md`
- Modify: `backend/gateway/README.md`

**Step 1: Write the failing test**

No automated test; use doc/config review.

**Step 2: Run verification to show the gap**

Run: `rg -n "global memory|memory.json|memory:" config.example.yaml config.yaml backend/agents/README.md backend/gateway/README.md`
Expected: outdated global memory wording remains.

**Step 3: Write minimal implementation**

Document:
- global top-level `memory` config is removed or explicitly marked unsupported
- memory is enabled per agent
- storage is `users/{user_id}/agents/{status}/{agent_name}/memory.json`
- runtime requires user identity when memory is enabled

**Step 4: Run verification**

Run: `rg -n "global memory|users/.*/agents" config.example.yaml config.yaml backend/agents/README.md backend/gateway/README.md`
Expected: wording matches the new single-scope contract.

**Step 5: Commit**

```bash
git add config.example.yaml config.yaml backend/agents/README.md backend/gateway/README.md
git commit -m "docs: document user-agent memory scope"
```
