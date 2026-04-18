# Support SDK Demo Real Test

> 说明：这份记录保留为 2026-04-16 的历史结果。当前仓库已经硬切到
> “原生 `/v1/turns` + session helper” 路线，不再把官方 `openai`
> JavaScript SDK 作为一等接入标准；同时 `app` 内的 `/docs/.../support`
> 页面也已经删除，外部客服接入验收统一放在 `frontend/demo`。

日期：2026-04-16

## 这次验证了什么

这次不是只验证 `/v1/responses` 能打通，而是验证下面这整条真实链路：

1. Deer Flow 中存在一个已发布的客服 agent
2. 客户私有案例库不进入 Deer Flow 知识库，而是通过 MCP 按需读取
3. 外部页面当时通过官方 `openai` JavaScript SDK 调公开契约
4. 这个外部页面能像一个正常客服聊天页一样工作，而不是开发者调试台

## 这次使用的真实对象

- Agent：`support-cases-sdk-demo`
- MCP Profile：`customer-cases-sdk-demo`
- 数据目录：`.openagents/runtime/mock-customer-data/cases`
- 公开客服页：`http://127.0.0.1:8083/docs/agents/support-cases-sdk-demo/support`
- 文档总览页：`http://127.0.0.1:8083/docs/agents/support-cases-sdk-demo`

MCP Profile 使用的标准 `mcpServers` JSON：

```json
{
  "mcpServers": {
    "customer-cases-sdk-demo": {
      "command": "python",
      "args": ["/app/backend/agents/scripts/mock_customer_cases_mcp.py"],
      "env": {
        "CUSTOMER_CASES_ROOT": "/openagents-home/runtime/mock-customer-data/cases"
      }
    }
  }
}
```

## 作为用户该怎么配

先做一次性配置：

1. 登录 `http://127.0.0.1:8083`
2. 创建或打开你的客服 agent
3. 到 `Settings -> Config -> MCP library bindings` 绑定对应的 MCP Profile
4. 发布 agent 到 `prod`
5. 到 `Workspace -> API Keys` 创建一个只允许该 agent 的 key

然后日常测试只需要：

1. 打开 `http://127.0.0.1:8083/docs/agents/<agent-name>/support`
2. 粘贴 `Base URL` 和该 agent 的用户 key
3. 点击左侧 starter prompts，或者直接提问
4. 在右侧对话区看回答，在下方 activity 区看工具调用

## 这次真实测了哪些问题

这次通过 SDK 实际跑了 4 条问题，对应客户要求的 4 类能力：

1. 列文件
   - `案例库里有哪些文件？请直接列出文件名，不要编造。`
   - 触发工具：`list_files`
2. 分页读文件
   - `请读取《盲派八字全知识点训练集.md》的第一页，并告诉我这个文件的标题。`
   - 触发工具：`read_file_page`
3. glob 筛文件名
   - `请只列出文件名以 Final_ 开头的案例文件。`
   - 触发工具：`glob_files`
4. grep 搜内容
   - `请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。`
   - 触发工具：`grep_files`

完整 SDK 调用结果已落盘：

- [sdk-results.json](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-support-sdk-demo/sdk-results.json)

## 截图

- [01-support-demo-page.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-support-sdk-demo/01-support-demo-page.png)
  - 新的客服聊天页，已经真实跑出回答和 activity
- [02-support-docs-overview.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-support-sdk-demo/02-support-docs-overview.png)
  - 已发布 agent 文档总览页，能看到 `Support Demo` 入口
- [03-support-agent-settings.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-support-sdk-demo/03-support-agent-settings.png)
  - agent 的设置入口

内部 MCP Library 配置流的已有截图和说明仍然适用：

- [MCP Library User Guide](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/README.md)

## 这次新增的前端入口

新增公开路由：

- `/docs/agents/:agent_name/support`

它和已有的 developer playground 分开：

- `Support Demo`
  - 面向客户视角
  - 正常客服聊天 UI
  - 这条历史记录当时使用官方 `openai` JS SDK，现已被原生 session helper 路线取代
- `Playground`
  - 面向开发调试
  - 更偏接口验证和调试台

## 结论

这次 current-code 真实确认：

1. 支持把客户私有案例库通过 MCP 暴露给 Deer Flow，而不是导入知识库
2. 已发布客服 agent 能真实调用这些 MCP 能力回答问题
3. 当时的官方 `openai` JavaScript SDK 兼容路径可以打通，但现行标准已经改为原生 `/v1/turns` session helper
4. 新的 `Support Demo` 页面已经能作为客户侧客服聊天页的演示实现
