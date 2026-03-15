# Runtime Compose Network Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stabilize the Docker-backed OpenAgents runtime so gateway, langgraph, sandbox, and ONLYOFFICE stay on one network and the full `Surprise -> PPTX -> preview` flow can be validated end-to-end.

**Architecture:** Keep the root `.env` as the single config source, but pin Docker Compose to one project name so service DNS remains stable across rebuilds. Validate the runtime from three angles: container-to-container connectivity, authenticated artifact preview APIs, and browser/UI behavior.

**Tech Stack:** Docker Compose, Go gateway, Python LangGraph runtime, ONLYOFFICE, Playwright, pytest, go test.

---

### Task 1: Lock Compose Project Identity

**Files:**
- Modify: `docker/docker-compose-dev.yaml`
- Modify: `docker/README.md`

**Step 1: Confirm the failure mode**

Run:

```bash
docker inspect openagents-gateway --format '{{json .NetworkSettings.Networks}}'
docker inspect openagents-langgraph --format '{{json .NetworkSettings.Networks}}'
```

Expected: mismatched compose network names when services were recreated from different working directories.

**Step 2: Apply the minimal fix**

Set the compose top-level name to `openagents-dev` and document why this must not drift.

**Step 3: Recreate the affected container**

Run:

```bash
cd docker
docker compose --env-file ../.env -f docker-compose-dev.yaml up -d gateway
```

Expected: `openagents-gateway` joins the same network as `openagents-langgraph`.

### Task 2: Re-verify Runtime APIs

**Files:**
- Verify only

**Step 1: Validate proxy connectivity**

Run authenticated requests against:

```bash
/api/langgraph/threads/<thread_id>/history
/api/langgraph/threads/<thread_id>/state
```

Expected: HTTP `200` from gateway, with populated messages/artifacts data.

**Step 2: Validate PPT preview**

Run authenticated request against:

```bash
/api/threads/<thread_id>/artifacts/...pptx?preview=pdf
```

Expected: HTTP `200` and a valid PDF response.

### Task 3: Validate Browser/UI Flow

**Files:**
- Verify only

**Step 1: Login and open the existing surprise thread**

Use Playwright against `http://localhost:3000`.

**Step 2: Open the artifact panel and select the PPTX**

Expected:
- `Portal-to-Wonder.pptx` is visible in the thread UI
- selecting it triggers `/api/threads/<thread_id>/office-config/...` with `200`

**Step 3: Confirm admin observability**

Use admin APIs (or UI) to confirm:
- trace records exist for the surprise and PPT runs
- status is `completed`
- runtime thread appears in the admin runtime list

### Task 4: Regression Tests And Documentation

**Files:**
- Modify: `backend/gateway/internal/proxy/proxy.go`
- Modify: `backend/gateway/internal/proxy/proxy_test.go`
- Modify: `docs/runtime-architecture.md`

**Step 1: Keep the proxy abort fix covered**

Run:

```bash
cd backend/gateway
go test ./internal/proxy ./internal/handler/...
```

**Step 2: Keep env precedence covered**

Run:

```bash
pytest backend/agents/tests/test_langgraph_dev_env.py backend/agents/tests/test_remote_sandbox_backend.py -q
```

**Step 3: Document only the final architecture**

Write down:
- root `.env` + `*_DOCKER` layering
- fixed compose project naming
- provider/data-plane split in runtime docs
