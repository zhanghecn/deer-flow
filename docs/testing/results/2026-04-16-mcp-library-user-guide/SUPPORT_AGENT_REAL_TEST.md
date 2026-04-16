# 客服 Agent 对接客户系统真实测试记录

日期：2026-04-16

## 目标

验证这条完整链路：

1. 用户在 Deer Flow 里真实创建一个客服 agent
2. 不把客户私密数据导入 Deer Flow 知识库
3. 客户系统通过 MCP 提供：
   - 列文件
   - 分页读文件
   - grep 搜索
   - glob 匹配
4. 该 agent 通过 SDK / `/v1/responses` 被外部系统调用
5. agent 回答问题时，自动调用客户侧 MCP 能力获取数据

## 这次使用的数据源

原始客户示例目录：

- `/root/project/ai/ai-numerology/backend/agents/examples/案例大全`

真实测试时，为了让 current-code 容器可访问，我把这批文件 staging 到：

- `/root/project/ai/deer-flow/.openagents/runtime/mock-customer-data/cases`

包含 4 个 markdown 文件：

- `Final_子平八字案例训练集.md`
- `Final_盲派八字案例训练集.md`
- `子平新派八字全矩阵训练集_Final.md`
- `盲派八字全知识点训练集.md`

## mock customer MCP server

我实现了一个最小 mock customer MCP server：

- [backend/agents/scripts/mock_customer_cases_mcp.py](/root/project/ai/deer-flow/backend/agents/scripts/mock_customer_cases_mcp.py)

能力：

- `list_files`
- `read_file_page`
- `grep_files`
- `glob_files`

本地 smoke 已确认会暴露这 4 个工具。

## 真实用户流

### 1. 在 UI 中创建客服 agent

真实打开：

- `http://127.0.0.1:8083/workspace/agents/new`

真实创建的 agent 名称：

- `support-cases-agent`

我给 `lead_agent` 的实际需求是：

```text
创建一个客服智能体，用于回答案例库里的命理客服问题。要求：回答前优先搜索案例文件，必要时分页读取原文；没有证据时明确说不知道；回答用中文，尽量简洁。不要把私密数据入知识库。
```

实际结果：

- 页面显示 `Agent created!`
- 新 agent 已出现在系统中

### 2. 创建客户系统 MCP Profile

真实创建了一个 MCP Profile：

- `customer-cases`

Profile 配置使用 stdio mock server：

```json
{
  "mcpServers": {
    "customer-cases": {
      "command": "python",
      "args": ["/app/backend/agents/scripts/mock_customer_cases_mcp.py"],
      "env": {
        "CUSTOMER_CASES_ROOT": "/openagents-home/runtime/mock-customer-data/cases"
      }
    }
  }
}
```

### 3. 绑定到 support-cases-agent

真实打开：

- `http://127.0.0.1:8083/workspace/agents/support-cases-agent/settings?agent_status=dev`

在 `Config -> MCP library bindings` 里勾选：

- `customer-cases`

保存后，通过已登录浏览器里的 authenticated fetch 验证：

```json
"mcp_servers": [
  "custom/mcp-profiles/customer-cases.json"
]
```

## SDK / Public API 真实调用

### 1. 发布 agent

真实把 `support-cases-agent` 发布到 `prod`。

### 2. 创建 API key

真实创建的 key 名称：

- `support-cases-sdk-key`

只允许这个 published agent：

- `allowed_agents = ["support-cases-agent"]`

### 3. `/v1/responses` 调用 1：列文件

实际问题：

```text
案例库里有哪些文件？请直接列出文件名，不要编造。
```

实际返回：

```text
案例库中共有 **4 个文件**：

1. `Final_子平八字案例训练集.md`
2. `Final_盲派八字案例训练集.md`
3. `子平新派八字全矩阵训练集_Final.md`
4. `盲派八字全知识点训练集.md`
```

`run_events` 里明确出现：

- `tool_started: list_files`
- `tool_finished: list_files`

### 4. `/v1/responses` 调用 2：分页读文件

实际问题：

```text
请读取《盲派八字全知识点训练集.md》的第一页，并告诉我这个文件的标题。
```

实际返回：

```text
该文件的标题是：

**《盲派八字真实案例训练集（全知识点版）》**
```

并附带第一页开头内容的概括。

`run_events` 里明确出现：

- `tool_started: read_file_page`
- `tool_finished: read_file_page`

### 5. `/v1/responses` 调用 3：glob 过滤文件名

实际问题：

```text
请只列出文件名以 Final_ 开头的案例文件。
```

实际返回：

```text
以下是以 `Final_` 开头的案例文件：

1. **Final_子平八字案例训练集.md**
2. **Final_盲派八字案例训练集.md**
```

`run_events` 里明确出现：

- `tool_started: glob_files`
- `tool_finished: glob_files`

### 6. `/v1/responses` 调用 4：grep 内容搜索

实际问题：

```text
请搜索案例库中包含“夏仲奇”的文件，并告诉我出现在哪些文件。
```

实际返回：

- `Final_盲派八字案例训练集.md`
- `盲派八字全知识点训练集.md`
- `子平新派八字全矩阵训练集_Final.md`

并给出了出现次数和简要说明。

`run_events` 里明确出现：

- `tool_started: grep_files`
- `tool_finished: grep_files`

这说明 public API 路径已经真实打通了客户系统的四类基础能力，而不是只在工作区聊天里能用。

## 8081 管理端验证

真实打开：

- `http://127.0.0.1:8081/observability`

可以在列表里看到 `support-cases-agent` 的 trace：

- “案例库里有哪些文件？”
- “请读取《盲派八字全知识点训练集.md》的第一页，并告诉我这个文件的标题。”

截图：

- [09-observability-support-agent-traces.png](/root/project/ai/deer-flow/docs/testing/results/2026-04-16-mcp-library-user-guide/09-observability-support-agent-traces.png)

说明：

- 这张图证明 admin 面里已经能看到这个客服 agent 的真实 trace
- 结合 `/v1/responses` 返回里的 `run_events`，足以证明 SDK/public API 调用链真实存在

## 结论

这条最初需求对应的真实验收链已经通过：

1. 用户真实创建了客服 agent
2. 客户数据没有进入 Deer Flow 知识库
3. 客户数据通过 MCP 工具能力提供
4. 外部通过 `/v1/responses` 真实调用已发布的 agent
5. agent 真实调用了客户侧 mock MCP server
6. `8081` 管理端能看到对应 trace

## 当前交付态说明

为了保持交付态干净：

- 最终我已经把测试用 `customer-cases` profile 清掉
- 没把这个测试绑定永久留在 `support-cases-agent` 或 `lead_agent` 上

所以：

- 这份文档记录的是**真实已跑通过**的验收链
- 但你现在打开系统时，默认不会看到这个测试 profile 仍然存在
