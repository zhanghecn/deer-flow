# llm_wiki Graph Alignment E2E - 2026-05-15

## Scope

- App: `http://127.0.0.1:8083`
- Admin: `http://127.0.0.1:8081`
- Deploy stack: `deploy/docker-compose.yml`
- Browser: `playwright-cli -s=kb-e2e`
- Account: `admin / admin123`
- Knowledge base: `llm-wiki-align-e2e-20260515`
- Base id: `1cb37f94-f3ad-4b1f-bd9c-352646ec93b5`
- Owner id: `8967906e-7853-4170-9c6c-b8e961fbcebd`

## Alignment Points Verified

- Frontend graph rendering uses the same family as `llm_wiki`: Graphology, Sigma, and ForceAtlas2.
- Browser graph UI supports type/community color modes, filters, zoom controls, selected-node inspector, community list, edge list, graph insights, and `Open in Wiki`.
- Worker-generated workspace includes `.llm-wiki`, `raw/sources/.cache`, `wiki/sources`, `wiki/concepts`, `wiki/index.md`, `wiki/log.md`, and `wiki/overview.md`.
- Source pages link to derived concept pages via wikilinks, matching the wiki workspace navigation model.
- Gateway graph community detection now uses deterministic Louvain-style local moving instead of plain connected components, so the browser API no longer collapses weakly connected topics into one community.

## Build And Deploy

- Build: `./scripts/docker-release.sh build --scope app`
- Deploy: `OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh`
- Images after build:
  - `zhangxuan2/openagents-web:latest` `8b6ed3b42497`
  - `zhangxuan2/openagents-gateway:latest` `78b0a73cd037`
  - `zhangxuan2/openagents-langgraph:latest` `0527326cc0d2`
- Runtime health:
  - `openagents-nginx-1` healthy
  - `openagents-gateway-1` healthy
  - `openagents-langgraph-1` healthy
  - `openagents-postgres-1` healthy
  - `openagents-minio-1` running

## Browser Result

Passed on `http://127.0.0.1:8083/workspace/knowledge?owner=8967906e-7853-4170-9c6c-b8e961fbcebd&base=1cb37f94-f3ad-4b1f-bd9c-352646ec93b5`.

- Logged in as `admin`.
- Opened the target knowledge base directly from URL.
- `Wiki Workspace` showed generated files:
  - `.llm-wiki/ingest-cache.json`
  - `raw/sources/.cache/openagents-bazi-graph-dxu8-78fc84b8.txt`
  - `wiki/sources/openagents-bazi-graph-dxu8-78fc84b8.md`
  - `wiki/concepts/openagents-bazi-graph-dxu8-78fc84b8--壬寅日主丑月.md`
  - `wiki/concepts/openagents-bazi-graph-dxu8-78fc84b8--壬寅日主丑月案例.md`
  - `wiki/concepts/openagents-bazi-graph-dxu8-78fc84b8--格局推演.md`
- `Graph` tab showed `7 graph nodes`.
- Sigma canvas rendered with 7 canvas layers and a `364x688` graph viewport.
- Graph API returned:
  - nodes: `7`
  - edges: `7`
  - communities: `3`
  - labels: `Index`, `openagents-bazi-graph-dxU8.md`, `壬寅日主丑月`, `壬寅日主丑月案例`, `格局推演`, `Log`, `Overview`
- UI interaction checks:
  - `Community` color mode became active.
  - `Filter` panel opened and showed `Graph filters`.
  - `Open in Wiki` opened `wiki/sources/openagents-bazi-graph-dxu8-78fc84b8.md`.
  - Opened source page showed wikilinks to `壬寅日主丑月` and `壬寅日主丑月案例`.
- Browser console: `0` errors. WebGL emitted GPU performance warnings only.

## Visual Artifacts

- Full page screenshot: `/tmp/openagents-e2e/knowledge-graph-sigma.png`
- Sigma container screenshot after gateway Louvain-style fix: `/tmp/openagents-e2e/sigma-container-after-louvain.png`
- Sigma container pixel check:
  - size: `364x688`
  - unique colors: `1511`
  - non-near-white pixel ratio: `0.0511`

## Automated Verification

```bash
cd backend/agents && uv run pytest tests/test_wiki_workspace.py -q
cd backend/agents && uv run ruff check src/knowledge/wiki_workspace.py src/knowledge/storage.py tests/test_wiki_workspace.py
cd backend/gateway && go test ./internal/handler -count=1
corepack pnpm --dir frontend/app typecheck
corepack pnpm --dir frontend/app exec eslint src/components/workspace/knowledge/thread-knowledge-management-page.tsx src/core/i18n/locales/types.ts src/core/i18n/locales/en-US.ts src/core/i18n/locales/zh-CN.ts src/test/setup.ts
corepack pnpm --dir frontend/app exec vitest run src/components/workspace/knowledge src/core/knowledge
```

Results:

- `tests/test_wiki_workspace.py`: `8 passed`
- gateway handler tests: passed
- frontend typecheck: passed
- targeted eslint: passed
- frontend knowledge vitest: `7 files / 23 tests passed`

## Remaining Risk

- This aligns the deterministic workspace/source lifecycle, graph extraction, community grouping, and Sigma/ForceAtlas2 browser experience.
- The LLM two-stage compiler path is covered separately in `2026-05-15-llm-wiki-compiler-e2e.md`; graph alignment should still be rechecked on larger multi-document corpora because community structure changes with corpus size.
