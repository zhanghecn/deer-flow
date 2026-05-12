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
- Model gateway integration is explicit and gateway-product neutral. Do not
  auto-detect or auto-attach a container just because its name/image looks like
  New API; future deployments may use New API, One API, LiteLLM, or another
  OpenAI-compatible gateway.
- Preferred URL for a host-published external gateway is an explicit host/LAN
  address such as `http://172.31.18.247:13000`, because Gateway and LangGraph
  containers can both test it with normal curl/TCP diagnostics.
- A stable in-network alias such as `http://model-gateway:3000` is still a
  supported optional mode after the operator attaches the gateway container to
  `openagents` with that alias. Avoid persisting panel-generated container names
  such as `1Panel-new-api-6d1F` in model rows when a host/LAN URL is available.
- `scripts/docker-deploy.sh` may attach aliases only when
  `MODEL_GATEWAY_CONTAINER` is explicitly set in process env or `deploy/.env`.
  Default alias list is now only `model-gateway`; add `new-api` explicitly only
  for a real New API container.
- Before assuming model calls work inside Docker, verify the exact persisted
  model `base_url` from the LangGraph/container network.
- New API model sync must treat returned endpoint metadata as the protocol
  source of truth. Do not force `deepseek-*` model names onto Anthropic or
  DeepSeek transports; this host's scan returned `endpoint_types:
  ["anthropic","openai"]` for `deepseek-v4-*`, so the Anthropic endpoint should
  win because New API reported it, not because of the model name.
- On this host, `docker network inspect openagents` shows network membership but
  not all aliases. To inspect aliases, inspect each container attached to the
  network, for example:
  `docker network inspect openagents -f '{{range $id,$_ := .Containers}}{{println $id}}{{end}}' | xargs -r docker inspect -f '{{.Name}} {{range $name,$net := .NetworkSettings.Networks}}{{if eq $name "openagents"}}aliases={{$net.Aliases}} ip={{$net.IPAddress}}{{end}}{{end}}' | sed 's#^/##'`.
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
