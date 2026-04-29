# Agent Runtime UI And Lead Prompt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose agent/runtime selection in the frontend, make archived `lead_agent` prompt/config editable from `.openagents`, and add a sharable demo URL flow that can launch local or remote-backed chats.

**Architecture:** Keep runtime/backend layering unchanged: frontend only passes `agent_name`, `agent_status`, `execution_backend`, and `remote_session_id` through the existing LangGraph configurable context; Go gateway continues to own archived agent CRUD; Python runtime keeps generic system prompt logic in code while reading agent-owned prompt content from archived `.openagents/agents/{status}/{name}/AGENTS.md`. The built-in `lead_agent` archive must be seeded once and then treated like any other archived agent for prompt editing.

**Tech Stack:** Next.js 16, React 19, TanStack Query, Vite React admin app, Go gateway, Python LangGraph runtime.

---

### Task 1: Stabilize Runtime Discovery Inputs

**Files:**
- Modify: `frontend/app/src/core/threads/types.ts`
- Modify: `frontend/app/src/core/settings/local.ts`
- Modify: `frontend/app/src/core/threads/hooks.ts`
- Modify: `frontend/app/src/core/agents/types.ts`
- Modify: `frontend/app/src/core/agents/api.ts`
- Modify: `frontend/app/src/core/agents/hooks.ts`

**Step 1: Extend frontend thread context types**

Add `agent_status`, `execution_backend`, and `remote_session_id` to the frontend runtime context types so the UI can carry them explicitly.

**Step 2: Persist runtime selection in local settings**

Update the local settings schema so agent/runtime selections survive refreshes without inventing a new persistence store.

**Step 3: Forward runtime fields into LangGraph submit config**

Keep `useThreadStream()` responsible for serializing `agent_name`, `agent_status`, `execution_backend`, and `remote_session_id` into `config.configurable`.

**Step 4: Add status-aware agent API helpers**

Allow `listAgents()` and `getAgent()` to request a specific archive status and to cache results by `(name, status)`.

### Task 2: Make Built-In `lead_agent` Archive Editable

**Files:**
- Modify: `backend/agents/src/config/builtin_agents.py`
- Modify: `backend/agents/tests/test_builtin_agent_archive.py`

**Step 1: Stop overwriting archived `lead_agent` prompt content**

Change built-in archive seeding so repo-side `backend/agents/src/agents/lead_agent/AGENTS.md` is copied only when the archived file is missing.

**Step 2: Keep config seeding safe**

Preserve required manifest fields for `lead_agent`, but do not clobber user-edited archived `AGENTS.md`.

**Step 3: Add regression coverage**

Add a test that creates an archived `lead_agent` `AGENTS.md`, runs `ensure_builtin_agent_archive()`, and verifies the customized archived prompt is preserved.

### Task 3: Expose `lead_agent` Through Gateway Agent Listing

**Files:**
- Modify: `backend/gateway/internal/agentfs/agents.go`
- Modify: `backend/gateway/internal/handler/filesystem_views_test.go`

**Step 1: Include `lead_agent` in read-only agent discovery**

Return archived `lead_agent` entries from `ListAgents()` so both frontends can show it alongside other agents.

**Step 2: Sort built-in predictably**

Keep stable ordering, with `lead_agent` easy to find.

**Step 3: Protect destructive behavior**

Do not make `lead_agent` deletable through the user-facing UI; only expose it for chat, detail, update, and publish flows.

**Step 4: Update gateway tests**

Replace the old “skip built-in lead agent” expectation with coverage that verifies `lead_agent` is returned.

### Task 4: Add Frontend Runtime Controls And Sidebar Agent Navigation

