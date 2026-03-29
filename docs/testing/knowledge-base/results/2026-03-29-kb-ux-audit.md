# 2026-03-29 Knowledge Base UX Audit

- Date: 2026-03-29
- URLs:
  - User app: `http://127.0.0.1:3000`
  - Gateway: `http://127.0.0.1:8001`
  - LangGraph runtime: `http://127.0.0.1:2024`
  - Admin / audit UI: `http://127.0.0.1:5173`
- Account:
  - `admin / admin123`
- Current listeners observed before verification:
  - `3000`: `node` PID `16689`
  - `8001`: `server` PID `433397`
  - `2024`: `python` PID `488563`
  - `5173`: `node` PID `17037`
- Current-code note:
  - This pass was executed against the live dev stack serving the current working tree. The frontend changes were visible immediately in the real UI during this audit.

## Documents Used

- `/root/project/ai/deer-flow/test-results/中文合同陷阱测试包/10_加盟合同陷阱分析_台湾公平会.pdf`

## Scope

- Knowledge-base upload dialog UX
- Visible model selection during KB creation
- Live attached-knowledge / build-status rendering in chat
- Attached knowledge restoration after page refresh

## Code-Level Baseline

- Passed:
  - `pnpm vitest run src/components/workspace/input-box.test.tsx src/components/workspace/knowledge/knowledge-base-upload-dialog.test.tsx src/components/workspace/knowledge/thread-knowledge-attachment-strip.test.tsx src/components/workspace/knowledge/knowledge-selector-dialog.test.tsx`
  - `pnpm exec tsc --noEmit`

## 3000 Headed-Flow Equivalent Verification

1. Logged into `http://127.0.0.1:3000/login`.
2. Opened the real chat composer upload flow from `/workspace/chats/new`.
3. Confirmed the upload dialog now shows an explicit `Index model` selector before creation.
4. Uploaded `10_加盟合同陷阱分析_台湾公平会.pdf`.
5. Created the knowledge base from the real dialog without using any direct API shortcut.
6. Verified the chat composer immediately showed:
   - `1 attached base`
   - base name `10_加盟合同陷阱分析_台湾公平会`
   - initial `Queued` status with progress UI
7. Waited for polling to update and confirmed the same strip transitioned to `Ready` without page refresh.
8. Reloaded the page on the same chat route and confirmed the attached-knowledge strip still showed the same knowledge base and status.
9. Re-opened the knowledge selector dialog after refresh and confirmed the uploaded document still appeared with the `Attached` badge.

## Agent Usage Verification

1. Stayed in the real chat flow on `3000`.
2. Asked: `总结这个加盟合同陷阱分析文档中最重要的三个风险点，并注明依据。`
3. Verified the run used the attached knowledge base successfully after the UI changes.
4. Verified the answer referenced the uploaded document and returned grounded citation links in the chat UI.

## 5173 Internal Audit

1. Logged into `http://127.0.0.1:5173/login`.
2. Opened `/observability`.
3. Selected the trace for thread `da9464bf-c783-4131-9a45-120f91db0f61`.
4. Verified the tool path shown in the audit UI was:
   - `list_knowledge_documents`
   - `get_document_tree`
   - `get_document_evidence`
5. Verified the trace did not regress to broad spill behavior first; it narrowed through tree lookup before evidence fetch.
6. Verified the final reasoning/output in the trace matched the audited document and the knowledge retrieval sequence above.

## Result

- Passed for this UX scope:
  - visible model selection exists in the real creation flow
  - attached knowledge / build state appears immediately after creation
  - attached knowledge survives page refresh in the chat UI
  - knowledge-backed answering still uses the expected KB tool path

## Known Gaps

- This pass focused on chat-side KB UX and thread-state restoration, not management-page create flow behavior.
- This pass used one PDF document. It did not repeat the same UX audit with Markdown or Word files because the code change was limited to frontend state/rendering rather than ingestion format handling.
