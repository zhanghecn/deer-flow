# Docker Config Layout

This repository now keeps a single Docker Compose file:

- `docker/docker-compose-prod.yaml`

Use it for both local Docker runs and release-style single-host deployments.
For detailed operator notes, see `docs/guides/docker-compose-prod-selfhost-zh.md`.

Run Docker Compose from `docker/`:

```bash
docker compose -f docker-compose-prod.yaml build
docker compose -f docker-compose-prod.yaml up -d
```

Gateway no longer executes repository SQL migrations.
If `migrations/*.sql` changes, review and apply them manually before startup.

This repo now uses:

- one shared root `.env` for secrets only
- `config.yaml` for LangGraph/runtime non-secret config
- `backend/gateway/gateway.yaml` for gateway non-secret config

Docker-specific differences are handled in one place:

- fixed container URLs are written directly in `docker/docker-compose-prod.yaml`
- optional compose/provisioner overrides are passed as shell env when needed

Removed on purpose to keep the config surface small:

- a separate Docker-only env file
- a separate Docker-only LangGraph config file
- an ONLYOFFICE compose profile

## Defaults And Overrides

The compose file now carries production-safe defaults directly in
`docker/docker-compose-prod.yaml`. A plain `docker compose -f docker-compose-prod.yaml up -d`
works from `docker/` as long as the repo root `.env` exists.

Override only when you need a different deployment shape:

- `OPENAGENTS_ENV_FILE`
  - default: `../.env`
  - use when secrets live somewhere other than the repo root `.env`
- `OPENAGENTS_DOCKER_HOST_HOME`
  - default: `../.openagents`
  - use when runtime data should live on another host path
- `OPENAGENTS_APP_PORT`
  - default: `8083`
- `OPENAGENTS_ADMIN_PORT`
  - default: `8081`
- `OPENAGENTS_ONLYOFFICE_PORT`
  - default: `8082`
- `OPENAGENTS_SANDBOX_PORT`
  - default: `18080`

Example:

```bash
OPENAGENTS_APP_PORT=80 \
OPENAGENTS_ADMIN_PORT=8081 \
docker compose -f docker-compose-prod.yaml up -d
```

## Recommended Mental Model

Put secrets in root `.env`:

- `DATABASE_URI`
- `JWT_SECRET`
- API keys

Put non-secret runtime config in `config.yaml` / `gateway.yaml`:

- `storage.base_dir`
- `sandbox.use`
- host-run `sandbox.base_url`
- host-run `runtime.edition`
- gateway host-run upstream URLs

Do not try to store both host-view and container-view URLs in `.env`.
For container-only fixed values, compose already owns them:

- gateway sees `LANGGRAPH_URL=http://langgraph:2024`
- langgraph sees `OPENAGENTS_SANDBOX_BASE_URL=http://sandbox-aio:8080`
- gateway sees `ONLYOFFICE_PUBLIC_APP_URL=http://gateway:8001`
- gateway/langgraph see `OPENAGENTS_HOME=/openagents-home`

Externally managed model gateways should join the same Docker bridge network as
OpenAgents and expose a stable alias such as `model-gateway`. That keeps model
records on one canonical in-container URL like `http://model-gateway:3000`
without adding a host-network proxy shim to this compose file.

In the unified compose stack, do not mount the whole repository into app containers.
Mount only the service source directories that need hot updates, keep those
code mounts read-only, and write runtime scratch data under `OPENAGENTS_HOME`.
Container logs should stay on stdout/stderr and use Docker log rotation.

## Important Constraint

With one `.env`, `DATABASE_URI` should ideally be reachable from both:

- host-run processes
- Docker containers

That is usually fine when PostgreSQL is on another server or a stable LAN host.

If your DB is bound only to host-local `127.0.0.1`, one `.env` cannot express
two different addresses cleanly. This repo now optimizes for the simple case:
one shared DB address.

## Manual Usage

```bash
cd docker
docker compose -f docker-compose-prod.yaml up --build
```

or:

```bash
make docker-start
```

`make docker-start` now waits for the compose services to be actually ready and
verifies these public entrypoints before returning success:

- `http://127.0.0.1:8083/health`
- `http://127.0.0.1:8083/`
- `http://127.0.0.1:8081/`

Use these shortcuts for ongoing operations:

```bash
make docker-status
make docker-verify
```

This avoids the easy-to-miss case where `docker compose up -d` has created the
containers, but one or more services are still stuck in `Created` or not yet
healthy.

`ONLYOFFICE` and `SANDBOX_AIO` are part of the default unified stack.
The app entrypoint is `http://127.0.0.1:8083`, the admin entrypoint is
`http://127.0.0.1:8081`, and the sandbox management UI is exposed on
`http://127.0.0.1:18080`.
For host-run local development, start just the shared infra with:

```bash
make docker-infra-start
```

That starts only `sandbox-aio` and `onlyoffice`.
`config.yaml` keeps the host-run sandbox URL (`http://127.0.0.1:18080`), and compose overrides the in-container LangGraph URL to `http://sandbox-aio:8080`.

## External Model Gateway

If your model gateway is managed outside this repository, connect that
container to `openagents-prod_openagents` and give it the `model-gateway`
alias. For example:

```bash
make docker-model-gateway-attach MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F
```

After that, point Anthropic-compatible model records such as `kimi-k2.5` at:

```text
http://model-gateway:3000
```

## Optional Compose/Shell Vars

Export these in the shell only when you actually need them:

- `OPENAGENTS_ENV_FILE`
- `OPENAGENTS_DOCKER_HOST_HOME`
- `OPENAGENTS_APP_PORT`
- `OPENAGENTS_ADMIN_PORT`
- `OPENAGENTS_ONLYOFFICE_PORT`
- `OPENAGENTS_SANDBOX_PORT`
- `NODE_HOST`
- `K8S_API_SERVER`

## Vendored OpenPencil

The production stack now builds OpenPencil from the vendored `openpencil/`
directory in this repository.

That keeps the Deer Flow `/openpencil` proxy contract, bridge code, and
OpenPencil runtime on one source revision instead of mixing current Deer Flow
code with a potentially stale external image.

## Fixed Compose Name

Keep the top-level `name: openagents-prod`.

Without that, different `docker compose` invocations can create different
bridge networks and break service DNS such as `http://langgraph:2024`.
