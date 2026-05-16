# Knowledge UI Binding E2E - 2026-05-16

## Scope

- App: `http://127.0.0.1:8083`
- Deploy stack: `deploy/docker-compose.yml`
- Account: `admin / admin123`
- Full bazi knowledge base: `bazi-cases-full-llm-wiki-e2e-20260515-r5`
- Full bazi base id: `115eea70-52e5-48a6-9fa7-bb0a34cb35fe`

## Code Verification

```bash
cd frontend/app
corepack pnpm typecheck
corepack pnpm test:unit -- \
  src/components/workspace/knowledge/knowledge-base-upload-dialog.test.tsx \
  src/components/workspace/knowledge/knowledge-selector-dialog.test.tsx \
  src/components/workspace/knowledge/thread-knowledge-attachment-strip.test.tsx \
  src/components/workspace/knowledge/thread-knowledge-management-page.test.ts \
  'src/app/workspace/agents/[agent_name]/settings/page.test.tsx'
corepack pnpm exec eslint \
  src/components/workspace/agent-settings/capabilities-tab.tsx \
  src/components/workspace/agent-settings/i18n.ts \
  src/components/workspace/knowledge/knowledge-base-upload-dialog.test.tsx \
  src/components/workspace/knowledge/knowledge-base-upload-dialog.tsx \
  src/components/workspace/knowledge/knowledge-build-summary.tsx \
  src/components/workspace/knowledge/knowledge-canonical-preview.tsx \
  src/components/workspace/knowledge/knowledge-display.ts \
  src/components/workspace/knowledge/knowledge-management-types.ts \
  src/components/workspace/knowledge/knowledge-preview-panel.tsx \
  src/components/workspace/knowledge/thread-knowledge-attachment-strip.tsx \
  src/components/workspace/knowledge/thread-knowledge-management-page.tsx \
  src/core/i18n/locales/en-US.ts \
  src/core/i18n/locales/types.ts \
  src/core/i18n/locales/zh-CN.ts
```

Results:

- `typecheck` passed.
- Related unit command passed: `62 passed`, `288 tests`.
- Targeted eslint passed.
- `git diff --check` passed.

## Current-Code Deploy

```bash
./scripts/docker-release.sh build --scope frontend
OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh
```

Results:

- Frontend release image built successfully.
- Deploy stack restarted successfully.

## Browser Verification

Used headed Chrome through `playwright-cli --headed`.

Knowledge library:

- Opened `/workspace/knowledge`.
- Selected owner `admin`.
- Selected `bazi-cases-full-llm-wiki-e2e-20260515-r5`.
- Confirmed `64 documents`, `64 ready`, `Build health`, and `100%`.
- Confirmed `Wiki Workspace` opens `wiki/index.md`.
- Opened `Graph`; confirmed `263 graph nodes` and `409 / 714 edges rendered`.
- Confirmed graph content contains `壬寅日柱案例集（巾箱秘术）`.

Upload and stale-path regression:

- Created temporary knowledge base `kb-ui-smoke-20260516-1511` from `tmp/openagents-kb-ui-smoke.md`.
- Upload dialog displayed `1 file ready to upload`, `Total size 79 B`, and `openagents-kb-ui-smoke.md`.
- Temporary base reached `1 ready`, `Build health`, and `100%`.
- Opened source preview and confirmed canonical text rendered.
- Network log showed no `500` responses during base switching.
- Deleted the temporary knowledge base through the browser.
- Cleanup left only the full bazi knowledge base under `admin`.

Agent binding:

- Opened `/workspace/agents/bazi-mingli-e2e-20260515/settings?agent_status=prod`.
- Opened `Capabilities`.
- Confirmed the knowledge binding list includes a search input.
- Confirmed the bazi knowledge base is grouped under `admin` and shows `64 documents · 64 ready`.
- Searched `bazi`; the matching knowledge base remained visible.

Final browser checks:

- Knowledge graph page produced only WebGL performance warnings during graph rendering.
- Agent settings page console check returned `0` errors and `0` warnings.
