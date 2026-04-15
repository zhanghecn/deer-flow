# Lead Agent Create/Publish/Public API Real Test

Date: 2026-04-14

## Scope

Validate the real user flow where `lead_agent` creates an agent, the resulting
agent can be managed/published by the creating user, and the published public
API works end to end.

## Environment

- Browser entrypoint: `http://127.0.0.1:8083`
- Stack: `docker/docker-compose-prod.yaml`
- Runtime services rebuilt/restarted from current code before final verification:
  - `langgraph`
  - `gateway`
  - `nginx`

## Findings

### 1. Draft-agent docs loading behavior

For a draft-only agent such as `md-summary-agent`:

- `GET /open/agents/md-summary-agent/export` returned `404 {"error":"agent not found"}`
- Browser docs page stayed on the loading state before falling through to the
  failed-public-docs path

This confirms public docs/export only support `prod` agents.

### 1.1 Current-code retest after frontend fast-fail fix

The first draft-docs browser result above came from an older frontend bundle on
`:8083`, not from the latest working tree changes. After rebuilding the
production-style compose stack from current code:

```bash
docker compose -f docker/docker-compose-prod.yaml up -d --build nginx
```

Real browser retest results for the draft-only `md-summary-agent` were:

- `/docs/agents/md-summary-agent`
- `/docs/agents/md-summary-agent/reference`
- `/docs/agents/md-summary-agent/playground`

Observed behavior:

- each page made exactly one `GET /open/agents/md-summary-agent/export`
  request
- each request returned `404`
- the page no longer retried exponentially
- the page surfaced the explicit message:
  `Published agent docs are only available after the agent is published to prod.`

This confirms the current-code frontend fast-fail fix works as intended. The
earlier "stays loading" report was caused by testing against a stale bundle.

### 2. Root cause of lead-agent-created ownerless agents

`lead_agent` could create a dev agent, but the resulting manifest did not carry
`owner_user_id`, so the creating user saw `can_manage=false` and publish failed.

### 3. Post-fix real browser result

Using the real browser flow on `/workspace/agents/new`, `lead_agent` created:

- `lead-owned-e2e-agent-3`

After the fix:

- `GET /api/agents/lead-owned-e2e-agent-3` returned:
  - `owner_user_id` present
  - `owner_name = "Real Test User"`
  - `can_manage = true`

Publish then succeeded:

- `POST /api/agents/lead-owned-e2e-agent-3/publish`
- result status: `prod`

### 4. Public docs/export/openapi result

For the published `lead-owned-e2e-agent-3`:

- `GET /open/agents/lead-owned-e2e-agent-3/export` returned `200`
- `GET /open/agents/lead-owned-e2e-agent-3/openapi.json` returned `200`

Export summary:

```json
{
  "agent": "lead-owned-e2e-agent-3",
  "status": "prod",
  "api_base_url": "http://127.0.0.1:8083/v1",
  "documentation_url": "http://127.0.0.1:8083/docs/agents/lead-owned-e2e-agent-3",
  "openapi_url": "http://127.0.0.1:8083/open/agents/lead-owned-e2e-agent-3/openapi.json"
}
```

### 5. Public API smoke test result

Created a scoped API token for `lead-owned-e2e-agent-3` and ran:

- `GET /v1/models`
- blocking `POST /v1/responses`
- tool-using blocking `POST /v1/responses`
- streaming `POST /v1/responses`

Result: PASS

Observed run event types:

- blocking: `run_started`, `assistant_delta`, `assistant_delta`, `assistant_message`, `run_completed`
- tool blocking: `run_started`, `tool_started`, `tool_finished`, `assistant_delta`, `assistant_delta`, `assistant_delta`, `assistant_message`, `run_completed`
- streaming: `run_started`, `assistant_delta`, `assistant_delta`, `assistant_message`, `run_completed`
- question blocking: `run_started`, `tool_started`, `tool_finished`, `question_requested`
- question streaming: `run_started`, `tool_started`, `tool_finished`, `question_requested`

### 5.1 Phase-2 current-code retest after runtime/gateway event-spine work

After the current QueryEngine/canonical-event scaffolding and gateway collector
updates, the current-code stack was rebuilt again and the public API smoke test
was rerun.

Result:

- PASS
- tool-using public runs still complete successfully
- `tool_started` / `tool_finished` appear in `openagents.run_events` for a real
  public `/v1/responses` call against `lead-owned-e2e-agent-3`

