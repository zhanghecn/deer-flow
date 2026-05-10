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

## Release Simulation

When validating the real release path without external registry credentials,
use a local Docker registry and prove this sequence end to end. These registry,
prefix, and version overrides are test-harness internals; do not present them
as user-facing production commands.

```bash
docker run -d --name openagents-local-registry -p 5000:5000 registry:2
RELEASE_VERSION="e2e-$(git rev-parse --short=12 HEAD)"
OPENAGENTS_IMAGE_REGISTRY=localhost:5000 \
OPENAGENTS_IMAGE_PREFIX=openagents \
OPENAGENTS_VERSION="$RELEASE_VERSION" \
./scripts/docker-release.sh push --scope all
```

Then remove the local OpenAgents images and deploy from the pushed registry:

```bash
OPENAGENTS_IMAGE_REGISTRY=localhost:5000 \
OPENAGENTS_IMAGE_PREFIX=openagents \
OPENAGENTS_VERSION="$RELEASE_VERSION" \
./scripts/docker-deploy.sh --force
```

This is the closest local proof of a real release because deploy must pull
images from the registry after local copies are removed.

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
