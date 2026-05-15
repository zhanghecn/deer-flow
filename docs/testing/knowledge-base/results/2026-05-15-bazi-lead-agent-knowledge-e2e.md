# 八字命理 Agent 知识库真实 E2E

日期：2026-05-15

## 目标

验证真实浏览器流程可以串通以下链路：

1. 通过 `lead_agent` 创建命理 agent。
2. 在知识库页面上传 `ai-numerology/backend/agents/examples/案例大全`。
3. 在新建 agent 的 prod chat 中选择该知识库。
4. 询问“壬寅日主丑月出生的案例”，确认 agent 使用 Wiki Workspace 工具链检索。

## 环境

- App：`http://127.0.0.1:8083`
- Admin：`http://127.0.0.1:8081`
- Deploy 栈：`deploy/docker-compose.yml`
- 账号：`admin`
- Agent：`bazi-mingli-e2e-20260515`
- Chat thread：`ee14957c-6f5b-48f6-928a-895544ad7229`
- Trace：`adf80686-e809-48d0-b904-254142e694f5`
- Knowledge base：`bazi-cases-e2e-20260515-r2`
- Knowledge base id：`bde66990-dab7-4599-8e02-1148fd78bbe6`

## 步骤与结果

1. 在 8083 使用 `lead_agent` 创建 `bazi-mingli-e2e-20260515`。
   - UI Agent 列表最初显示 `Draft only`。
   - 通过 Agent 页面点击 `Publish to prod` 后显示 `published`。

2. 在 8083 Knowledge 页面上传八字案例知识库。
   - 源目录：`/root/project/ai/ai-numerology/backend/agents/examples/案例大全`
   - 上传文件数：64 个 Markdown 文件。
   - Playwright CLI 只能上传 repo 允许根目录下的文件，因此测试临时复制到 `.playwright-cli/bazi-case-upload/`；该目录已被 `.gitignore` 忽略。

3. 首次上传暴露 worker bug。
   - 旧代码在多文档 Wiki Workspace overview 重写时直接排序 `WikiPage` 对象。
   - 报错：`TypeError: '<' not supported between instances of 'WikiPage' and 'WikiPage'`。
   - 修复：`_rewrite_workspace_overview` 按 `page.path` 稳定排序。
   - 回归测试：新增多 source 同步用例，覆盖多文档 overview 重写。

4. 重新构建并启动 deploy 栈后重传 r2 知识库。
   - `bazi-cases-e2e-20260515-r2` 最终状态：64/64 `ready_degraded`。
   - `ready_degraded` 原因是摘要模型接口返回 400 后降级解析；Wiki Workspace 文件和检索能力可用。

5. 进入 prod agent 新 chat 并选择知识库。
   - 页面显示 `1 knowledge base`。
   - 附加知识库卡片显示 `bazi-cases-e2e-20260515-r2`、`Ready`、`64 documents`。

6. 提问：
   - “请在已绑定的八字案例知识库中查找并分析壬寅日主丑月出生的相关案例。请先说明你检索到了哪些壬寅柱或丑月相关案例，再总结案例共性；必须基于知识库，不要凭空补充。”

## 工具链验证

8083 聊天页显示：

- `search_knowledge_workspace`
  - query：`壬寅日柱 丑月 案例`
  - workspace：`bde66990-dab7-4599-8e02-1148fd78bbe6`
- `search_knowledge_workspace`
  - query：`壬寅日 丑月 八字`
  - workspace：`bde66990-dab7-4599-8e02-1148fd78bbe6`
- `get_wiki_page`
  - `wiki/sources/cases-49c45cc1.md`
- `get_wiki_page`
  - `wiki/sources/cases-90bc17b8.md`
- `get_wiki_page`
  - `wiki/sources/cases-551d4869.md`

未观察到旧工具 `get_document_tree`。

## 回答结果

agent 基于 `cases-49c45cc1.md` 找到严格符合“壬寅日主 + 丑月出生”的 3 个案例：

- 案例35（例153）：`己酉 丁丑 壬寅 戊申`，女，1969.12.15 申时。
- 案例36（例154）：`壬戌 癸丑 壬寅 辛亥`，女，1922.12.13 亥时。
- 案例37（例155）：`庚寅 己丑 壬寅 辛亥`，男，1890.12.7 亥时。

回答总结了共同口诀“壬寅日元丑月生，斗牛箕星论壬命”、婚姻/六亲问题、年时两头钳结构和不同天干导致的成就差异。

## Admin Audit

8081 Observability 页面确认：

- trace agent：`bazi-mingli-e2e-20260515`
- thread：`ee14957c-6f5b-48f6-928a-895544ad7229`
- status：completed
- registered tools 包含 `search_knowledge_workspace`、`get_wiki_page`
- event 列表包含 2 次 `search_knowledge_workspace` 与 3 次 `get_wiki_page`
- 未观察到 `get_document_tree`

## 验证命令

```bash
cd backend/agents
uv run pytest tests/test_wiki_workspace.py -q
uv run ruff check src/knowledge/wiki_workspace.py tests/test_wiki_workspace.py
```

结果：

- `7 passed`
- `All checks passed`

部署验证：

```bash
./scripts/docker-release.sh build --scope app
OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh
```

最终容器状态：

- `openagents-langgraph-1` healthy
- `openagents-nginx-1` healthy
- `openagents-gateway-1` healthy
- `openagents-postgres-1` healthy
- `openagents-minio-1` running

## 剩余风险

- r2 知识库为 `ready_degraded`，说明当前摘要模型接口返回 400 后依赖降级解析。检索与问答已通过，但后续应单独检查模型网关兼容性，避免大文档摘要质量降低。