Concrete tool-run event sequence:

```json
[
  "run_started",
  "tool_started",
  "tool_finished",
  "assistant_delta",
  "assistant_delta",
  "assistant_delta",
  "assistant_message",
  "run_completed"
]
```

The first Phase-2 retest briefly showed duplicated `tool_started` /
`tool_finished` events because the gateway collector was consuming both legacy
message-derived tool lifecycle and runtime custom execution events. The current
collector now treats runtime custom execution events as the canonical tool
lifecycle source, and the deduplicated sequence above is the current-code
verified result.

### 5.2 Question-request public flow

Current-code retest also verified the public question flow against
`lead-owned-e2e-agent-3`.

When the published agent is forced to call the `question` tool:

- blocking `/v1/responses` now returns `status = "incomplete"` instead of a
  synthetic runtime failure
- blocking `openagents.run_events` contains:

```json
[
  "run_started",
  "tool_started",
  "tool_finished",
  "question_requested"
]
```

- streaming `/v1/responses` emits the same event sequence and stops after
  `question_requested`
- the earlier false terminal event
  `run_failed: assistant response text was not found in thread state`
  no longer appears

### 5.3 Public playground browser result for incomplete question runs

After rebuilding the current-code frontend, the public docs playground for
`lead-owned-e2e-agent-3` was exercised in the browser with a blocking request
that forces the `question` tool.

Observed UI result:

- timeline shows `run_started`
- timeline shows `Tool calls` / `Tool result: question`
- timeline shows `Question requested`
- terminal timeline item reads:
  `Response is waiting for user input: <response_id>`
- result panel shows `Status = incomplete`
- the page no longer labels that blocking run as completed

## Commands / Evidence

Backend regression:

```bash
cd backend/agents
uv run pytest tests/test_tool_runtime_context.py -k 'setup_agent_accepts_typed_runtime_context or falls_back_to_thread_owner'
uv run pytest tests/test_agent_materialization_paths.py -k owner_user_id
```

Public API smoke:

```bash
OPENAGENTS_PUBLIC_API_KEY='<scoped key>' \
OPENAGENTS_PUBLIC_API_MODEL='lead-owned-e2e-agent-3' \
python scripts/real_browser_public_api_test.py
```

## Conclusion

The intended real flow now works:

1. `lead_agent` creates the agent
2. created agent is owned by the creating user
3. creating user can publish it
4. published agent docs/export/openapi load correctly
5. published public API works end to end

## Additional Browser-Only Verification

### Browser-created user and agent

Using the real browser flow on `http://127.0.0.1:8083`:

- registered user:
  - `Real Browser User`
  - `realbrowser_1776214456@example.com`
- `lead_agent` created:
  - `browser-e2e-agent-1776214456`

Observed browser evidence:

- `/workspace/agents/new` ran the conversational `lead_agent` bootstrap flow
- after requirements clarification, the page showed `Agent created!`
- `/workspace/agents` listed `browser-e2e-agent-1776214456`
- access state was `Manage`
- browser click on `Publish to prod` moved it to `Published ready`

### Browser verification of the newly published agent docs

For the newly published `browser-e2e-agent-1776214456`:

- `/docs/agents/browser-e2e-agent-1776214456` loaded normally
- `/docs/agents/browser-e2e-agent-1776214456/reference` loaded normally
- `/docs/agents/browser-e2e-agent-1776214456/playground` loaded normally

For the draft-only `md-summary-agent`:

- `/docs/agents/md-summary-agent`
- `/docs/agents/md-summary-agent/reference`
- `/docs/agents/md-summary-agent/playground`

All three pages failed fast in the browser with the unpublished-agent message.

### Browser API key management

On `/workspace/keys` for `Real Browser User`:

- browser-created key:
  - name: `Browser QA Key`
  - allowed agent: `browser-e2e-agent-1776214456`

Observed browser result:

- key creation UI succeeded
- key inventory count increased from `0` to `1`
- the new key appeared in the table and could be copied from the browser UI
- refreshing `/workspace/keys` in the same browser session kept the user
  authenticated and preserved access to the page
- browser deletion of the created key reduced active-key count back to `0`

### Browser public playground validation

Published `lead-owned-e2e-agent-3` browser results:

