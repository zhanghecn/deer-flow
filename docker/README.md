# Docker Entry Points

This repository has two Docker Compose entry points:

- `docker/docker-compose.yaml`
- `docker/docker-compose-prod.yaml`

`docker-compose.yaml` is the writable source-mounted development stack.
`docker-compose-prod.yaml` is the release stack: application services have
Docker Hub-style `image:` names only. The release script builds and pushes
those images from the service Dockerfiles. Stateful data is stored in explicit
host directories.

## Common Local Development

Use Docker for the normal local workflow:

```bash
make dev
```

This starts the writable source-mounted stack and verifies the public
entrypoints before returning success. Stop it with:

```bash
make stop
```

Useful follow-up commands:

```bash
make docker-status
make docker-verify
make docker-logs
```

The stack starts these services:

- `sandbox-aio`
- `onlyoffice`
- `langgraph`
- `gateway`
- `openpencil`
- `app`
- `admin`
- `demo-mcp-file-service`
- `demo`

Public local URLs:

- app: `http://127.0.0.1:8083`
- admin: `http://127.0.0.1:8081`
- demo: `http://127.0.0.1:8084`
- gateway: `http://127.0.0.1:8001`
- langgraph: `http://127.0.0.1:2024`
- openpencil: `http://127.0.0.1:3001/openpencil/editor`
- sandbox: `http://127.0.0.1:18080`
- onlyoffice: `http://127.0.0.1:8082`

## What This Compose File Optimizes For

The canonical compose file is intentionally a local development stack:

- the repository is bind-mounted read-write into service containers
- dependency caches live under `OPENAGENTS_DOCKER_HOST_HOME`, defaulting to
  `deploy/data/openagents`
- app, admin, demo, gateway, LangGraph, OpenPencil, sandbox, and ONLYOFFICE run
  together so ports are owned by Docker instead of mixed host processes
- logs stay on stdout/stderr, so `docker compose logs` is the inspection path

This is why `make dev` is the default local path.

## Production Images

`docker/docker-compose-prod.yaml` is designed for the common open-source
release flow: build locally, push tagged images to a registry, then deploy by
pulling those images on the server.

Build and push the OpenAgents-owned images:

```bash
./scripts/docker-release.sh push
```

Deploy from published images:

```bash
./scripts/docker-release.sh deploy
```

`deploy`, `pull`, and `config` use the generated `deploy/docker-compose.yml`.
Run `./scripts/docker-deploy.sh` once before those commands on a new machine.

Prepare a self-contained production directory, following the same pattern as
projects that keep `docker-compose.yml`, `.env`, and data directories together:

```bash
./scripts/docker-deploy.sh --start
```

The preparation script creates `deploy/.env`, copies deployment-local
`config.yaml` and `gateway.yaml`, copies the production compose template to
`deploy/docker-compose.yml`, and creates `deploy/data/openagents`,
`deploy/data/postgres`, and `deploy/data/minio`.

`--start` starts PostgreSQL first, applies the SQL baseline when the database is
empty, then starts the whole stack. If you are doing the steps manually,
first-time deployments still need the SQL baseline applied once after
PostgreSQL is running. From the repository root, use:

```bash
docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < migrations/001_init.up.sql
docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < migrations/002_seed_data.up.sql
```

The release script defaults to `zhangxuan2/openagents` and `latest`, so the
normal publish command is:

```bash
./scripts/docker-release.sh push
```

This publishes service tags such as `zhangxuan2/openagents:nginx-latest` and
`zhangxuan2/openagents:gateway-latest`. Override the base tag without shell
exports when needed: `--tag v0.1.0`. Override the repository with
`--repository <namespace>/openagents` when publishing elsewhere.

The generated production compose file intentionally contains no `build:` blocks. Local
release builds are owned by `scripts/docker-release.sh`, so the deploy file
stays the same file operators use on a server. PostgreSQL, MinIO, and the
OpenAgents runtime home use bind-mounted host directories instead of anonymous
Docker volumes so backups and machine migration are explicit filesystem
operations.

## Configuration

The production compose stack reads secrets from `deploy/.env` by default. The
deployment preparation script copies non-secret runtime configuration into:

- `deploy/config.yaml`
- `deploy/gateway.yaml`

Common optional overrides:

- `OPENAGENTS_DOCKER_HOST_HOME`
- `OPENAGENTS_POSTGRES_DATA_DIR`
- `OPENAGENTS_MINIO_DATA_DIR`
- `OPENAGENTS_POSTGRES_PORT`
- `OPENAGENTS_MINIO_API_PORT`
- `OPENAGENTS_MINIO_CONSOLE_PORT`
- `OPENAGENTS_APP_PORT`
- `OPENAGENTS_ADMIN_PORT`
- `OPENAGENTS_GATEWAY_PORT`
- `OPENAGENTS_LANGGRAPH_PORT`
- `OPENAGENTS_OPENPENCIL_PORT`
- `OPENAGENTS_DEMO_PORT`
- `OPENAGENTS_ONLYOFFICE_PORT`
- `OPENAGENTS_SANDBOX_PORT`

Example:

```bash
OPENAGENTS_APP_PORT=8093 make dev
```

Production data directory example:

```bash
OPENAGENTS_DOCKER_HOST_HOME=/srv/openagents/runtime \
OPENAGENTS_POSTGRES_DATA_DIR=/srv/openagents/postgres \
OPENAGENTS_MINIO_DATA_DIR=/srv/openagents/minio \
docker compose -f docker-compose.yml up -d
```

Without those overrides, production data is stored next to the compose file
under `deploy/data/openagents`, `deploy/data/postgres`, and `deploy/data/minio`.

## External Model Gateway

If your model gateway is managed outside this repository, attach that container
to the `openagents_default` network with the `model-gateway` alias:

```bash
make docker-model-gateway-attach MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F
```

Model records inside OpenAgents should then use:

```text
http://model-gateway:3000
```

## Direct Compose Usage

Prefer `make dev`, but direct compose usage is:

```bash
cd docker
docker compose --env-file ../.env -p openagents -f docker-compose.yaml up --build
```

Keep the project name `openagents`; changing it creates different bridge
networks and breaks service DNS such as `http://langgraph:2024`.
