# Knowledge Worker Concurrency And Reuse Smoke

日期：2026-05-16 02:10-02:38 Asia/Shanghai

## 目标

验证知识库后台编译链路在新增 worker 并发和 llm-wiki ingest cache 版本化复用后，仍然能在当前代码 deploy 栈中通过真实浏览器上传、后台编译、写入 Wiki Workspace，并且不污染既有命理完整知识库。

## 环境

- App：`http://127.0.0.1:8083`
- Deploy 栈：`deploy/docker-compose.yml`
- 账号：`admin / admin123`
- LangGraph image：`zhangxuan2/openagents-langgraph:latest`
- 当前验证环境变量：`OPENAGENTS_KNOWLEDGE_WORKER_CONCURRENCY=2`

## 代码级验证

```bash
uv run --project backend/agents pytest \
  backend/agents/tests/test_knowledge_worker.py \
  backend/agents/tests/test_wiki_workspace.py \
  backend/agents/tests/test_knowledge_runtime.py \
  backend/agents/tests/test_tools_runtime_loading.py \
  backend/agents/tests/test_knowledge_service.py -q

uv run --project backend/agents ruff check \
  backend/agents/src/knowledge/worker.py \
  backend/agents/src/knowledge/repository.py \
  backend/agents/src/knowledge/wiki_workspace.py \
  backend/agents/src/knowledge/llm_wiki_ingest.py \
  backend/agents/tests/test_knowledge_worker.py \
  backend/agents/tests/test_wiki_workspace.py
```

结果：

- `54 passed`
- `ruff` passed
- `git diff --check` passed

## 当前代码部署验证

```bash
./scripts/docker-release.sh build --scope app
OPENAGENTS_KNOWLEDGE_WORKER_CONCURRENCY=2 OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh
```

容器验证：

```bash
docker exec openagents-langgraph-1 printenv OPENAGENTS_KNOWLEDGE_WORKER_CONCURRENCY
docker logs openagents-langgraph-1 --tail 80 | rg "Started .*knowledge build worker"
```

结果：

- 容器内 `OPENAGENTS_KNOWLEDGE_WORKER_CONCURRENCY=2`
- 日志显示 `Started 2 knowledge build worker thread(s).`

## 真实浏览器 Smoke

使用 headed Chrome 登录 8083，创建临时知识库：

- Knowledge base：`kb-worker-simplified-smoke-20260516`
- Knowledge base id：`13d1bebe-ca8f-4adf-8586-60629dc67798`
- Source：`.playwright-cli/kb-worker-simplified-smoke.md`
- Marker：`simplified worker smoke marker`

结果：

- DB build job：`ready / completed`
- 编译耗时：`37.9s`
- UI 显示：`kb-worker-simplified-smoke.md · 1 ready`
- Wiki Workspace 中可见：
  - `wiki/sources/kb-worker-simplified-smoke-1bcd49a8.md`
  - `raw/sources/.cache/kb-worker-simplified-smoke-1bcd49a8.txt`
  - 页面显示 `Simplified Knowledge Worker Smoke`

Build events：

- `canonical_markdown` completed
- `parse_markdown_headings` completed
- `branch_summary` completed
- `document_description` completed
- `llm_wiki_ingest` completed
- `wiki_workspace_sync` completed
- `index_complete` completed

## 清理

临时 smoke 知识库已通过真实浏览器删除。

清理后 DB 确认只剩完整命理知识库：

- `bazi-cases-full-llm-wiki-e2e-20260515-r5`
- id：`115eea70-52e5-48a6-9fa7-bb0a34cb35fe`
- `64 documents / 64 ready`

## 已知缺口

- 本次 smoke 验证了当前代码后台编译和 workspace 写入，没有重跑完整 64 文件长编译。
- worker 并发是文档级并发；同一知识库的 llm-wiki workspace 写入仍按知识库加锁串行化，避免共享 `wiki/index.md`、`wiki/overview.md`、`wiki/log.md` 被并发覆盖。