- blocking text request succeeded
- blocking `JSON object` request succeeded
- blocking `JSON schema` request succeeded
- SSE tool request succeeded
- blocking question request showed waiting-for-input / `incomplete`
- SSE question request stopped at `question_requested`
- artifact-producing request showed:
  - `Generated file: browser_artifact.txt`
  - Files tab entry `browser_artifact.txt`
  - browser download of `browser_artifact.txt`

Published `browser-e2e-agent-1776214456` browser results:

- browser-created key worked against its own public playground
- prompt returned the agent's Chinese self-description
- after tightening the agent prompt, a second real browser SSE run produced:
  - `tool_started(question)`
  - `tool_finished(question)`
  - `question_requested`
- a real browser blocking run also produced:
  - `run_started`
  - `tool_started(question)`
  - `tool_finished(question)`
  - `question_requested`
  - `Response is waiting for user input: <response_id>`
  - `Status = incomplete`
- a real browser artifact-producing run produced:
  - `Generated file: browser_agent_artifact.txt`
  - final output `BROWSER_AGENT_ARTIFACT_OK`
- real browser file-upload flow succeeded:
  - selected `browser-upload-input.txt`
  - page showed `1 Files`
  - upload timeline showed `browser-upload-input.txt uploaded as file_<id>`
  - blocking run consumed the uploaded file and returned a Chinese summary of
    the file contents

Negative browser result:

- using the `browser-e2e-agent-1776214456` key against
  `lead-owned-e2e-agent-3` public playground failed with:
  - `api token is not allowed to access this agent`
- after deleting `Browser QA Key` in the real browser key manager, reusing that
  deleted key against `browser-e2e-agent-1776214456` public playground failed
  with:
  - `api token is disabled`

This confirms the browser-created key is scoped to exactly one published agent.

### Browser docs navigation

For the newly published `browser-e2e-agent-1776214456`, browser clicks on the
top-level docs navigation successfully traversed:

- Overview
- Playground
- API Reference

and returned back to Overview without leaving the published docs surface.

### Browser workspace question flow

On `/workspace/chats/new`, a real browser workspace chat forced the `question`
tool and produced:

- `Question from the agent`
- structured options `Code` and `Docs`
- browser submission of `Docs`
- follow-up assistant continuation:
  - `Got it — you want docs. What topic or project should the documentation cover?`

This confirms the workspace-side question dock accepts a real browser answer and
continues execution.

### Browser workspace artifact flow

On a real workspace chat, `lead_agent` was asked to create
`/mnt/user-data/outputs/workspace_browser_artifact.txt`.

Observed browser result:

- assistant confirmed file creation
- artifact card appeared with:
  - filename `workspace_browser_artifact.txt`
  - type `Text file`
  - `Download` action
- browser download succeeded:
  - `.playwright-cli/workspace-browser-artifact.txt`
- preview pane showed file content:
  - `WORKSPACE_BROWSER_OK`

### Browser workspace agent controls

For the newly created `browser-e2e-agent-1776214456`:

- browser click on `Settings` opened:
  - `/workspace/agents/browser-e2e-agent-1776214456/settings?agent_status=dev`
- browser click on `Start chatting` opened:
  - `/workspace/agents/browser-e2e-agent-1776214456/chats/new?agent_status=dev`

This confirms the new agent is not only listed and publishable, but also
reachable through its dedicated workspace control surfaces.

For `op-design-agent-614894`:

- browser click on `Start chatting` opened:
  - `/workspace/agents/op-design-agent-614894/chats/new?agent_status=dev`

### Browser consistency finding

On `/workspace/agents`, `op-design-agent-614894` was shown with:

- access label `Manage`
- actions including `Settings`, `Publish to prod`, and `Delete`

But on the real settings page:

- `/workspace/agents/op-design-agent-614894/settings?agent_status=dev`

the browser showed:

- `read only`
- `Management restricted`
- `Save is disabled because you do not have permission to manage this agent.`

This is a real browser-observed UI consistency issue between the gallery row and
the settings page permission messaging.

## Browser Coverage Summary

Real browser coverage completed for these core paths:

- browser registration and login
- `lead_agent` create-agent flow
- custom agent publish flow
- published docs / reference / playground pages
- draft docs fast-fail pages
- browser key creation / delete flow
- browser key refresh / persistence check
- public blocking / SSE / tool / question / artifact flows
- public `JSON object` / `JSON schema` flows
- public browser file-upload flow
- workspace question flow
- workspace artifact + preview + download flow
- workspace agent settings / start-chat routes
- workspace permission-state consistency issue captured
