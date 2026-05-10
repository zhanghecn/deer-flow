# Deploy-First Docker Refactor Verification

Date: 2026-05-10

## Scope

Verified the deploy-first Docker contract after moving production compose to
`deploy/docker-compose.yml`, adding the one-shot `migrate` service, and
standardizing the external model gateway alias on the fixed `openagents`
network.

## Commands

```bash
bash -n scripts/docker-deploy.sh scripts/docker-release.sh scripts/docker.sh scripts/demo.sh migrations/run.sh
docker compose -f deploy/docker-compose.yml config --quiet
./scripts/docker-release.sh config
./scripts/docker-release.sh images --scope app --version 1.2.3 --dry-run
go test ./...  # from backend/gateway
```

Real stack verification used a temporary compose project, temporary data under
`/tmp/openagents-deploy-test`, and non-default host ports:

```bash
cd deploy
docker compose -p openagents-verify -f docker-compose.yml up -d \
  postgres migrate minio minio-init sandbox-aio onlyoffice langgraph gateway nginx
```

The temporary stack was removed with:

```bash
cd deploy
docker compose -p openagents-verify -f docker-compose.yml down --remove-orphans
rm -rf /tmp/openagents-deploy-test
```

## Evidence

- All deploy services reached healthy/running state in the temporary stack.
- `curl http://127.0.0.1:18083/health` returned gateway health JSON.
- `curl http://127.0.0.1:18083/` returned HTTP 200 for the app entrypoint.
- `curl http://127.0.0.1:18081/` returned HTTP 200 for the admin entrypoint.
- `openagents_schema_migrations` contained:
  - `001_init.up.sql`
  - `002_seed_data.up.sql`
- Fresh bootstrap inserted one admin user and no seed model rows.
- A second `docker compose run --rm migrate` skipped both already-applied SQL
  files and reported migrations up to date.
- From `langgraph`, `model-gateway` resolved to the attached New API container
  on the `openagents` network; `GET http://model-gateway:3000/v1/models`
  returned HTTP 401, proving network reachability without exposing an API key.
- `./scripts/docker-release.sh build --scope gateway --version local-test`
  built `docker.io/zhangxuan2/openagents-gateway:local-test`; the local test
  image was removed after verification.

## Cleanup

- Temporary `openagents-verify` containers were removed.
- `/tmp/openagents-deploy-test` was deleted.
- The existing New API container remains attached to the `openagents` network
  with alias `model-gateway`, which is the intended deploy setup.

## Fresh Image And Data Browser Verification

After the temporary verification above, the deploy path was tested again from a
fresh local state. This run also covered the hard removal of the former
OpenPencil module, including its service, image, gateway routes, frontend
workspace surface, runtime file guard, copied skill, and vendored source tree.

```bash
docker compose -p openagents -f docker/docker-compose.yaml down --remove-orphans
docker compose -p openagents -f deploy/docker-compose.yml down --remove-orphans
docker rmi -f <previous openagents images>
docker rmi -f ghcr.io/zseven-w/openpencil:latest
rm -rf deploy/data docker/data
MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F ./scripts/docker-deploy.sh
./scripts/docker-release.sh build --scope all --version latest
cd deploy && docker compose -f docker-compose.yml up -d
```

Additional build fixes from this run:

- The admin New API sync dialog now hints the deploy network URL
  `http://model-gateway:3000/` instead of a host-loopback URL.
- Release image building no longer includes an OpenPencil image; `--scope all`
  builds only web, gateway, langgraph, sandbox-aio, and onlyoffice.

Fresh-run evidence:

- `docker compose -f deploy/docker-compose.yml ps` reported `gateway`,
  `langgraph`, `nginx`, `onlyoffice`, `postgres`, and
  `sandbox-aio` healthy; `minio` was running with its loopback ports.
- No running or stopped Docker containers matched the removed OpenPencil
  service name, and no local Docker images matched OpenPencil after removing
  the historical `ghcr.io/zseven-w/openpencil:latest` image.
- At this point in the run, before the DeepSeek transport migration below was
  applied, the migration ledger contained only `001_init.up.sql` and
  `002_seed_data.up.sql`.
- Fresh bootstrap inserted one admin user and zero model rows.
- From `langgraph`, `model-gateway` resolved to `172.20.0.2`; requesting
  `http://model-gateway:3000/v1/models` returned HTTP 401, proving container
  network reachability while still requiring a New API key.
- Real browser verification with `playwright-cli` loaded
  `http://127.0.0.1:8081/login`, logged in as the seeded admin user, opened
  `/models`, and confirmed the Sync New API modal placeholder is
  `http://model-gateway:3000/`.
- Real browser verification loaded `http://127.0.0.1:8083/` and
  `/workspace/chats/new`; both rendered without console errors.
