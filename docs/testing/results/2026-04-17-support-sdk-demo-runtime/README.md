# 2026-04-17 Support SDK Demo Runtime Test

这次是真实 current-code 验证，不是静态分析。

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
5. 用 `/v1/responses` 跑了 4 类客户验收问题：
   - 列文件
   - 分页读文件
   - glob 过滤
   - grep 搜索
6. 用真实浏览器截图验证了：
   - `8083` 工作区 agents 列表
   - `8083` 公开客服页
   - `8084` 独立 SDK demo
   - `8083` 的 `lead_agent` 创建入口

## 结果文件

- [setup-summary.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/setup-summary.json)
  - 本次创建的测试用户、profile、agent、token
- [mcp-smoke-results.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/mcp-smoke-results.json)
  - 两套 transport 的真实 `/v1/responses` 结果
- [01-workspace-agents.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/01-workspace-agents.png)
- [02-docs-support-http.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/02-docs-support-http.png)
- [03-standalone-demo-stdio.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-17-support-sdk-demo-runtime/03-standalone-demo-stdio.png)
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
- 当前构建与目标单测通过：
  - `pnpm --dir frontend/app typecheck`
  - `pnpm --dir frontend/app exec vitest run src/core/public-api/run-session.test.ts`
  - `pnpm --dir frontend/demo typecheck`
  - `pnpm --dir frontend/demo build`
