# 2026-04-17 Support SDK Demo Runtime Test

这次是真实 current-code 验证，不是静态分析。

本目录在 2026-04-17 再次回归过一次，修正了两个之前会误导结论的问题：

1. `support-cases-http-demo` 一度因为 HTTP MCP 服务拒绝 `Host: customer-cases-mcp-http:8000` 而退化成 shell fallback。
2. `8084` 一度虽然有容器，但页面实际是空白页，因为 demo 容器缺少给共享 `frontend/app/src` 使用的模块解析路径。

当前这两个问题都已经修复，并且重新做过 API + 浏览器验证。

在本次后续回归中，又针对以下问题重新跑过一次 API + 浏览器验收，因此 `01`、`02`、`03`、`07` 这几张截图已经刷新为当前代码结果：

1. 原生聊天正文偶发丢失。
2. `/v1` 调试台 assistant delta 碎片化显示。
3. `/v1` 调试台没有把 LangGraph state 里较早 assistant message 的 `thinking/reasoning` 摘要带回最终 response。

## 当前可复现入口

1. 先确保 current-code 后端已经运行在：
   - `http://127.0.0.1:8083`
2. 运行 setup 脚本，重建 support demo 所需 fixture：
   - `python scripts/setup_support_demo_runtime.py`
   - 如果案例目录不在默认位置，先设置：
     - `export OPENAGENTS_SUPPORT_CASES_SOURCE=/your/customer/cases`
3. 这个脚本会：
   - 把 `OPENAGENTS_SUPPORT_CASES_SOURCE` 指向的案例目录同步到 `.openagents/runtime/customer-cases`
   - 登录或注册测试用户
   - upsert 两个 MCP profile
   - upsert 并 publish 两个客服 agent
   - 复用或创建两个 scoped API key
   - 刷新 `frontend/demo/.env.local`
   - 写出 `setup-summary.runtime.json`
4. 然后运行真实浏览器验收：
   - `node frontend/app/e2e/support-demo-real-browser.mjs`

## 我实际验证了什么

1. 把 `/root/project/ai/ai-numerology/backend/agents/examples/案例大全` staging 到 Deer Flow 本地运行目录：
   - `.openagents/runtime/customer-cases`
2. 用同一套案例数据发布两种 MCP transport：
   - `custom/mcp-profiles/customer-cases-stdio-demo.json`
   - `custom/mcp-profiles/customer-cases-http-demo.json`
3. 真实创建并发布两个客服 agent：
   - `support-cases-stdio-demo`
   - `support-cases-http-demo`
4. 为两个已发布 agent 真实创建了作用域 API key。
5. 用真实浏览器断言式验证了原生 `turns` SDK 链路：
   - `8083` 工作区 agents 列表
   - `8083` 公开客服页
   - `8084` 独立 SDK demo 的 `stdio` agent
   - `8084` 独立 SDK demo 的 `http` agent
   - `8083` 工作区 published agent playground
6. 浏览器脚本现在不再只靠截图，而是会断言：
   - `grep_files` 工具名可见
   - `盲派八字全知识点训练集` 命中文件可见
7. 把 HTTP MCP 测试链路单独拆到了独立 compose：
   - `docker/docker-compose-support-demo.yaml`
   - `8090` = HTTP MCP mock
   - `8084` = 外部 SDK demo

## 结果文件

- [setup-summary.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/setup-summary.json)
  - 作为期望 fixture 的基线摘要
- [setup-summary.runtime.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/setup-summary.runtime.json)
  - setup 脚本本次真实重放后的用户、profile、agent、token
- [mcp-smoke-results.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/mcp-smoke-results.json)
  - 两套 transport 的历史 API smoke 结果，作为回归参考保留
- [01-workspace-agents.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/01-workspace-agents.png)
- [02-docs-support-http.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/02-docs-support-http.png)
- [03-standalone-demo-stdio.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/03-standalone-demo-stdio.png)
- [05-standalone-demo-http.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/05-standalone-demo-http.png)
- [05-standalone-demo-current.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/05-standalone-demo-current.png)
- [06-standalone-demo-timeline.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/06-standalone-demo-timeline.png)
- [07-workspace-playground-current.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/07-workspace-playground-current.png)
- [08-native-chat-current.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/08-native-chat-current.png)
- [04-lead-agent-create.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/04-lead-agent-create.png)
- [lead-agent-created.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/lead-agent-created.json)
  - 本次通过 `lead_agent` 真实创建出来的 agent 名

## 你现在从哪里看效果

1. 工作区 agent 列表：
   - `http://127.0.0.1:8083/workspace/agents`
2. HTTP MCP 的公开客服页：
   - `http://127.0.0.1:8083/docs/agents/support-cases-http-demo/support`
3. 独立 SDK demo：
   - `http://127.0.0.1:8084`
4. 工作区 published agent 调试台：
   - `http://127.0.0.1:8083/workspace/agents/support-cases-http-demo/playground?agent_status=prod`
5. 原生工作区聊天页：
   - `http://127.0.0.1:8083/workspace/agents/support-cases-http-demo/chats/new?agent_status=prod`

## 你作为用户怎么直接试

### 8084 独立 demo

我已经生成了本地专用预填配置：

- `frontend/demo/.env.local`

当前行为：

- 默认 `Base URL = http://127.0.0.1:8083/v1`
- 默认 `Agent = support-cases-http-demo`
- 默认已经带上可用 `User Key`
- 点击 `切到 stdio Agent` / `切到 HTTP Agent` 时，会自动切换到对应 agent，并自动替换成对应 key

如果 8084 页面已经开着，请刷新一次让新的 `.env.local` 生效。

### 8083 公开客服页

手动填：

- `Base URL`: `http://127.0.0.1:8083/v1`
- `用户 Key`: 看 `setup-summary.json` 里 `support-cases-http-demo` 对应 token

推荐直接问这 4 句：

1. `案例库里有哪些文件？请直接列出文件名，不要编造。`
2. `请读取《盲派八字全知识点训练集.md》的第一页，并告诉我这个文件的标题。`
3. `请只列出文件名以 Final_ 开头的案例文件。`
4. `请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。`

## 本次测试结论

- `stdio` MCP 可用
- `http` MCP 可用
- 两者都能在客服 agent 中真实调用客户案例数据，而不是先导入 Deer Flow 知识库
- `8084` 独立 React + Tailwind SDK demo 已经能作为外部接入示例使用
- `8084` 已经真实验证 `stdio` 与 `http` 两种 transport 都能走原生 `/v1/turns`
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
- `docker/docker-compose-support-demo.yaml` 单独承载 `8084` 和 `8090`，更贴近真实客户外部接入。
- `support-cases-http-demo` 现在已真实走 HTTP MCP，不再出现“没有可用 customer-cases MCP 工具”的错误回答。
- `8084` 现在不是假通，而是可渲染、可输入、可调用 SDK API 的真实页面。
