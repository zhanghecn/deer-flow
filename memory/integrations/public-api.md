# Public API Integration Memory

## Native Contract

- OpenAgents' first-class external integration contract is native HTTP
  `/v1/turns` with SSE plus `GET /v1/turns/{id}` for final state convergence.
- TS/Python/Java helpers should stay thin wrappers around that contract and must
  not define a second event semantics layer.
- Source: migrated from `.omx/project-memory.json`;
  [docs/testing/README.md](/root/project/ai/deer-flow/docs/testing/README.md).

## Streaming Client Requirements

- Streaming clients must preserve whitespace.
- Token or cumulative deltas must merge into stable assistant content instead of
  fragmenting into many cards.
- Reasoning should accumulate into one live block.
- Tool calls should show method name and parameters.
- Failures must be visible to the user.
- Final UI state should converge on `assistant.message.completed` and
  `GET /v1/turns/{id}`.

## Verification Bar

- Any change to external chat contract, streaming client behavior, downloadable
  integration guidance, or demo pages needs:
  - automated tests for the changed path
  - a real published `/v1/turns` run
  - `8081/observability` evidence for the same run
  - a product or demo UI surface that displays or uses the result
