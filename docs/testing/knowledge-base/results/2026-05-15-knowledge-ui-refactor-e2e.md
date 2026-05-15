# Knowledge UI Refactor E2E - 2026-05-15

## Scope

- App: `http://127.0.0.1:8083`
- Knowledge base: `bazi-cases-e2e-20260515-r2`
- Base id: `bde66990-dab7-4599-8e02-1148fd78bbe6`
- Owner id: `8967906e-7853-4170-9c6c-b8e961fbcebd`
- Browser session: `playwright-cli -s=kb-ui`

## Verification

- Rebuilt current code with `./scripts/docker-release.sh build --scope app`.
- Restarted deploy stack with `OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh`.
- Logged in as `admin`.
- Opened `/workspace/knowledge?owner=8967906e-7853-4170-9c6c-b8e961fbcebd&base=bde66990-dab7-4599-8e02-1148fd78bbe6`.
- Confirmed the selected base opens directly into `Wiki Workspace` with `wiki/index.md`.
- Confirmed the source rail shows `64 documents` and source rows are clickable.
- Clicked source row `cases.md: 丁丑日柱盲派八字真实案例`; the preview sheet opened and showed canonical text plus overview/tree/events/index tabs.
- Opened `Graph`; confirmed `67 graph nodes`, selected-node inspector, communities, insights, and `64 / 64 edges rendered`.
- Clicked `Open in Wiki` from the graph inspector and returned to the matching Wiki page.
- Captured mobile viewport `390x844` after the responsive fix; no text overlap was visible in the first viewport.
- Final browser console check: `0` errors, `0` warnings.

## Artifacts

- Desktop/source preview screenshot: `.playwright-cli/kb-ui-refactor-preview.png`
- Mobile fixed screenshot: `.playwright-cli/kb-ui-refactor-mobile-fixed.png`
- Mobile workbench screenshot attempt: `.playwright-cli/kb-ui-refactor-mobile-workbench-pagedown.png`

## Notes

- Full frontend lint still reports pre-existing repo-wide lint errors outside the knowledge UI refactor files. Targeted eslint for `thread-knowledge-management-page.tsx` passes.
