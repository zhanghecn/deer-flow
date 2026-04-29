# Manus Workspace Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align Deer Flow's chat, design-board, and runtime-space UX with Manus-style task workspaces by replacing popup-first tools with a hybrid thread-local workspace model: lightweight context stays visible next to chat, while heavyweight editors run in full tabs.

**Architecture:** Keep the existing runtime/backend layering intact: Deer Flow continues to own thread state, `/mnt/user-data/...` paths, gateway-issued design/runtime sessions, and explicit tool/runtime context; OpenPencil remains the proxied design editor under `/openpencil`; the frontend adds a hybrid workspace model where the right dock acts as a thread-local control tower and full design/runtime editors open in normal tabs. Explicit `surface_context` / `selection_context` contracts replace any free-form target inference, and design/runtime state must flow back into the thread via structured bridge events.

**Tech Stack:** React 19, React Router, TanStack Query, LangGraph SDK React hooks, Go gateway, Python LangGraph runtime, OpenPencil web app, Docker Compose, Playwright.

---

## Surface Split Decision

This plan should use a hybrid workspace model, not an "everything must fit in the right dock" model.

### Keep In The Right Dock

The right dock is for narrow, always-visible context that must stay attached to the conversation:

- `Preview`: quick file/doc preview, screenshots, rendered snapshots, citation jumps
- `Files`: thread artifacts, generated outputs, current target switching
- `Design Context`: target path, selected-node chips, sync/save status, compact thumbnail, "open editor" action
- `Runtime Context`: current URL/status, latest screenshot or compact live view, busy/idle/error state, "open runtime" action

File discovery for `Preview` and `Files` should not depend on a new workspace-manifest API. Reuse the existing artifact/output discovery flow and classify files by path + extension (for example `pdf`, `xlsx`, `pptx`, `html`, `png`, `md`) to decide how they appear in the dock.

### Open In A New Tab By Default

Heavyweight work surfaces should open in a full browser tab:

- full OpenPencil canvas editing
- full runtime browser / IDE / terminal workspace
- large editable office/code/document surfaces
- responsive page/device previews that need real width

The tab is where dense editing happens. The right dock only mirrors enough state to keep the thread coherent.

### Popup Is Secondary

Prefer a normal browser tab over a popup. Keep popup/detached window support only as a secondary action for:

- multi-monitor workflows
- detached monitoring
- debugging cases where a small floating window is genuinely useful

### Product Shape

The thread page remains the main task workspace, but it does not try to host every heavyweight editor inline:

- conversation stays in the thread page
- the right dock keeps current design/runtime/file context visible
- full design and runtime work happen in tabs
- selection, save state, and runtime status flow back into the thread via explicit structured events

---

### Task 1: Define The Unified Workspace Surface Contract

**Files:**
- Create: `frontend/app/src/core/workspace-surface/types.ts`
- Create: `frontend/app/src/core/workspace-surface/context.tsx`
- Create: `frontend/app/src/core/workspace-surface/storage.ts`
- Modify: `frontend/app/src/core/threads/types.ts`
- Modify: `frontend/app/src/core/settings/local.ts`
- Modify: `frontend/app/src/core/threads/hooks.ts`

**Step 1: Introduce explicit workspace surface types**

Define shared frontend types for:
- `WorkspaceSurface = "preview" | "design" | "runtime" | "files"`
- `DesignSelectionContext`
- `RuntimeSurfaceState`
- `WorkspaceDockState`

Keep these types UI-agnostic so they can be reused by the chat pages, dock shell, and message event renderers.

**Step 2: Add a dedicated surface context provider**

Create a new provider for:
- active surface tab
- dock open/closed state
- design session metadata
- runtime session metadata
- current design selection chips
- current preview/file target

Do not overload `ArtifactsContext`; keep file-preview state as one subdomain rather than the workspace-wide state owner.

**Step 3: Extend thread/config context with explicit structured fields**

Add optional `surface_context` and `selection_context` payloads to the frontend thread-context plumbing so they travel through `buildSubmitOptions()` in `frontend/app/src/core/threads/hooks.ts` without relying on natural-language parsing.

Expected fields:
- `surface_context.surface`
- `surface_context.target_path`
- `selection_context.surface`
- `selection_context.target_path`
- `selection_context.selected_node_ids`
- `selection_context.selection_summary`

**Step 4: Persist only layout-level preferences**

Use local settings storage for panel preferences such as:
- last active surface tab
- dock open/closed state
- optional dock width ratio

Do not persist thread-specific selections globally.

**Step 5: Do not add a new file-manifest contract**

Keep file/workspace discovery grounded in existing thread outputs:
- `thread.values.artifacts`
- discovered output files
- canonical design files under `/mnt/user-data/authoring/designs/...`

