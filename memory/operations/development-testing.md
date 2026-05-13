# Development Testing Memory

This note is for coding agents, not end users.

## Rule

- Development is testing. After changing code, the agent is responsible for
  verifying the current code path.
- Production is usage. User-facing production install, update, and migration
  instructions live in `DEPLOY.md`.
- Do not explain multiple dev/test/prod lanes to the user unless they ask for
  architecture. Pick the right verification path and run it.

## Current-Code Docker Verification

When container verification is needed after local code changes:

```bash
./scripts/docker-release.sh build --scope app
OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh
```

Use a narrower scope when obvious:

```bash
./scripts/docker-release.sh build --scope frontend
./scripts/docker-release.sh build --scope gateway
```

`OPENAGENTS_PULL_IMAGES=0` is required for local current-code testing because
the deploy script normally pulls published images for production usage.

## SQL Baseline Test

The pre-release SQL baseline should remain two files:

```text
migrations/001_init.up.sql
migrations/002_data.up.sql
```

For a clean first-run test, remove the deploy data directory and OpenAgents
containers, then run `./scripts/docker-deploy.sh`. The migrate service should
apply both baseline SQL files and seed the default admin account without a
separate command.

## Release Simulation

When validating the real release path without external registry credentials,
use a local Docker registry and prove this sequence end to end. These registry,
prefix, and version overrides are test-harness internals; do not present them
as user-facing production commands and do not write them into `deploy/.env`.

```bash
docker run -d --name openagents-local-registry -p 5000:5000 registry:2
TAG="v0.0.0-e2e-$(date +%Y%m%d%H%M%S)"
git tag "$TAG"
OPENAGENTS_IMAGE_REGISTRY=localhost:5000 \
OPENAGENTS_IMAGE_PREFIX=openagents \
./scripts/docker-release.sh push --scope all
git tag -d "$TAG"
```

Then remove the local OpenAgents images and deploy from the pushed registry:

```bash
OPENAGENTS_IMAGE_REGISTRY=localhost:5000 \
OPENAGENTS_IMAGE_PREFIX=openagents \
./scripts/docker-deploy.sh
```

This is the closest local proof of a real release because deploy must pull
images from the registry after local copies are removed.

Deploy is intentionally pull-only. It must not build missing OpenAgents images
or continue after runtime image pull failures; use `scripts/docker-release.sh`
for all image builds.

## Browser Evidence

Verify user-facing behavior on:

```text
http://127.0.0.1:8083
```

Verify admin and traces on:

```text
http://127.0.0.1:8081
```

Use `docker/docker-compose.yaml` only when the task specifically targets the
source-mounted local development stack.

## Deploy Logs

Production deploy has two log surfaces:

- Persistent gateway/LangGraph application files under `deploy/data/logs/`
- Docker compose live logs through `./scripts/docker-logs.sh`

Use both during verification:

```bash
tail -n 100 deploy/data/logs/gateway.log
tail -n 100 deploy/data/logs/langgraph.log
./scripts/docker-logs.sh --no-follow
./scripts/docker-logs.sh gateway --no-follow
./scripts/docker-logs.sh langgraph --no-follow
./scripts/docker-logs.sh nginx --no-follow
./scripts/docker-logs.sh migrate --no-follow
```

The helper reads `deploy/docker-compose.yml`, where services also use Docker's
`json-file` log driver with rotation. Keep gateway/LangGraph app file logs in
`deploy/data/logs` instead of adding a parallel `deploy/logs` path; nginx stays
on Docker logs so access/error logs do not grow as unbounded bind-mounted files.
