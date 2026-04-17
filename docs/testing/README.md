# Testing Index

This directory is the repository-level index for manual, browser, and
audit-oriented testing.

Use it when:

- knowledge-base flow changes
- citation or preview rendering changes
- agent tool-usage behavior changes
- runtime integration changes that can pass unit tests but fail in the real UI
- native `/v1/turns` contract or streaming client behavior changes

Knowledge-base testing entrypoints:

- [Knowledge Base Test Spec](./knowledge-base/TEST_SPEC.md)
- [Knowledge Base Pitfalls](./knowledge-base/PITFALLS.md)
- [Knowledge Base Real-World Results](./knowledge-base/results/)

Minimum expectation before marking a knowledge-base task as tested:

1. Relevant unit, integration, or API tests pass.
2. Headed browser test is executed on `http://127.0.0.1:8083`.
3. Agent internal audit is executed from the admin surface on
   `http://127.0.0.1:8081`.
4. If the long-running app stack is not the current code, a sidecar
   verification run must be recorded separately.

## Production-Style Docker Verification

When the task needs current-code verification in a containerized stack, the
repository default is:

1. Use `docker/docker-compose-prod.yaml`
2. Bring it up with
   `docker compose -f docker/docker-compose-prod.yaml up -d --build`
3. Verify the browser flow on `http://127.0.0.1:8083`
4. Record clearly that the result came from the prod-style compose stack rather
   than the long-running dev stack

This is the default answer to “how do we re-test the production environment
with Docker?” unless a task explicitly requires another stack.

## Native `/v1/turns` External Integration Verification

When the task touches the OpenAgents external chat contract, streaming client
behavior, demo pages, or downloadable integration guidance, treat the
following as the minimum real-test bar:

1. Unit, integration, or API tests for the changed contract path pass.
2. A real run is triggered against published `/v1/turns`.
3. The run is visible in `http://127.0.0.1:8081/observability`.
4. The same run is visible or usable in a real UI:
   - `http://127.0.0.1:8083` for product surfaces
   - a standalone external page is allowed as additional evidence, not as the
     only evidence
5. Streaming verification checks all of:
   - assistant text accumulates instead of fragmenting into many cards
   - reasoning accumulates into one live block
   - tool calls show method name and parameters
   - failures are visible to the user