## 后续修正

- lead_agent 在创建说明中曾把 `get_workspace_file_tree` 描述成“原 get_document_tree”，该说法不准确；已在该测试 agent 的 dev/prod 运行时 `AGENTS.md` 中修正为：不要使用旧 PageTree 工具 `get_document_tree` 作为默认链路，`get_workspace_file_tree` 仅用于导航/审计，不作为问答首步。

## r4 llm-wiki 对齐复测

日期：2026-05-15 18:19 Asia/Shanghai

### 目标

复测彻底切到 Wiki Workspace 后，单 source 编译出的 `related` 关系是否能进入浏览器图谱和 agent 问答链路，避免图谱只剩 `index.md` 星型边或 agent 回退旧 PageTree 工具。

### 环境

- App：`http://127.0.0.1:8083`
- Admin：`http://127.0.0.1:8081`
- Deploy 栈：`deploy/docker-compose.yml`
- Browser：`playwright-cli -s=openagents-kb-headed --headed --browser=chrome`
- Agent：`bazi-mingli-e2e-20260515`
- Chat thread：`ee14957c-6f5b-48f6-928a-895544ad7229`
- Trace：`be16ccb3-eaa1-416a-b5ca-fbe30ffe1471`
- Knowledge base：`bazi-cases-llm-wiki-e2e-20260515-r4`
- Knowledge base id：`6a34fdc8-925c-4bef-a8d5-4d572db7784e`
- Source：`cases.md`

### 编译产物抽检

- `wiki/overview.md` 是领域总结，不是路径清单。
- `wiki/index.md` 是 llm-wiki 风格索引。
- `wiki/sources/cases-fed55783.md` 保存源摘要与 OpenAgents source evidence marker。
- `raw/sources/.cache/cases-fed55783.txt` 保存原始抽取文本，可被 `get_source_evidence` 精确检索。

### Graph 复测

旧问题：API 只有 `index -> page` 边，前端默认隐藏结构页后显示 `0 / 11 edges rendered`。

修复后结果：

- Graph API：`14` nodes，`44` edges，其中包含非结构边，例如：
  - `壬寅日柱 -> 巾箱秘术`
  - `壬寅日柱 -> 巾箱诀法`
  - `壬寅日柱 -> 字碰字`
  - `cases-fed55783 -> 壬寅日柱`
- 8083 Graph tab：`14 graph nodes`，`11 / 14 pages`，`33 / 44 edges rendered`。
- 右侧 Edge list 可见实体、概念、source 之间的关系边。

### Agent 问答复测

在 8083 真实浏览器中给线程绑定 r4 知识库后提问：

> 请只基于当前已绑定的 bazi-cases-llm-wiki-e2e-20260515-r4 知识库，检索并回答：壬寅日主丑月出生的案例有哪些？请列出案例编号、四柱、性别、关键断语，并说明你引用的 wiki/source 路径。

观察到工具链：

- `search_knowledge_workspace`
  - query：`壬寅日 丑月 案例`
  - workspace：`6a34fdc8-925c-4bef-a8d5-4d572db7784e`
- `get_wiki_page`
  - `wiki/sources/cases-fed55783.md`
- `get_source_evidence`
  - query：`壬寅日元丑月生`
- `get_source_evidence`
  - query：`壬寅 丑月 斗牛箕星`

未观察到旧工具 `get_document_tree`。

### 回答结果

agent 基于 r4 知识库找到 3 个壬寅日主丑月案例：

- 案例35（例153）：`己酉 丁丑 壬寅 戊申`，女（坤造）。断语包含“壬寅日元丑月生，斗牛箕星论壬命；勾陈碰己大不吉，婚姻几重多晦气。”
- 案例36（例154）：`壬戌 癸丑 壬寅 辛亥`，女（坤造）。断语包含“水星叠叠克六亲，几经磨难无需论。”
- 案例37（例155）：`庚寅 己丑 壬寅 辛亥`，男（乾造）。断语包含“双寅入局生性灵，金水相涵学问通。”

引用路径：

- Wiki：`wiki/sources/cases-fed55783.md`
- 原始缓存：`raw/sources/.cache/cases-fed55783.txt`

### Admin Audit

8081 Observability 最新 trace 显示：

- registered tools：`search_knowledge_workspace`、`get_wiki_page`、`get_source_evidence`
- events：1 次 `search_knowledge_workspace`、1 次 `get_wiki_page`、2 次 `get_source_evidence`
- 未出现 `get_document_tree`

### 验证命令

```bash
uv run --project backend/agents pytest backend/agents/tests/test_wiki_workspace.py backend/agents/tests/test_knowledge_runtime.py backend/agents/tests/test_tools_runtime_loading.py -q
uv run --project backend/agents ruff check backend/agents/src/knowledge/llm_wiki_ingest.py backend/agents/src/knowledge/wiki_workspace.py backend/agents/tests/test_wiki_workspace.py
(cd backend/gateway && go test ./internal/handler ./internal/model -count=1)
corepack pnpm --dir frontend/app typecheck
./scripts/docker-release.sh build --scope app
OPENAGENTS_PULL_IMAGES=0 ./scripts/docker-deploy.sh
```

结果：

- agents tests：`45 passed`
- ruff：passed
- gateway handler/model：passed
- frontend typecheck：passed
- images：
  - `zhangxuan2/openagents-web:latest` `c3618dda4505`
  - `zhangxuan2/openagents-gateway:latest` `be9372af26c1`
  - `zhangxuan2/openagents-langgraph:latest` `53f25e7a541a`