**Files:**
- Create: `frontend/app/src/components/workspace/agent-runtime-controls.tsx`
- Create: `frontend/app/src/components/workspace/workspace-agent-list.tsx`
- Modify: `frontend/app/src/components/workspace/workspace-sidebar.tsx`
- Modify: `frontend/app/src/components/workspace/workspace-header.tsx`
- Modify: `frontend/app/src/components/workspace/welcome.tsx`
- Modify: `frontend/app/src/components/workspace/agent-welcome.tsx`
- Modify: `frontend/app/src/app/workspace/chats/new/page.tsx`
- Modify: `frontend/app/src/app/workspace/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/components/workspace/agents/agent-gallery.tsx`
- Modify: `frontend/app/src/components/workspace/agents/agent-card.tsx`

**Step 1: Build a reusable runtime control bar**

Add a small control component that shows and edits:
- current agent
- `dev` / `prod`
- backend mode: default or remote
- optional remote session ID

**Step 2: Wire the control bar into lead-agent and custom-agent chat entry pages**

Use the control bar in both `/workspace/chats/*` and `/workspace/agents/[agent_name]/chats/*` so users can see what runtime they are using before they send a message.

**Step 3: Add clickable sidebar agent entries**

Render archived agents in the left sidebar with clickable items that open a new chat for the selected `(agent_name, agent_status)`.

**Step 4: Update agent cards**

Surface status clearly and add a demo/copy-link action instead of a chat-only dead end.

### Task 5: Support Shareable Demo URLs

**Files:**
- Create: `frontend/app/src/core/agents/runtime-url.ts`
- Modify: `frontend/app/src/components/workspace/chats/new-chat-client.tsx`
- Modify: `frontend/app/src/app/workspace/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/components/workspace/agents/agent-card.tsx`
- Modify: `frontend/admin/src/components/agents/agent-detail.tsx`

**Step 1: Define a shareable runtime URL contract**

Encode `agent_name`, `agent_status`, `execution_backend`, and `remote_session_id` as query parameters on workspace new-chat URLs.

**Step 2: Read query params on load**

When a workspace chat page loads, use the shareable URL parameters to initialize the runtime control bar and message submission context.

**Step 3: Add “Open Demo” and “Copy URL” actions**

Expose generated URLs in both the user-facing agent gallery and the admin agent detail dialog.

### Task 6: Make Admin Agent Detail Actually Useful

**Files:**
- Modify: `frontend/admin/src/components/agents/agents-table.tsx`
- Modify: `frontend/admin/src/components/agents/agent-detail.tsx`
- Modify: `frontend/admin/src/types/index.ts`
- Modify: `frontend/admin/src/lib/api.ts`

**Step 1: Make rows and names clickable**

Open the detail dialog when the agent name or row is selected, not only from the eye icon.

**Step 2: Turn agent detail into an editable form**

Allow editing of:
- description
- model
- tool groups
- MCP servers
- memory settings
- `AGENTS.md`

**Step 3: Save back through existing gateway `PUT /api/agents/:name?status=...`**

Keep persistence in Go gateway; do not move runtime/backend selection into the stored agent manifest.

**Step 4: Add runtime demo URL builder**

Let admins generate a workspace demo URL for the current `(agent, status)` and optionally attach remote session parameters.

### Task 7: Verify End-To-End And Exercise `/create-agent`

**Files:**
- Modify if needed after testing: frontend/backend files above
- Verify: `frontend/app`, `frontend/admin`, `backend/gateway`, `backend/agents`

**Step 1: Run targeted checks**

Run:
- `go test ./...` in `backend/gateway`
- targeted Python tests for built-in lead-agent archive handling
- `pnpm check` in `frontend/app`

**Step 2: Headed browser verification**

Verify on `http://localhost:3000`:
- current agent/runtime is visible
- sidebar agents are clickable
- `lead_agent` is visible
- dev/prod switching changes the runtime context
- demo URL opens the correct agent/runtime selection

Verify on `http://localhost:5173`:
- agent rows open detail
- `lead_agent` detail is editable
- trace view still loads

**Step 3: Contract-review agent trial**

Use `/create-agent` in the workspace input box to draft a contract-review agent, then feed it a deliberately problematic long contract that exceeds the normal context window and confirm traces appear in admin observability.
