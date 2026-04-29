# 2026-04-17 Public Integration Runtime Test

这次是真实 current-code 验证，不是静态分析。

本目录在 2026-04-17 再次回归过一次，修正了两个之前会误导结论的问题：

1. `support-cases-http-demo` 一度因为 HTTP MCP 服务拒绝错误 host 而退化成 shell fallback。
2. `8084` 一度虽然有容器，但页面实际是空白页，因为 demo 容器缺少稳定的独立运行路径。

当前这两个问题都已经修复，并且重新做过 API + 浏览器验证。

在本次后续回归中，又针对以下问题重新跑过一次 API + 浏览器验收，因此 `01`、`02`、`03`、`07` 这几张截图已经刷新为当前代码结果：

1. 原生聊天正文偶发丢失。
2. `/v1` 调试台 assistant delta 碎片化显示。
3. `/v1` 调试台没有把 LangGraph state 里较早 assistant message 的 `thinking/reasoning` 摘要带回最终 response。

在 2026-04-20 的最新回归中，又进一步把 `8084` 重构为纯 MCP 文件调试台，
重点验证了三件事：

1. 上传器支持目录作为分类来源，并保留 `relativePath`。
2. `8084` 不再混合客服聊天，而是直接展示 MCP 规范、参数表单、调用历史和 JSON 返回。
3. 浏览器可真实执行文档型 MCP 工具，并看到参数和返回。

同一天又补做了一次 UI 回归，确认文件区已经切换为基于 `react-arborist`
的 VS Code 风格 Explorer，而不是旧的平铺按钮列表；浏览器脚本也同步改成了
树节点选择路径，避免旧断言误报失败。

在 2026-04-23 的后续修正中，又把 `8084` 的 MCP 展示语义重新收口，避免重复工具误导 agent：

1. `Agent MCP URL` 固定指向单一文档 MCP 端点。
2. `8084/` 中间工具面板始终按 agent 真实扫描结果展示，不再额外叠加 “Workbench 全量调试工具” 视角。
3. `support-cases-http-demo` 的 demo fixture 不再写死某个工具家族，而是只保留“外部知识库归属 MCP”的边界。

## 当前可复现入口

1. 先确保 current-code 后端已经运行在：
   - `http://127.0.0.1:8083`
2. 运行 setup 脚本，重建外部接入验收所需 workbench 配置：
   - `python scripts/setup_support_demo_runtime.py`
3. 这个脚本会：
   - 登录或注册测试用户
   - upsert 独立 demo 使用的 HTTP MCP profile
   - upsert 并 publish 客服 agent
   - 复用或创建 scoped API key
   - 写出本地 `.env.local` 供 demo workbench 复用
   - 严格校验 fixture 不会再把 `support-cases-http-demo` 绑定回旧的 full MCP URL
4. 然后运行真实浏览器验收：
   - `node frontend/app/e2e/public-integration-real-browser.mjs`

## 我实际验证了什么

1. 用独立 demo workbench 服务发布 HTTP MCP：
   - `custom/mcp-profiles/customer-cases-http-demo.json`
2. 真实创建并发布客服 agent：
   - `support-cases-http-demo`
3. 为已发布 agent 真实创建了作用域 API key。
4. 用真实浏览器断言式验证了 `8084` 纯 MCP 工作台。
5. 浏览器脚本现在不再只靠截图，而是会断言：
   - 目录上传后 `案例大全 · 4` 分类摘要可见
   - `document_list` 工具名、参数、返回值在新工作台里可见
   - 返回 JSON 中包含根目录下的 `案例大全` 目录项
6. 把 demo 文件服务和调试台都收敛到了独立 demo 工程：
   - `frontend/demo/compose.yaml`
   - `frontend/demo/mcp-file-service`
   - `8090` = HTTP MCP file service
   - `8084` = MCP 文件调试台
7. 把 `8084` 上传区收敛进 Explorer：
   - 文件和文件夹都直接从 Explorer 工具栏或拖拽进入
   - `relativePath` 会映射到文件服务上传接口
   - 第一层文件夹会显示为目录摘要，例如 `案例大全 · 4`

## 结果文件

- [setup-summary.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/setup-summary.json)
  - 作为期望 workbench 配置的基线摘要
- [mcp-smoke-results.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/mcp-smoke-results.json)
  - 两套 transport 的历史 API smoke 结果，作为回归参考保留
