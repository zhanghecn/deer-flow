# 2026-05-15 Wiki Workspace Current-Code E2E

## Environment

- Stack: `deploy/docker-compose.yml`
- Build: `./scripts/docker-release.sh build --scope all`, then after the MinIO missing-object fix `./scripts/docker-release.sh build --scope app`
- Deploy: `OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh`
- App URL: `http://127.0.0.1:8083`
- Admin URL: `http://127.0.0.1:8081`
- Browser: `playwright-cli open --headed http://127.0.0.1:8083`
- Account: `admin / admin123`

Current-code image evidence:

- `openagents-web:latest` `sha256:73bcde4490ce927175104fa54beba09f756d59ab776864514bbf0c955259ec2c`
- `openagents-gateway:latest` `sha256:a78171a0ceb38b65f2ce6406264a382e244fe3381085221b7ee5131c14fda3cf`
- `openagents-langgraph:latest` `sha256:602c9d7504a71856ab390eb715bcc5ce1ed4ef4cb41223d847bc89eb96f943f9`

## Test Data

- Knowledge base: `Wiki Workspace E2E Fixed 20260515`
- Base id: `0a3d9a9c-0acf-4ecf-9cf4-61e0f47572bb`
- Document: `openagents-wiki-workspace-test.md`
- Document id: `47c7c131-631f-4753-86d8-08aeb6f7b4f1`
- Chat thread: `b59c3b43-3fd8-4f4f-b004-92337b3725d7`

## Browser Result

Passed on `http://127.0.0.1:8083`.

- Login succeeded.
- Knowledge upload succeeded.
- Build reached `ready_degraded` / completed; preview showed `Ready`, `markdown`, `4 nodes`, and `100%`.
- `Sources`, `Wiki Workspace`, and `Graph` tabs were clickable.
- Wiki Workspace tree showed `.llm-wiki`, `raw/sources/.cache`, `wiki/sources`, `wiki/index.md`, `wiki/log.md`, `wiki/overview.md`, `purpose.md`, and `schema.md`.
- Wiki page content opened at `wiki/sources/openagents-wiki-workspace-test-47c7c131.md`.
- Graph showed nodes and edge `index -> openagents-wiki-workspace-test-47c7c131 | 3.5`.
- Chat attached `1 knowledge base` from the selector.

## Agent Result

Knowledge question:

> 根据已绑定知识库，WIKI-REWRITE-0515 在大规模多文档知识库下的正确检索顺序是什么？

8083 trace showed:

- `search_knowledge_workspace` with `workspace_name_or_id=0a3d9a9c-0acf-4ecf-9cf4-61e0f47572bb`
- `get_wiki_page` with `page_path=wiki/sources/openagents-wiki-workspace-test-47c7c131.md`
- No default `get_document_tree` tool call.
- No raw `glob` / `read_file` crawl for attached knowledge.

Non-KB question on the same thread:

> 非知识库问题：1+1 等于几？

The agent answered `2` directly.

## Admin Audit

Passed on `http://127.0.0.1:8081/observability`.

- Knowledge trace id: `72552526-0259-4d62-b2b8-00da26ef7d3e`
- Admin trace registered default workspace tools: `search_knowledge_workspace`, `get_wiki_page`, `get_source_evidence`, `get_knowledge_graph`, `get_workspace_file_tree`.
- Admin trace tool events confirmed `search_knowledge_workspace` then `get_wiki_page`.
- Non-KB trace id: `79fc225e-dd17-4a69-a186-76fe520b9a06`
- Non-KB trace final answer was `2`; no tool event was shown for the turn.

## Fix Found During Test

The first MinIO-backed workspace build failed because Python KAS did not normalize MinIO `NoSuchKey` into `FileNotFoundError`. This broke first-write checks for missing workspace files such as `purpose.md`.

Fixed in `backend/agents/src/knowledge/storage.py` and covered by `test_minio_missing_object_maps_to_file_not_found`.

## Known Gaps

- This pass used a Markdown document. PDF and DOCX matrix coverage still needs a separate ingestion run if the change under review touches format conversion or visual evidence.
- The first failed test base (`af9bc44a-0d7b-4077-ba32-eda86f29001c`) remains a test artifact from the pre-fix run.
