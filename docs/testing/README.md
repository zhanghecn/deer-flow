# Testing Index

This directory is the repository-level index for manual, browser, and audit-oriented testing.

Use it when:

- knowledge-base flow changes
- citation / preview / asset rendering changes
- agent tool-usage behavior changes
- runtime integration changes that can pass unit tests but fail in the real UI

Knowledge-base testing entrypoints:

- [Knowledge Base Test Spec](./knowledge-base/TEST_SPEC.md)
- [Knowledge Base Pitfalls](./knowledge-base/PITFALLS.md)
- [Knowledge Base Real-World Results](./knowledge-base/results/)

Minimum expectation before marking a knowledge-base task as tested:

1. Relevant unit / integration / API tests pass.
2. Headed browser test is executed on `http://localhost:3000`.
3. Agent internal audit is executed on `http://localhost:5173`.
4. If the long-running app stack is not the current code, a sidecar verification run must be recorded separately.

## Production-Style Docker Verification

When the task needs current-code verification in a containerized stack, the repository default is:

1. Use `docker/docker-compose-prod.yaml`
2. Bring it up with `docker compose -f docker/docker-compose-prod.yaml up -d --build`
3. Verify the browser flow on `http://127.0.0.1:8083`
4. Record clearly that the result came from the prod-style compose stack rather than the long-running dev stack

This is the default answer to “how do we re-test the production environment with Docker?” unless a task explicitly requires another stack.
