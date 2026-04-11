# 2026-03-29 Model Conflict Refresh Audit

## Scope

- stale frontend local settings carrying deprecated `model_name`
- refresh behavior on existing custom-agent thread
- runtime request-header seeding vs persisted thread runtime binding

## Environment

- Date: 2026-03-29
- App URL: `http://localhost:3000`
- Admin URL: `http://localhost:5173`
- Account: `admin` / `admin123`
- Current-code verification:
  - `frontend/app` Vite dev server was already serving the current working tree
  - `backend/agents` runtime on `:2024` was not reload-enabled, so it was restarted to pick up the current code before validation

## Browser Flow

### Reproduction setup

1. Logged into `http://localhost:3000`.
2. Forced browser local storage key `openagents.local-settings` to:
   - `context.model_name = "kimi-k2.5-1"`
3. Opened existing custom-agent thread:
   - agent: `contract-review-ui-mnbmexuu`
   - thread: `ba721157-5458-4aa5-9d30-cd50c55329ca`

### Expected

- thread page should load without `400 Model conflict`
- stale local model should not override the thread/agent runtime binding
- frontend local settings should converge back to canonical `kimi-k2.5`
- sending a new message on the refreshed thread should succeed

### Result

- Passed.
- Thread load requests stayed `200 OK`.
- No browser console errors.
- No `Model conflict` toast or network failure appeared.
- Local storage was normalized back to `kimi-k2.5`.
- Submitted follow-up message `请回复“收到”，无需展开。`
- Assistant responded `收到`.

## Network Audit

Observed successful requests after refresh:

- `GET /api/threads/ba721157-5458-4aa5-9d30-cd50c55329ca/runtime`
- `GET /api/agents/contract-review-ui-mnbmexuu?status=dev`
- `POST /api/langgraph/threads/ba721157-5458-4aa5-9d30-cd50c55329ca/history`
- `GET /api/langgraph/threads/ba721157-5458-4aa5-9d30-cd50c55329ca/state?subgraphs=true`
- `POST /api/langgraph/threads/ba721157-5458-4aa5-9d30-cd50c55329ca/runs/stream`

No `400` responses were observed in the reproduced refresh + submit path.

## 5173 Audit

- Logged into `http://localhost:5173`.
- Opened `Observability`.
- Latest trace entry for the reproduced thread showed:
  - agent: `contract-review-ui-mnbmexuu`
  - prompt: `请回复“收到”，无需展开。`
  - thread mask: `ba7211****29ca`
  - model: `kimi-k2.5`

This confirmed the current trace used the canonical model after the stale local setting was injected.

## Gaps

- This audit focused on the custom-agent refresh conflict path, not full knowledge-base retrieval behavior.
- No additional legacy local-storage variants beyond `kimi-k2.5-1` were tested.

## Knowledge Base Follow-Up

## Scope

- thread-bound knowledge-base attachment as the only chat source of truth
- refresh persistence for attach and detach flows
- real knowledge retrieval path after removing hidden attached-document prompt injection

## Environment

- Date: 2026-03-29
- App URL: `http://localhost:3000`
- Admin URL: `http://localhost:5173`
- Account: `admin` / `admin123`
- Current-code verification:
  - `frontend/app` Vite dev server on `:3000` served the current working tree
  - `backend/agents` runtime on `:2024` was restarted again after removing hidden document-list prompt injection from `knowledge_context_middleware`
  - `:2024` / `:2025` were confirmed to be served by pid `1224337`

## Tested Knowledge Base

- Knowledge base: `中文合同陷阱全集_1774787043568`
- Documents exercised from the real UI:
  - `02_租赁合同_重庆.pdf`
  - thread-level attached document listing for the full base

## Browser Flow

### Attach / Refresh / Detach

1. Opened `http://localhost:3000/workspace/chats/new?agent_status=dev`.
2. Attached `中文合同陷阱全集_1774787043568` from the real selector dialog.
3. Verified the composer showed `1 knowledge base` and the attachment strip showed `1 attached base`.
4. Refreshed the page and confirmed the attachment strip still showed the same attached base.
5. Clicked the inline `Detach` action from the strip.
6. Verified the selector returned to `Knowledge` and the attachment strip disappeared.
7. Refreshed again and confirmed the detached state persisted.

### Agent Usage

1. Reattached `中文合同陷阱全集_1774787043568`.
2. Asked:
   - `请审查知识库中的《02_租赁合同_重庆.pdf》，总结其中最值得承租人关注的三个风险点，并分别说明你依据了哪些条款或页面。`
3. Result:
   - Passed.
   - The chat UI showed `Use "get_document_evidence" tool`.
   - The answer cited grounded page links including:
     - `02_租赁合同_重庆.pdf p.2`
     - `02_租赁合同_重庆.pdf p.3`
   - The answer stayed attached to the same thread-bound knowledge base throughout the run.

### Hidden Prompt Regression Check

1. Restarted `:2024` after removing the hidden attached-document payload from `knowledge_context_middleware`.
2. Opened a fresh new chat and reattached `中文合同陷阱全集_1774787043568`.
3. Asked:
   - `请先列出当前挂载知识库中的全部文档名称，然后推荐最值得优先审查的两份，并说明理由。`
4. Result:
   - Passed.
   - The chat UI showed the legacy knowledge-document listing tool.
   - This confirmed the model no longer had a second hidden path for attached document names and had to use the then-canonical discovery tool.

## 5173 Audit

- Logged into `http://localhost:5173`.
- Opened `Observability`.
- Audited trace for thread `1dac7936-8b9b-4533-b78b-930ba5fc994f`:
  - observed `requested tool: get_document_tree`
  - observed `Tool · get_document_tree`
  - observed `requested tool: get_document_evidence`
  - observed `Tool · get_document_evidence`
  - no broad spill or raw file/search bypass was used in this review flow
- Audited trace for thread `b0789d1d-2bcf-4a5f-86c7-c0e5eab79e82` after the middleware cleanup:
  - observed `requested tool: legacy knowledge-document listing tool`
  - observed `Tool · legacy knowledge-document listing tool`
  - this verified the document-discovery path now goes through the tool rather than hidden prompt state
- Audited trace for thread `be1736f3-65ec-491e-bd85-7fc3d59af71e` after the default tool cleanup:
  - registered tools included the legacy knowledge-document listing tool plus `get_document_tree`, `get_document_evidence`, `get_document_image`
  - registered tools no longer included `get_document_tree_node_detail`
  - observed `requested tool: legacy knowledge-document listing tool`

## Result

- Passed for the tested scenarios.
- Chat knowledge-base selection is now persisted only through thread bindings.
- Refresh preserves both attached and detached states.
- Real answers use grounded knowledge tools and user-visible citations.
- The hidden attached-document prompt payload was removed, eliminating the redundant document-discovery path.

## Remaining Gaps

- The current environment only exposed one ready knowledge base in the selector, so cross-base switching between two ready bases was not covered in this pass.
- This pass did not recreate the full upload/build-progress flow from scratch after the middleware cleanup because the existing ready base was sufficient to verify retrieval behavior.
