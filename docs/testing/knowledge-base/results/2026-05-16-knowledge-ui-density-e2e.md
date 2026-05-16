# Knowledge UI Density E2E - 2026-05-16

## Scope

- App: `http://127.0.0.1:8083`
- Deploy stack: `deploy/docker-compose.yml`
- Account: `admin / admin123`
- Knowledge base: `bazi-cases-full-llm-wiki-e2e-20260515-r5`
- Base id: `115eea70-52e5-48a6-9fa7-bb0a34cb35fe`

## Code Verification

```bash
cd frontend/app
corepack pnpm typecheck
corepack pnpm exec eslint \
  src/app/workspace/layout.tsx \
  src/components/workspace/knowledge/thread-knowledge-management-page.tsx \
  src/components/workspace/knowledge/knowledge-build-summary.tsx
corepack pnpm test:unit -- \
  src/components/workspace/knowledge/thread-knowledge-management-page.test.ts \
  src/components/workspace/knowledge/thread-knowledge-attachment-strip.test.tsx
```

Results:

- `typecheck` passed.
- Targeted eslint passed.
- Related unit command passed: `62` files, `288` tests.

## Current-Code Deploy

```bash
./scripts/docker-release.sh build --scope frontend
OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh
```

Results:

- Frontend release image built successfully.
- Deploy stack restarted successfully.

## Browser Verification

Used headed Chrome through `playwright-cli --headed` at `1365x900`.

Verified:

- Knowledge route uses compact workspace sidebar width: `256px`.
- Knowledge library rail uses compact width: `208px`.
- Wiki Workspace has independent scroll containers for workspace files and source documents.
- Graph tab renders a bounded canvas: `669px x 649px`.
- Page body has no vertical overflow: `bodyScrollHeight = innerHeight = 900`.
- Graph inspector rail remains scrollable and visible.
- Header action buttons remain accessible by labels while rendering compact icon-first controls.
- Console showed only WebGL `ReadPixels` performance warnings during graph rendering.

Admin surface:

- Opened `http://127.0.0.1:8081`.
- Confirmed the admin login surface rendered with title `Admin Console - OpenAgents`.
- Console check returned `0` errors and `0` warnings.
- No agent trace audit was required because this change only adjusted workspace layout and did not touch retrieval tools or runtime agent behavior.

Evidence:

- `.playwright-cli/kb-density-graph-desktop-20260516.png`
- `.playwright-cli/kb-density-graph-desktop-graph-20260516.png`
- `.playwright-cli/kb-density-admin-20260516.png`
