# Docker Config Layout

For a Chinese review of `docker-compose-dev.yaml` plus recommended production
release/update flow, see `docs/guides/docker-compose-dev-review-and-release-zh.md`.

For the single-host production-oriented compose file, see
`docs/guides/docker-compose-prod-selfhost-zh.md`.

For direct production usage, run docker compose from `docker/`:

```bash
docker compose --env-file ../.env -p openagents-prod -f docker-compose-prod.yaml build
docker compose --env-file ../.env -p openagents-prod -f docker-compose-prod.yaml up -d
```

Gateway no longer executes repository SQL migrations.
If `migrations/*.sql` changes, review and apply them manually before startup.

This repo now uses:

- one shared root `.env` for secrets only
- `config.yaml` for LangGraph/runtime non-secret config
- `backend/gateway/gateway.yaml` for gateway non-secret config

Docker-specific differences are handled in two places only:

- fixed container URLs are written directly in `docker/docker-compose-dev.yaml`
- optional compose/provisioner overrides are passed as shell env when needed

Removed on purpose to keep the config surface small:

- a separate Docker-only env file
- a separate Docker-only LangGraph config file
- an ONLYOFFICE compose profile

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
docker compose --env-file ../.env -f docker-compose-dev.yaml up --build
```

or:

```bash
make docker-start
```

`ONLYOFFICE` is part of the default Docker dev stack.
`SANDBOX_AIO` is also part of the default stack when `config.yaml` uses the AIO sandbox provider.
In `docker-compose-dev.yaml`, `gateway` now starts with `go run ./cmd/server`
against the mounted source tree, so normal Go code edits only need a container
restart instead of a full image rebuild.
For host-run local development, start just the shared infra with:

```bash
make docker-infra-start
```

That starts only `sandbox-aio` and `onlyoffice`.
`config.yaml` keeps the host-run sandbox URL (`http://127.0.0.1:8083`), and compose overrides the in-container LangGraph URL to `http://sandbox-aio:8080`.

## Optional Compose/Shell Vars

Export these in the shell only when you actually need them:

- `OPENAGENTS_DOCKER_HOST_HOME`
- `ONLYOFFICE_PORT`
- `NODE_HOST`
- `K8S_API_SERVER`

## Fixed Compose Name

Keep the top-level `name: openagents-dev`.

Without that, different `docker compose` invocations can create different
bridge networks and break service DNS such as `http://langgraph:2024`.
