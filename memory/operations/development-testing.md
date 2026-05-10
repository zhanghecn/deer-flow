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
./scripts/docker-release.sh build --scope app --version latest
OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh
```

Use a narrower scope when obvious:

```bash
./scripts/docker-release.sh build --scope frontend --version latest
./scripts/docker-release.sh build --scope gateway --version latest
```

`OPENAGENTS_PULL_IMAGES=0` is required for local current-code testing because
the deploy script normally pulls published images for production usage.

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