Classify visibility and preview behavior from file type and known path prefixes instead of inventing new backend response fields.

### Task 2: Replace Popup-First Header Controls With A Thread-Local Workspace Toggle

**Files:**
- Modify: `frontend/app/src/components/workspace/workspace-header.tsx`
- Modify: `frontend/app/src/components/workspace/workspace-sidebar.tsx`
- Modify: `frontend/app/src/core/i18n/locales/en-US.ts`
- Modify: `frontend/app/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/app/src/core/i18n/locales/types.ts`

**Step 1: Change the primary header action model**

Replace the current "open design board" and "open runtime workspace" popup-first controls with:
- one primary "Workspace" or "Dock" toggle
- one secondary "Open in new window" action per surface

The thread-local dock becomes the default path; popup opening remains available as an escape hatch for debugging or full-screen work.

**Step 2: Keep thread/runtime availability rules explicit**

Preserve existing guards:
- runtime surface unavailable for remote-backed threads unless a dedicated embed path is added later
- design surface available only when a thread exists

Show disabled states and reasons in the UI instead of hiding intent behind disappearing buttons.

**Step 3: Surface the current active area in the header**

Add a compact status strip in the header showing:
- active workspace surface
- current design target file when in design mode
- runtime session status when in runtime mode

This keeps the "what am I currently editing/running?" answer visible without opening side panels.

### Task 3: Build The Unified Workspace Dock Shell

**Files:**
- Create: `frontend/app/src/components/workspace/surfaces/workspace-surface-dock.tsx`
- Create: `frontend/app/src/components/workspace/surfaces/workspace-surface-tabs.tsx`
- Create: `frontend/app/src/components/workspace/surfaces/workspace-surface-empty.tsx`
- Modify: `frontend/app/src/components/workspace/chats/chat-box.tsx`
- Modify: `frontend/app/src/app/workspace/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/app/workspace/chats/[thread_id]/layout.tsx`
- Modify: `frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/layout.tsx`

**Step 1: Turn the current artifact side panel into a generalized dock**

Refactor `ChatBox` so the right-side resizable panel hosts a tabbed workspace dock instead of a single artifacts panel.

Target tabs:
- `Preview`
- `Design`
- `Runtime`
- `Files`

**Step 2: Mount the dock at both lead-agent and named-agent chat routes**

Use the same dock shell on:
- `/workspace/chats/[thread_id]`
- `/workspace/agents/[agent_name]/chats/[thread_id]`

Do not fork the UI stack by agent type.

**Step 3: Keep artifact/file preview as a first-class tab**

Move the current artifact panel behavior under the new `Files` / `Preview` tabs so existing PDF, ONLYOFFICE, and markdown preview flows remain available while the dock architecture expands.

The dock should continue to derive file handling from existing outputs and file types rather than from a separate workspace metadata response.

**Step 4: Add empty/loading states per surface**

Each tab must explain why it is empty:
- no thread yet
- no runtime session yet
- no design board session yet
- no selected file or artifact

### Task 4: Add Design Context To The Dock And Launch Full Editor In A Tab

**Files:**
- Create: `frontend/app/src/components/workspace/surfaces/design-surface-panel.tsx`
- Create: `frontend/app/src/core/design-board/embed.ts`
- Modify: `frontend/app/src/core/design-board/api.ts`
- Modify: `frontend/app/src/core/design-board/hooks.ts`
- Modify: `backend/gateway/internal/handler/design_board.go`
- Modify: `backend/gateway/internal/handler/design_board_test.go`
- Modify: `backend/gateway/internal/service/design_board_service.go`

**Step 1: Add a design-session bootstrap flow for host + tab usage**

Extend the design-board open flow so the frontend can request a session for both:
- a compact thread-local design context panel
- a full OpenPencil editor tab

The gateway response should remain thread-scoped and should continue to preserve the canonical target path under `/mnt/user-data/authoring/designs/...`.

**Step 2: Reuse the current design-session response shape**

Do not expand design-board APIs for file discovery. Reuse the current session response and derive any display naming from `target_path` on the frontend.

**Step 3: Build the dock-side design context panel**

Create a panel that renders:
- compact design status/preview surface
- target file label
- revision/sync status
- reopen/full-tab action
- optional lightweight thumbnail or snapshot if available

**Step 4: Keep optimistic-concurrency semantics visible**

Use the existing revision contract from `DesignBoardService` to surface clear UI states for:
- synced
- saving
- stale/reload needed
- revision conflict

### Task 5: Add A Host Bridge Between Full-Tab OpenPencil And Deer Flow

