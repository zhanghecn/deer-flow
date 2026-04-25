# Unified Docker KB Real Test

Date: 2026-04-25

## Scope

Validate the current-code unified Docker stack after the `/v1/turns` error
semantics alignment work and the Docker-only local-dev cleanup:

- canonical compose entrypoint is `docker/docker-compose.yaml`
- fixed public ports stay on `8081` / `8083` / `8084`
- external `model-gateway` remains reachable after restart
- complex knowledge-base chat works end to end on both product and demo
  surfaces
- the same runs are visible in `8081/observability` with grounded tool traces

## Environment

- Stack entrypoint: `docker/docker-compose.yaml`
- Stack control script: `scripts/docker.sh`
- Current-code verification mode: bind-mounted Docker dev stack
- Product app: `http://127.0.0.1:8083`
- Admin console: `http://127.0.0.1:8081`
- Demo chat: `http://127.0.0.1:8084/chat`
- Test account:
  - `8083`: `admin / admin123`
  - `8081`: `admin / admin123`
- External model gateway container: `1Panel-new-api-6d1F`
- Unified network: `openagents_default`

## Automated Verification

Executed inside running containers after the current-code stack was up:

```bash
docker exec openagents-gateway-1 sh -lc 'cd /workspace/backend/gateway && export GOCACHE=/openagents-home/dev-cache/go-build && export GOMODCACHE=/openagents-home/dev-cache/go-mod && export PATH=/usr/local/go/bin:$PATH && timeout 300 go test ./internal/handler ./internal/service -count=1'
docker exec openagents-app-1 sh -lc 'cd /workspace/frontend/app && pnpm exec vitest run src/core/public-api/events.test.ts src/core/public-api/turn-runner.test.ts src/core/threads/hooks.test.tsx src/core/threads/mode.test.ts'
docker exec openagents-demo-1 sh -lc 'cd /workspace/frontend/demo && pnpm exec tsc --noEmit --pretty false'
```

Result:

- `go test ./internal/handler ./internal/service` passed
- frontend Vitest passed: `4` files, `55` tests
- demo TypeScript compile passed

## Docker Restart Verification

`scripts/docker.sh restart` was executed after updating restart-path gateway
recovery logic.

Observed result:

- all `openagents-*` containers returned healthy
- public ports stayed aligned:
  - `8081 -> admin`
  - `8083 -> app`
  - `8084 -> demo`
- restart output confirmed:
  - external model gateway already attached to `openagents_default`
  - `model-gateway` resolves inside `langgraph`

## Real Browser Result

### 1. Product surface `8083`

URL:

- `http://127.0.0.1:8083/workspace/agents/support-cases-http-demo/chats/new?agent_status=prod`

Question shape:

- multi-factor customer-service question requiring cross-file reasoning across
  `pdf` / `pptx` / `docx` / `xlsx`
- includes purple-border preview restrictions, exception-code interpretation,
  rush eligibility, blue-label vs `L2`, and 72-hour restart timing

Observed result:

- run completed successfully
- no stuck `Thinking...` state
- final answer explicitly concluded:
  - purple-border preview cannot be sent externally
  - `ZQ-17` exists but does not exempt purple-border external delivery
  - case is `蓝标`
  - rush is not allowed
  - new 72-hour clock restarts at Beijing next whole hour: `00:00`
- answer cited file names from the case library

Trace/thread id:

- `f9005732-2561-4c2d-8b93-aa876b903bc6`

Screenshot:

- `.openagents/dev-cache/manual-kb-tests/2026-04-25-8083-support-after-restart.png`

### 2. Demo surface `8084/chat`

URL:

- `http://127.0.0.1:8084/chat`

Question shape:

- external-chat phrasing with the same complex KB constraints
- no prompt-side hints about which files to use

Observed result:

- tool cards rendered live in the page
- visible tool path included:
  - `document_search`
  - `document_read`
- final answer concluded:
  - purple-border screenshot cannot be sent as final delivery
  - `ZQ-17` is a timer-reset rule, not an external-send exemption
  - case should be treated as `蓝标`
  - rush is not allowed
  - restart point is `24:00 / 次日 00:00`

Trace/thread id from admin observability for the same prompt:

- `bcfc075e-81c9-4ae5-984e-34415f26caf7`

Screenshot:

- `.openagents/dev-cache/manual-kb-tests/2026-04-25-8084-chat-after-restart.png`

### 3. Admin audit `8081/observability`

URL:

- `http://127.0.0.1:8081/observability`

Observed result for `8084/chat` run `bcfc075e-81c9-4ae5-984e-34415f26caf7`:

- registered tools include:
  - `document_search`
  - `document_read`
- actual tool chain shows:
  - `document_search` x3
  - `document_read` on:
    - `案例大全/案例库/04-紫边框预览禁发说明.pdf`
    - `案例大全/案例库/02-异常单升级矩阵.pptx`
    - `案例大全/案例库/01-八字精批交付SLA.docx`
    - `案例大全/案例库/03-超时赔付矩阵.xlsx`

Observed result for `8083` run `f9005732-2561-4c2d-8b93-aa876b903bc6`:

- registered tools include:
  - `document_search`
  - `document_read`
- actual tool chain shows:
  - `document_search` for purple-preview, exception, and rush-timing queries
  - `document_read` on:
    - `案例大全/案例库/00-客服案例总览.md`
    - `案例大全/案例库/01-八字精批交付SLA.docx`
    - `案例大全/案例库/02-异常单升级矩阵.pptx`
    - `案例大全/案例库/04-紫边框预览禁发说明.pdf`
    - `案例大全/案例库/03-超时赔付矩阵.xlsx`

Screenshot:

- `.openagents/dev-cache/manual-kb-tests/2026-04-25-8081-observability-after-restart.png`

## Document Matrix Used

- `00-客服案例总览.md`
- `01-八字精批交付SLA.docx`
- `02-异常单升级矩阵.pptx`
- `03-超时赔付矩阵.xlsx`
- `04-紫边框预览禁发说明.pdf`

This run intentionally exercised text, table, OCR, and embedded-image-backed
content from the same KB.

## Conclusion

Current-code unified Docker verification passed.

- `/v1/turns` client-facing surfaces no longer depend on snapshot fetch success
  to show a terminal failure state
- unified Docker restart preserves the external model-gateway path
- `8083` product chat works after restart
- `8084/chat` demo works after restart
- `8081` shows grounded KB tool traces for both runs

## Known Gaps

- The external `1Panel-new-api-6d1F` container is still attached to legacy
  networks in addition to `openagents_default`; this did not break the unified
  stack, but Docker listings remain noisier than they need to be
- This pass validated the current bind-mounted Docker dev stack, not a pushed
  immutable release image workflow
