# Implementation Guide

Use this reference when the user needs architecture recommendations, a project skeleton, or feature guidance.

## Recommended integration shapes

### 1. Server-side proxy

Use this by default for production systems.

Benefits:

- keeps the bearer key out of the browser or mobile app
- centralizes retries, logging, and policy checks
- lets the customer team own rate limits and request auditing

### 2. Browser-side direct call

Use this for:

- internal demos
- short-lived testing tools
- acceptance consoles
- controlled environments where exposing the key is an intentional choice

If you recommend this path, say explicitly that it is not the default production posture.

## Minimal project structure

When generating a small integration project, prefer:

```text
project/
  index.html
  app.js
  styles.css
```

or, for a server-backed project:

```text
project/
  server.js
  public/index.html
  public/app.js
```

Keep the contract logic in one integration module instead of scattering request code across the UI.

For a browser-deliverable demo that the first-party workspace should preview directly, the final layout must be:

```text
/mnt/user-data/outputs/<project-name>/
  index.html
  app.js
  styles.css
```

Do not leave the final artifact only under another ad hoc `/mnt/user-data/<name>/` folder. The workspace artifact preview contract only guarantees discovery and serving from `/mnt/user-data/outputs/...`.

## Project generation guardrails

When you generate a runnable demo or starter project, preserve these contracts in code:

- normalize `base_url` once so both `http://host` and `http://host/v1` resolve to one canonical API root
- build `/turns` and `/turns/{id}` from that canonical root instead of concatenating conditionally in multiple places
- keep one accumulating assistant answer block and one accumulating reasoning block
- render tool calls as explicit step rows with method name plus serialized arguments or output
- fetch the final turn snapshot and only then persist `previous_turn_id`
- show pre-turn HTTP errors separately from streamed `turn.failed` errors

## Features to recommend

Recommend only the features the user will actually use:

- blocking requests for simple server-side workflows
- SSE for live chat or operator consoles
- `previous_turn_id` for follow-up questions
- `thinking.enabled` only when the UI is ready to display reasoning safely
- file upload only when the task truly needs external documents
- structured output only when a downstream system consumes JSON directly

## UI recommendations

For a customer-support style chat UI:

- keep one assistant message that grows during streaming
- keep one reasoning panel that grows during streaming
- keep tool-call steps in a compact timeline
- surface request failure clearly
- persist the last successful `turn_id`
- provide a reset-session action that clears `previous_turn_id`

## Operational recommendations

- log request ids, turn ids, and failure payloads
- treat `turn.requires_input` as an explicit workflow state
- fetch the final turn snapshot before storing a completed chat record
- avoid mixing internal undocumented fields into the northbound integration
- when the deliverable is a static frontend, verify that every referenced sibling asset exists and that the main JavaScript passes a syntax check before presenting it