**Files:**
- Modify: `/root/project/ai/openpencil/apps/web/src/utils/design-bridge.ts`
- Create: `/root/project/ai/openpencil/apps/web/src/utils/host-bridge.ts`
- Modify: `/root/project/ai/openpencil/apps/web/src/stores/canvas-store.ts`
- Modify: `/root/project/ai/openpencil/apps/web/src/components/editor/editor-layout.tsx`
- Modify: `/root/project/ai/openpencil/apps/web/src/hooks/use-design-bridge-document.ts`

**Step 1: Introduce explicit host messaging**

Add a small host bridge in OpenPencil that posts structured messages back to Deer Flow when bridge mode is active.

Required message types:
- `design.selection.changed`
- `design.document.loaded`
- `design.document.saved`
- `design.document.dirty`

**Step 2: Publish selection state from the canvas store**

Subscribe to `useCanvasStore().selection` and emit:
- `selectedIds`
- `activeId`
- optional node labels/names if cheaply available
- target path

This must be event-driven rather than polled.

**Step 3: Publish save/dirty lifecycle**

Emit host messages when the full editor:
- loads a document
- becomes dirty
- saves successfully
- encounters a bridge save error

This allows Deer Flow to reflect design status inline in chat and in the dock header.

**Step 4: Keep bridge mode isolated**

Do not change standalone OpenPencil behavior. The host bridge should activate only when the design token/session is present.

### Task 6: Feed Design Selection Into The Composer And Runtime Request Context

**Files:**
- Create: `frontend/app/src/components/workspace/surfaces/design-selection-chips.tsx`
- Modify: `frontend/app/src/components/workspace/input-box.tsx`
- Modify: `frontend/app/src/components/workspace/chats/new-chat-sender.tsx`
- Modify: `frontend/app/src/app/workspace/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/app/workspace/agents/[agent_name]/chats/[thread_id]/page.tsx`
- Modify: `frontend/app/src/components/workspace/messages/context.ts`
- Modify: `frontend/app/src/core/threads/hooks.ts`

**Step 1: Render visible selection chips above the composer**

Show the current explicit edit target, for example:
- selected node count
- target file
- short labels for 1-3 selected nodes

Allow quick clear/deselect from the host UI.

**Step 2: Merge selection context into message submission**

Whenever the user submits while a design selection is active, attach structured `selection_context` and `surface_context` to `extraContext`.

Do not parse user prose to infer "selected area"; use only explicit bridge state.

**Step 3: Preserve slash-command and command-context behavior**

Selection context must coexist with existing slash-command extra context in `buildSubmitOptions()` and must not override explicit command routing fields.

**Step 4: Keep the contract generic**

Name the fields in a way that can later support runtime/browser or file-based selections too, rather than baking OpenPencil-only assumptions into the shared thread submission path.

### Task 7: Add Runtime Context To The Dock And Launch Full Runtime In A Tab

**Files:**
- Create: `frontend/app/src/components/workspace/surfaces/runtime-surface-panel.tsx`
- Create: `frontend/app/src/core/runtime-workspaces/state.ts`
- Modify: `frontend/app/src/core/runtime-workspaces/api.ts`
- Modify: `frontend/app/src/core/runtime-workspaces/hooks.ts`
- Modify: `frontend/app/src/components/workspace/workspace-header.tsx`

**Step 1: Add a runtime context host panel**

Render a thread-local runtime context panel in the dock instead of making popup opening the primary path.

Surface-level UI should show:
- session state
- last-opened status
- target URL or runtime path when available
- reopen/full-tab action
- optional compact live view or latest screenshot when available

**Step 2: Reuse current session bootstrap API**

Keep the existing `openRuntimeWorkspace()` backend contract as the source of truth. Wrap it in panel state rather than inventing a second open flow or a separate workspace-file response.

**Step 3: Make runtime-space status visible in thread UI**

Expose whether the runtime surface is:
- idle
- opening
- active
- failed

Use this state in the header and inline action cards so the user can understand where the agent is acting.

**Step 4: Preserve remote-backend boundaries**

Do not pretend remote sessions are embeddable if the current runtime contract does not support them. The plan should keep a clear "open externally only" fallback for remote until a real embed contract exists.

### Task 8: Show Agent Activity Inline Like A Task Workspace, Not A Tool Log

**Files:**
- Create: `frontend/app/src/components/workspace/messages/workspace-event-card.tsx`
- Modify: `frontend/app/src/components/workspace/messages/message-list.tsx`
- Modify: `frontend/app/src/components/workspace/messages/message-list-item.tsx`
- Modify: `frontend/app/src/components/workspace/messages/message-group.tsx`
- Modify: `backend/agents/src/observability/callbacks.py`
- Modify: `backend/agents/src/client.py`

**Step 1: Define a small set of workspace event payloads**

Add normalized client-visible events for:
- design selection updates
- design save/reload status
- runtime workspace open/status changes
- preview/file reveal actions

