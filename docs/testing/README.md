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
