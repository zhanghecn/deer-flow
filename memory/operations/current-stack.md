# Current Stack Memory

## Public Entrypoints

- `8081`: admin console and observability
- `8083`: product app and workspace flows
- `8084`: demo surface for MCP and external integration work

## Test Accounts

- Product-side historical test account:
  - username: `supportdemo_1776361880`
  - password: `admin12345`
  - user id: `57e4667d-77e7-43f0-af38-6bb673079f35`
- Admin console:
  - username: `admin`
  - password: `admin123`
- Source: migrated from `.omx/project-memory.json`.

## Model Gateway

- External model gateway container used in recent Docker verification:
  `1Panel-new-api-6d1F`.
- Production deploy uses one fixed external Docker network named `openagents`.
- Attach the existing New API container to that network as `model-gateway`; the
  admin New API sync URL inside containers is `http://model-gateway:3000`.
- Before assuming model calls work inside Docker, verify network attachment and
  DNS resolution from the LangGraph/container network.
- Source: migrated from `.omx/project-memory.json` / `.omx/notepad.md` and
  updated by the deploy-first Docker refactor.

## Production Deploy Surface

- `deploy/docker-compose.yml` is the production compose contract.
- `docker/docker-compose.yaml` is local development only; do not recreate a
  second production template under `docker/`.
- `deploy/.env` carries deployment variables and secrets. Root `.env` is for
  local/dev workflows.
- Release pushes use service-specific image names and require the current commit
  to have an exact `v*` git tag; no-tag commits must fail before build/push.
  The GitHub workflow publishes DockerHub when credentials are configured and
  always publishes GHCR. Deploy/update commands default to `latest` so operators
  do not have to remember a version string.
- The initial SQL baseline is intentionally two files: `001_init.up.sql`
  for schema and `002_data.up.sql` for deterministic seed/repair data. Keep
  deploy docs user-facing; keep local registry and dirty-worktree test details
  in coding-agent memory.

## Historical Host-Run Dev Stack

- `.omx/notepad.md` recorded a host-run dev stack:
  - `make dev` on `localhost:3000`
  - gateway `8001`
  - LangGraph `2024`
- Treat this as historical context. When the task asks for current-code
  container verification, prefer the canonical Docker guidance in
  [memory/directives/testing-and-verification.md](/root/project/ai/deer-flow/memory/directives/testing-and-verification.md).
