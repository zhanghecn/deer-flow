# llm_wiki Compiler E2E - 2026-05-15

## Scope

- App: `http://127.0.0.1:8083`
- Admin: `http://127.0.0.1:8081`
- Deploy stack: `deploy/docker-compose.yml`
- Browser: `playwright-cli -s=llmwiki-r2 open --browser=chrome --headed`
- Account: `admin / admin123`
- Knowledge base: `llm-wiki-compile-e2e-20260515-r2`
- Base id: `a238cef2-b179-4066-9ba9-e7ea13fe6b71`
- Owner id: `8967906e-7853-4170-9c6c-b8e961fbcebd`
- Upload file: `.playwright-cli/llm-wiki-compile-e2e.md`

## Build And Deploy

- Build: `./scripts/docker-release.sh build --scope app`
- Deploy: `OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh`
- Current image evidence:
  - `zhangxuan2/openagents-web:latest` `sha256:8b6ed3b4249745354ba655160a2e315b490b95814adad1a3b50b13730f66e2e6`
  - `zhangxuan2/openagents-gateway:latest` `sha256:78b0a73cd0372796155882cba533e1babe3400e1c0641df16b3f315d308da292`
  - `zhangxuan2/openagents-langgraph:latest` `sha256:934031b0395f06bc1fb02f8861255b383679eb13a103c7caa1360dfad230c10b`

## Compiler Result

The knowledge worker completed the job and recorded llm_wiki generation events.

- Build job: `ready`, stage `completed`, progress `100`.
- Document: `ready_degraded`, `4` nodes. The degraded quality came from the legacy branch-summary fallback because the selected provider rejected `tool_choice`; it did not block workspace compilation.
- `llm_wiki_ingest`: `completed`.
- LLM-generated FILE block pages:
  - `wiki/concepts/合同解除权.md`
  - `wiki/concepts/损害赔偿范围.md`
  - `wiki/concepts/知识组织原则：概念复用.md`
  - `wiki/concepts/违约责任.md`
  - `wiki/concepts/通知义务.md`
  - `wiki/entities/open-agents.md`
- Workspace sync wrote `12` artifacts, including deterministic source/cache pages plus the generated shared pages.

## Browser Result

Passed on `http://127.0.0.1:8083/workspace/knowledge?owner=8967906e-7853-4170-9c6c-b8e961fbcebd&base=a238cef2-b179-4066-9ba9-e7ea13fe6b71`.

- Logged in as `admin`.
- Created the knowledge base through the real browser upload dialog.
- Waited for the worker to finish and reloaded the knowledge page.
- Header showed `1 document` and `1 ready`.
- `Wiki Workspace` opened at `wiki/index.md`.
- Workspace tree API returned `20` files:
  - `.llm-wiki/image-caption-cache.json`
  - `.llm-wiki/ingest-cache.json`
  - `.llm-wiki/ingest-queue.json`
  - `raw/sources/.cache/llm-wiki-compile-e2e-fedc657c.txt`
  - `wiki/sources/llm-wiki-compile-e2e-fedc657c.md`
  - deterministic concept pages under `wiki/concepts/llm-wiki-compile-e2e-fedc657c--*.md`
  - LLM-generated shared pages under `wiki/concepts/*.md` and `wiki/entities/open-agents.md`
  - `wiki/index.md`, `wiki/log.md`, `wiki/overview.md`, `purpose.md`, `schema.md`
- `wiki/concepts/合同解除权.md` opened through the browser API and contained frontmatter `sources: ["llm-wiki-compile-e2e.md"]` plus wikilinks to `违约责任`, `通知义务`, and `损害赔偿范围`.
- `Graph` tab rendered with node-type counts:
  - `index 1`
  - `concept 9`
  - `source 1`
  - `entity 1`
  - `log 1`
  - `overview 1`
- Graph API returned:
  - nodes: `14`
  - edges: `29`
  - communities: `4`
  - isolated nodes: `0`
  - sparse communities: `0`
- `Open in Wiki` from the graph inspector opened `wiki/concepts/llm-wiki-compile-e2e-fedc657c--llm-wiki-compile-e2e-20260515.md`.
- Browser console: `0` errors. WebGL emitted GPU performance warnings only.

## Artifacts

- Graph screenshot: `.playwright-cli/llm-wiki-graph-r2.png`

## Remaining Risk

- The llm_wiki compiler path is now wired end to end, but provider behavior still matters. This run succeeded only after the parser accepted the model's FILE block format and repair retry was available.
- Large corpus testing is still separate. This pass proves the compiler and graph integration on a small Markdown fixture, not a 100-document / 200-page PDF corpus.
- The legacy document summary indexer can still degrade with providers that reject `tool_choice`; workspace compilation and retrieval remained usable in this run.
