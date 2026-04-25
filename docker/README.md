# Docker Entry Points

This repository has one canonical local Docker compose file:

- `docker/docker-compose.yaml`

The old compose filenames remain only as compatibility wrappers:

- `docker/docker-compose.dev.yaml`
- `docker/docker-compose-prod.yaml`

Both wrappers include the same canonical file. Do not treat them as separate
development and production topologies.

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
  `../.openagents`
- app, admin, demo, gateway, LangGraph, OpenPencil, sandbox, and ONLYOFFICE run
  together so ports are owned by Docker instead of mixed host processes
- logs stay on stdout/stderr, so `docker compose logs` is the inspection path

This is why `make dev` is the default and why the old `docker-prod-*` aliases
now map to the same stack. They are kept for old automation only.

## Stable Image Release Status

Stable prebuilt-image deployment is a separate release lane and is not yet the
canonical compose path in this repository.

The desired release contract is simple:

```bash
docker compose -f docker-compose.release.yaml pull
docker compose -f docker-compose.release.yaml up -d
```

Do not document or script that as the supported release command until the
release compose file, published images, image tags, migrations, and verification
checks exist together. Until then, use the unified local Docker stack for
development/testing and keep `docker-prod-*` as compatibility aliases only.

## Configuration

The compose stack reads secrets from the repository root `.env` and non-secret
runtime configuration from:

- `config.yaml`
- `backend/gateway/gateway.yaml`

Common optional overrides:

- `OPENAGENTS_DOCKER_HOST_HOME`
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
