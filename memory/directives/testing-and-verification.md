# Testing And Verification Memory

## Real Product Testing

- Real verification for agent UX, knowledge-base, runtime integration,
  `/v1/turns`, preview, citation, and demo work must use the OpenAgents product
  path: `8083` user/product surface, `8081` observability trace, and product UI
  preview or interaction evidence.
- Host-only scripts, local debug files, static pages, or one-off probes are
  diagnostic evidence only. They are not final acceptance evidence by
  themselves.
- Source: migrated from `.omx/project-memory.json` and `.omx/notepad.md`;
  [docs/testing/README.md](/root/project/ai/deer-flow/docs/testing/README.md).

## Canonical Docker Verification

- For current-code container verification, default to `docker/docker-compose.yaml`.
- Verify public ports after startup or restart:
  - `8081` admin console
  - `8083` product app
  - `8084` demo
- The latest current-code stack verification preserved `model-gateway`
  reachability and validated product chat, demo chat, and admin traces.
- Source: [docs/testing/README.md](/root/project/ai/deer-flow/docs/testing/README.md);
  [docs/testing/results/2026-04-25-unified-docker-kb-real-test.md](/root/project/ai/deer-flow/docs/testing/results/2026-04-25-unified-docker-kb-real-test.md).

## Knowledge-Base Test Bar

- Unit/API tests alone are not enough for knowledge-base, citation, preview, or
  agent answer-quality work.
- Minimum closeout evidence is: targeted automated tests, `8083` user-flow
  result, `8081` observability audit, and current-code stack verification when a
  long-running process may be stale.
- Source: [docs/testing/knowledge-base/TEST_SPEC.md](/root/project/ai/deer-flow/docs/testing/knowledge-base/TEST_SPEC.md);
  [docs/testing/knowledge-base/PITFALLS.md](/root/project/ai/deer-flow/docs/testing/knowledge-base/PITFALLS.md).
