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

- Development is testing: when a coding agent changes code, it owns the
  current-code verification loop. Do not ask the user to choose between
  dev/test/prod lanes.
- After local code changes that must be verified in containers, rebuild the
  affected deploy image scope, then start the deploy stack without pulling
  remote images:
  - frontend change: `./scripts/docker-release.sh build --scope frontend`
  - gateway change: `./scripts/docker-release.sh build --scope gateway`
  - app/runtime change: `./scripts/docker-release.sh build --scope app`
  - full stack image change: `./scripts/docker-release.sh build --scope all`
  - deploy local build: `OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh`
- For production or self-host current-code container verification, default to
  `deploy/docker-compose.yml` via `./scripts/docker-deploy.sh`.
- SQL first-run verification should prove that the two-file baseline
  (`001_init.up.sql`, `002_data.up.sql`) initializes an empty database and that
  later deploys do not require a separate seed/migration command.
- Use `docker/docker-compose.yaml` only when the task is specifically about the
  source-mounted local development stack.
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