Keep them orthogonal to low-level tool traces.

**Step 2: Render inline task-state cards in the message stream**

Show concise state cards like:
- "Editing selected hero section"
- "Design board saved"
- "Runtime workspace opened"
- "Preview updated"

These cards should feel like a workspace timeline, not raw middleware chatter.

**Step 3: Avoid semantic inference in middleware**

Only render these cards from explicit event payloads or explicit host-bridge messages. Do not inspect arbitrary assistant prose to guess what happened.

### Task 9: Rework File/Preview Surfaces Around The New Dock

**Files:**
- Modify: `frontend/app/src/components/workspace/artifacts/context.tsx`
- Modify: `frontend/app/src/components/workspace/artifacts/artifact-file-detail.tsx`
- Modify: `frontend/app/src/components/workspace/artifacts/artifact-file-list.tsx`
- Modify: `frontend/app/src/components/workspace/artifacts/artifact-trigger.tsx`
- Modify: `frontend/app/src/components/workspace/citations/citation-link.tsx`

**Step 1: Downgrade `ArtifactsContext` from workspace owner to file-preview owner**

Keep it focused on:
- selected file
- preview reveal target
- file-list open state within the dock

Move cross-surface state into the new workspace surface provider.

**Step 2: Route artifact reveals into dock tabs**

When citations or tool outputs reveal a file, switch the workspace dock to:
- `Preview` when the current file has a rich preview
- `Files` when the current target is a list selection

**Step 3: Preserve current document-preview regressions tests**

Existing knowledge, PDF, markdown, and ONLYOFFICE preview expectations must still pass after the surface rework.

### Task 10: Verify Manus-Style Hybrid Workspace Behavior On The Real Stack

**Files:**
- Create: `frontend/app/e2e/manus-workspace-alignment.spec.ts`
- Modify: `frontend/app/src/components/workspace/chats/chat-box.test.tsx`
- Modify: `frontend/app/src/components/workspace/artifacts/context.test.tsx`
- Modify: `backend/gateway/internal/handler/design_board_test.go`
- Modify: `backend/agents/tests/test_tool_runtime_context.py`

**Step 1: Add targeted frontend component coverage**

Cover:
- dock tab switching
- selection chips
- header surface status
- fallback behavior when no design/runtime session exists

**Step 2: Add integration coverage for design context submission**

Verify that a selected design region produces structured thread extra context and does not rely on free-form user text.

**Step 3: Add e2e coverage for the workspace flow**

Validate on the browser stack:
1. open an existing thread
2. open the workspace dock
3. switch to Design tab
4. open the full OpenPencil editor tab from the dock
5. select a node in OpenPencil
6. confirm chips appear above the composer in the thread page
7. send a follow-up edit request
8. see the design save/update reflected in the dock
9. switch to Runtime tab and verify runtime panel state is visible

**Step 4: Run the required real-stack checks**

Use the repo-required verification path:
- headed browser flow on `http://localhost:3000`
- user-facing current-code verification on `http://127.0.0.1:8083`
- agent/admin audit on `http://localhost:5173`

### Task 11: Roll Out In Controlled Stages

**Files:**
- Modify as needed after verification: files above
- Document final UX if needed: `docs/guides/` or `docs/architecture/`

**Step 1: Land the workspace shell before the host bridge**

Ship the dock and tab system first so Preview/Files continue to work even before Design and Runtime achieve full Manus-style parity.

**Step 2: Enable full-tab Design second**

Turn on the full OpenPencil tab flow after the host bridge can safely report selection and save states back into the thread.

**Step 3: Enable runtime full-tab workflow third**

Only make the runtime tab the default heavy-operation path when session bootstrap and current-code browser verification are stable enough.

**Step 4: Keep popup escape hatches during rollout**

Do not delete the external-open actions until:
- design embed is stable
- runtime embed is stable
- headed browser verification passes repeatedly

---

## Review Checkpoints

Before implementation, confirm these product decisions:

1. The right-side dock becomes the default context surface for Design and Runtime, while heavyweight editing opens in full tabs.
2. Design selection is represented as explicit chips in the composer, not hidden state.
3. Runtime tab initially focuses on visibility and status, not full human takeover controls.
4. `ArtifactsContext` is reduced in scope instead of expanded into a catch-all workspace bus.
5. OpenPencil host-bridge work in `/root/project/ai/openpencil` is an explicit part of this alignment plan, not an implicit follow-up.

## External References

- Manus Design View: `https://manus.im/blog/manus-design-view`
- Manus Editing & Previewing: `https://manus.im/docs/website-builder/editing-and-previewing`
- Manus Cloud Browser: `https://manus.im/docs/features/cloud-browser`
- Manus Skills: `https://manus.im/blog/manus-skills`
