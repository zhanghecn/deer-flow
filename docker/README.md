# Docker Config Layout

Docker Compose in this repo follows one rule:

- repo root `.env` is the single source of truth

The same file contains two views of a few runtime addresses:

- host view: used by host-run services and local development
- container view: `*_DOCKER` variables used only when a service runs inside Docker
- optional compose path view: `OPENAGENTS_DOCKER_HOST_HOME` and `OPENAGENTS_DOCKER_CONTAINER_HOME`

Example:

```env
LANGGRAPH_URL=http://localhost:2024
LANGGRAPH_URL_DOCKER=http://langgraph:2024
```

Why this exists:

- `localhost` on the host means "this machine"
- `localhost` inside a container means "this container"

So Docker services must not read host-view URLs directly.

One important exception:

- `ONLYOFFICE_SERVER_URL` is browser-facing, not container-facing, so it usually stays as the host-view URL such as `http://localhost:8082`

## Loading Order

```text
root .env
   ├─ compose interpolation: docker compose --env-file ../.env ...
   ├─ mounted file: /app/.env (gateway / langgraph read this directly)
   └─ env_file: ../.env (only for services that do not read /app/.env themselves)

compose environment overrides
   DATABASE_URI        <- DATABASE_URI_DOCKER
   LANGGRAPH_URL       <- LANGGRAPH_URL_DOCKER
   OPENAGENTS_HOME     <- OPENAGENTS_HOME_DOCKER
   ...
```

For filesystem mounts, compose uses:

```text
OPENAGENTS_DOCKER_HOST_HOME      -> bind-mount source on the repo machine
OPENAGENTS_DOCKER_CONTAINER_HOME -> runtime path exposed in gateway/langgraph
```

The applications still read the canonical runtime names:

- `DATABASE_URI`
- `LANGGRAPH_URL`
- `OPENAGENTS_HOME`
- `OPENAGENTS_SANDBOX_BASE_URL`
- `ONLYOFFICE_PUBLIC_APP_URL`

Compose is only responsible for mapping the docker-view values into those names.
The helper script additionally normalizes `OPENAGENTS_DOCKER_HOST_HOME` to an
absolute path before startup so provisioner mode can safely use hostPath mounts.

In practice:

- `gateway` and `langgraph` read the mounted root `.env` file themselves
- Compose only overrides the few vars whose value must change inside Docker
- `onlyoffice` and `provisioner` still use `env_file` because they do not load `/app/.env` on their own

## Manual Usage

Run compose with the shared root `.env` explicitly:

```bash
cd docker
docker compose --env-file ../.env -f docker-compose-dev.yaml up --build
```

Or use:

```bash
make docker-start
```

The helper script already injects `--env-file /path/to/repo/.env`.
