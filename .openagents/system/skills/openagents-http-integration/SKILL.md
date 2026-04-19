---
name: openagents-http-integration
description: Helps users integrate published OpenAgents agents through the native HTTP contract instead of a product-specific SDK. Use this whenever the task is about connecting a website, support chat, backend service, mobile app, automation script, or customer system to an OpenAgents agent with `/v1/turns`; designing the request and streaming flow; handling `previous_turn_id`; explaining supported features such as blocking calls, SSE, files, structured output, and artifacts; recommending production-safe integration patterns; or generating a small working project that demonstrates the HTTP integration end to end.
---

# OpenAgents HTTP Integration

Use this skill when the user wants a real integration plan or a working project that talks to a published OpenAgents agent over HTTP.

## Core stance

- Default to the native `/v1/turns` contract.
- Do not push a custom SDK unless the user explicitly asks for one.
- Treat the HTTP contract as the source of truth for connection guidance, examples, testing, and troubleshooting.
- Prefer minimal working integrations that a customer team can copy into their own stack quickly.

## What to identify first

Before giving instructions or generating code, identify:

1. The published `agent` name
2. The user-provided `base_url`
3. The user-provided bearer `user_key`
4. Whether they need blocking, streaming, or both
5. Whether they need browser UI, backend service code, or a mixed architecture
6. Whether they need file upload, structured output, follow-up turns, or artifact download

## Required references

- Read `references/turns-contract.md` for the request, response, and event contract.
- Read `references/http-examples.md` for working examples.
- Read `references/implementation-guide.md` for architecture guidance and feature recommendations.
- Read `references/testing-checklist.md` when the user asks for acceptance, rollout, or customer handoff guidance.

## How to answer

- Treat `base_url` and `user_key` as required inputs for runnable integration guidance.
- If either `base_url` or `user_key` is missing, ask the user to provide it before generating production-ready code.
- Do not invent deployment URLs, default hosts, demo credentials, or placeholder secrets as if they are known environment values.
- Start from the smallest successful path:
  - one published agent
  - one user-provided bearer key
  - one blocking or streaming request to `/v1/turns`
- When the task includes a browser page, acceptance console, support chat UI, or any user-facing frontend deliverable:
  - apply the `frontend-design` skill expectations as well as this HTTP integration skill
  - treat the browser artifact as a final deliverable, not a scratch prototype
- When the user wants a project, create a minimal but usable structure:
  - `index.html` or framework entry
  - a single integration module for HTTP calls
  - clear rendering for assistant text, reasoning, and tool-call steps
  - a short usage note in the code comments if needed
  - keep deployment addresses configurable; never hardcode a host, port, or environment-specific admin URL into generated customer code
  - normalize `base_url` into one canonical API root so both `http://host` and `http://host/v1` work correctly
  - build endpoint helpers that always call `/v1/turns` and `/v1/turns/{id}` explicitly instead of concatenating ad hoc strings
  - keep HTML valid and input labels obvious enough for a customer tester to use without reading the code
  - if the project is a static browser demo, write the final files under `/mnt/user-data/outputs/<project-name>/`
  - if the project has multiple files, keep `index.html`, `app.js`, and `styles.css` together under that output directory
  - after writing the final artifact, call `present_files` on `/mnt/user-data/outputs/<project-name>/index.html`
- When the user wants streaming UI behavior, explain and implement it as one accumulating conversation:
  - append `assistant.text.delta` into one growing assistant response
  - append `assistant.reasoning.delta` into one growing reasoning area
  - display `tool.call.started` with method name and parameters
  - display `tool.call.completed` with method name and returned payload
  - finalize from `GET /v1/turns/{id}` when the UI needs a stable final record
- When the user wants multi-turn chat, preserve the latest `turn_id` and send it back as `previous_turn_id`.
- When the user wants production guidance, recommend server-side key custody by default. Browser-side direct calls are for demos or controlled internal tools unless the deployment intentionally accepts that risk.

## Feature checklist to cover when relevant

- Blocking request flow
- SSE streaming flow
- `previous_turn_id` follow-up turns
- `thinking.enabled` and `thinking.effort`
- `text.format` structured output
- uploaded file ids in `input.file_ids`
- artifacts returned from completed turns
- failure handling for HTTP errors, `turn.failed`, and `turn.requires_input`

## Output shape

When giving integration guidance, prefer this structure:

1. Connection contract
2. Supported features relevant to the task
3. Recommended architecture
4. Minimal request example
5. Streaming or follow-up-turn handling if relevant
6. Testing and acceptance checklist

## Project generation guardrails

When generating a runnable demo project, make these checks part of the implementation instead of leaving them implicit:

- `base_url` input must accept both `http://host` and `http://host/v1`
- `base_url` and `user_key` must come from explicit user input, config, or environment before the demo is considered runnable
- deployment origin must come from user input, config, or environment; use the provided `base_url` as the source of truth instead of hardcoding any fallback host
- the request builder must resolve to a canonical API root before appending `/turns`
- the UI must surface HTTP failures before a turn exists
- the UI must surface `turn.failed` and `turn.requires_input` after streaming starts
- tool-call rendering must show method name plus serialized parameters or output
- follow-up turns must reuse the latest stable `turn_id` from the finalized snapshot
- final previewable files must live under `/mnt/user-data/outputs/<project-name>/`, not only under another `user-data` subdirectory
- if `index.html` references `styles.css` or `app.js`, those files must exist in the same output directory before finishing
- keep the integration script simple enough to validate in one pass; avoid placeholder monkey-patching or duplicate competing flows
- run a basic syntax sanity check for generated JavaScript when possible, such as `node --check /mnt/user-data/outputs/<project-name>/app.js`
- do not mark the task complete until the main preview file exists and has been presented