- Real browser verification requested the old `/openpencil/` path and it no
  longer rendered an OpenPencil application surface.
- Repository scans for OpenPencil, design-board routes, design API routes,
  design output paths, and `.op` canvas handling returned no current-code
  matches outside excluded archive/runtime-output directories.

## New API DeepSeek Chat Regression

The current deploy stack was reused to verify the reported chat failure on
`http://127.0.0.1:8083/workspace/chats/new?agent_status=dev`.

Migration and model configuration evidence:

- `OPENAGENTS_MIGRATIONS_DIR=/root/project/ai/deer-flow/migrations docker compose -p openagents -f deploy/docker-compose.yml run --rm migrate`
  applied `003_newapi_deepseek_anthropic_transport.up.sql`.
- The synced `deepseek-v4-flash` and `deepseek-v4-pro` model rows now use
  `langchain_anthropic:ChatAnthropic`, `base_url: http://model-gateway:3000`,
  and `reasoning.contract: anthropic_thinking`.
- `docker compose -p openagents -f deploy/docker-compose.yml logs langgraph`
  showed successful model calls to `POST http://model-gateway:3000/v1/messages`
  instead of the previous OpenAI-compatible chat completions path.

Real browser evidence:

- Logged in through `http://127.0.0.1:8083` as the seeded admin user.
- Submitted `给我个小惊喜` in a new `dev` chat thread
  `f0571bb9-087a-406b-8f3d-68b7fe142359`.
- The run completed successfully, produced
  `/mnt/user-data/outputs/dream-weaver/index.html`, and the Preview dock
  rendered the generated HTML artifact in an iframe.
- A same-thread follow-up, `很好，再用一句话总结这个惊喜`, completed in the
  browser and returned a normal assistant response.
- Browser console checks after the initial run, preview open, and follow-up run
  reported zero errors and zero warnings.
- Runtime logs for both runs contained no `Invalid schema for function
  'setup_agent'` error and no DeepSeek `content[].thinking` replay error.

Remaining environment gap:

- The surprise flow attempted the image-generation skill, but the sandbox did
  not have `VOLCENGINE_API_KEY` or `ARK_API_KEY`, so the agent degraded to a
  pure frontend artifact. This did not break chat completion, but production
  image generation still requires explicitly passing the provider secret into
  the sandbox/runtime environment.

## LangGraph Restart And Preview Hydration Regression

The same deploy stack was used to verify two browser regressions found after
the initial New API fix.

Code-level checks:

```bash
cd backend/gateway && go test ./internal/handler ./internal/model ./internal/bootstrap
cd backend/agents && uv run pytest tests/test_model_config.py tests/test_model_factory.py tests/test_tool_runtime_context.py -q
cd backend/agents && uv run pytest tests/test_aio_sandbox_backend.py tests/test_remote_sandbox_backend.py -q
cd frontend/app && ./node_modules/.bin/vitest run src/core/threads/hooks.test.tsx src/components/workspace/chats/new-chat-sender.test.tsx
cd frontend/app && ./node_modules/.bin/vitest run src/components/workspace/chats/chat-box.test.tsx
cd frontend/app && ./node_modules/.bin/tsc --noEmit --pretty false
```

Restart recovery evidence:

- Recreated `openagents-langgraph-1` to simulate runtime restart.
- Reloaded old thread `f0571bb9-087a-406b-8f3d-68b7fe142359` with
  `pending_run=1`; the frontend first ensured the LangGraph thread existed,
  then `state` and `history` returned HTTP 200 instead of the previous 404
  loop.
- Submitted a follow-up message in the same thread and received a normal `ok`
  assistant response.

Preview hydration evidence:

- Submitted a second `给我个小惊喜` run in thread
  `750e7813-3a45-4c27-ae7e-4354a7de57aa`; it completed and produced
  `/mnt/user-data/outputs/spring-whisper/index.html`.
- Rebuilt the frontend image with
  `./scripts/docker-release.sh build --scope frontend --version latest` and
  recreated only the `nginx` container from `deploy/docker-compose.yml`.
- Reloaded
  `http://127.0.0.1:8083/workspace/chats/750e7813-3a45-4c27-ae7e-4354a7de57aa?agent_status=dev`
  in a real browser after the new bundle was served.
- The Preview dock restored the remembered `index.html` selection on initial
  hydration, rendered one iframe containing `Spring's Whisper`, and no longer
  showed `No preview selected`.
- The artifact endpoint
  `/api/threads/750e7813-3a45-4c27-ae7e-4354a7de57aa/artifacts/mnt/user-data/outputs/spring-whisper/index.html`
  returned HTTP 200/304 during verification.
- Answered the agent's pending feedback question with `很棒，先这样 ✨`;
  `/runs/stream` returned HTTP 200 and the UI reached `Run completed`.
- Browser console after reload reported zero errors and zero warnings.