- [01-workspace-agents.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/01-workspace-agents.png)
- [02-docs-overview-current.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/02-docs-overview-current.png)
- [05-standalone-demo-http.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/05-standalone-demo-http.png)
- [05-standalone-demo-current.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/05-standalone-demo-current.png)
- [06-standalone-demo-timeline.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/06-standalone-demo-timeline.png)
- [07-workspace-playground-current.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/07-workspace-playground-current.png)
- [08-acceptance-console-uploaded.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/08-acceptance-console-uploaded.png)
  - `8084` 最新上传态；展示 Explorer 上传、文件列表、MCP 地址
- [09-acceptance-console-complete.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/09-acceptance-console-complete.png)
  - `8084` 最新完成态；展示文档 MCP 工具调用、参数、返回和调用记录
- [08-native-chat-current.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/08-native-chat-current.png)
- [10-standalone-demo-session.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/10-standalone-demo-session.png)
  - 本次 session helper 路线下的 8084 独立调试台截图
- [11-observability-session.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/11-observability-session.png)
  - 本次对应 trace 在 8081 observability 中的截图
- [04-lead-agent-create.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/04-lead-agent-create.png)
- [lead-agent-created.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/lead-agent-created.json)
  - 本次通过 `lead_agent` 真实创建出来的 agent 名

## 你现在从哪里看效果

1. 工作区 agent 列表：
   - `http://127.0.0.1:8083/workspace/agents`
2. 已发布 agent 文档概览页：
   - `http://127.0.0.1:8083/docs/agents/support-cases-http-demo`
3. MCP 文件调试台：
   - `http://127.0.0.1:8084`
4. 工作区 published agent 调试台：
   - `http://127.0.0.1:8083/workspace/agents/support-cases-http-demo/playground?agent_status=prod`
5. 原生工作区聊天页：
   - `http://127.0.0.1:8083/workspace/agents/support-cases-http-demo/chats/new?agent_status=prod`

## 你作为用户怎么直接试

### 8084 MCP 文件调试台

当前行为：

- 默认 `Workbench Base URL = http://127.0.0.1:8084`
- 默认展示 MCP URL、文件管理、调用历史，以及 agent 真实可见的 `document_*` 工具
- 不再混合 `/v1/turns` 客服聊天

### 8083 平台内页

`8083` 里只保留：

1. 已发布 agent 文档概览
2. 平台内 Playground
3. 原生工作区聊天页

客户视角的外部接入验收，不再通过 `app` 内单独的 support 页完成。

## 本次测试结论

- `http` MCP 可用
- 客服 agent 仍可真实调用客户案例数据，而不是先导入 Deer Flow 知识库
- `8084` 独立 React + Tailwind 调试台已经收敛为 MCP 文件调试台
- `8084` 已真实验证 HTTP MCP 文件服务的工具可直接手动执行
- `8083` 已删除重复的 support demo 页面，平台内只保留 docs 概览和 Playground
- `8083` 工作区 published agent playground 现在也能显示时间线式步骤、工具名、工具参数，以及最终 response JSON
- `8083` 工作区 published agent playground 现在也能把 Deer Flow 对外公开的 reasoning summary 正确显示到“思考摘要”面板
- 原生工作区聊天页已经重新验证：带工具调用的同一条 AI message 现在仍会显示最终回答，不再只剩步骤而吞掉正文
- 当前构建与目标单测通过：
  - `pnpm --dir frontend/app typecheck`
  - `pnpm --dir frontend/app exec vitest run src/core/public-api/run-session.test.ts`
  - `pnpm --dir frontend/demo typecheck`
  - `pnpm --dir frontend/demo build`

## 当前额外确认

- `docker/docker-compose-prod.yaml` 不再承载测试用 HTTP MCP。
- `frontend/demo/compose.yaml` 单独承载 `8084` 和 `8090`，更贴近真实客户外部接入。
- `support-cases-http-demo` 现在已真实走 HTTP MCP，不再出现“没有可用 customer-cases MCP 工具”的错误回答。
- `scripts/setup_support_demo_runtime.py` 现在会拒绝旧的 full MCP fixture，避免下次 setup 又把 demo agent 绑回错误工具面。
- 当时的 `8084` agent-facing MCP 暴露了四个文档工具；后续已收敛为当前 README 记录的三个工具面。
- `8084` 现在不是假通，而是可渲染、可上传目录、可执行 MCP 工具并查看 JSON 返回的真实页面。
- `8084` 最新上传区已经并入 Explorer，目录上传会保留分类层级，并支持直接拖拽到文件树。
