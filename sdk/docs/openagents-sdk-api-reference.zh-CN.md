# OpenAgents SDK 接口文档

本文档面向外部集成方，描述 OpenAgents 当前对外可用的 HTTP SDK / Public API。

## 1. 基本信息

- Base URL：`https://<your-host>/v1`
- 认证方式：`Authorization: Bearer <API_TOKEN>`
- 对外可调用对象：`prod` 状态的已发布 Agent
- 重要约束：兼容接口里的 `model` 字段，表示 **已发布 agent 名称**，不是底层模型供应商 ID

推荐集成顺序：

1. `GET /v1/models`
2. `POST /v1/turns`
3. 为每个终端用户会话创建并保存 `session_id`
4. `GET /v1/turns/{id}`
5. 用 `GET /v1/turns/recent?agent=<agent>` 展示会话列表，再加 `session_id=<session>` 恢复某个会话
6. 如需上传文件，再使用 `POST /v1/files`

兼容接口：

- `POST /v1/responses`
- `GET /v1/responses/{id}`
- `POST /v1/chat/completions`

## 2. 认证

请求头示例：

```http
Authorization: Bearer df_xxx
Content-Type: application/json
```

## 3. 接口总览

| 方法   | 路径                     | 用途                                               |
| ------ | ------------------------ | -------------------------------------------------- |
| `GET`  | `/v1/models`             | 列出当前 API Token 可见的已发布 Agent              |
| `POST` | `/v1/files`              | 上传输入文件，返回 `file_id`                       |
| `GET`  | `/v1/files/{id}/content` | 下载响应产出的文件内容                             |
| `POST` | `/v1/turns`              | 推荐的原生对话接口                                 |
| `GET`  | `/v1/turns/{id}`         | 获取 turn 快照，适合恢复和重放                     |
| `POST` | `/v1/turns/{id}/cancel`  | 取消正在执行的 public API turn                     |
| `GET`  | `/v1/turns/recent`       | 获取最近会话摘要，或获取指定 `session_id` 的 turns |
| `POST` | `/v1/responses`          | OpenAI Responses 兼容层                            |
| `GET`  | `/v1/responses/{id}`     | 获取历史 response                                  |
| `POST` | `/v1/chat/completions`   | Chat Completions 兼容层                            |

## 4. 获取可调用 Agent

### `GET /v1/models`

返回当前 API Token 可见的已发布 agent。

示例：

```bash
curl -X GET "http://127.0.0.1:8083/v1/models" \
  -H "Authorization: Bearer df_xxx"
```

响应示例：

```json
{
  "object": "list",
  "data": [
    {
      "id": "support-cases-http-demo",
      "object": "model",
      "created": 1710000000,
      "owned_by": "openagents"
    }
  ]
}
```

## 5. 原生接口：创建 Turn

### `POST /v1/turns`

这是 **推荐的首选接口**。  
特点：

- 一个请求只发送当前轮输入
- 通过 `session_id` 绑定外部用户会话；服务端会续写匹配的运行线程，
  调用方不需要管理 turn 游标
- 支持 SSE 流式事件
- 支持思考内容、工具调用、结构化输出、文件输入、已存在知识库绑定
- 已发布 agent 可以预设默认知识库；SDK 调用方通常不需要传
  `knowledge_base_ids`，除非本轮要追加临时知识库

### 5.1 请求体

```json
{
  "agent": "support-cases-http-demo",
  "input": {
    "text": "请总结这份文件的重点",
    "file_ids": ["file_123"]
  },
  "session_id": "sess_customer_001",
  "history_scope": {
    "tenant_id": "acme",
    "user_id": "u_123"
  },
  "knowledge_base_ids": ["11111111-1111-1111-1111-111111111111"],
  "metadata": {
    "ticket_id": "T-1001"
  },
  "stream": true,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "summary_result",
      "schema": {
        "type": "object",
        "properties": {
          "summary": { "type": "string" }
        },
        "required": ["summary"]
      },
      "strict": true
    }
  },
  "thinking": {
    "enabled": true,
    "effort": "high"
  },
  "max_output_tokens": 2048
}
```

### 5.2 字段说明

| 字段                 | 类型       | 必填 | 说明                                                                                                                                                                                           |
| -------------------- | ---------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`              | `string`   |   是 | 已发布 `prod` agent 名称                                                                                                                                                                       |
| `input.text`         | `string`   |   是 | 当前轮用户输入文本                                                                                                                                                                             |
| `input.file_ids`     | `string[]` |   否 | 之前通过 `/v1/files` 上传得到的 `file_id`                                                                                                                                                      |
| `session_id`         | `string`   |   否 | 外部 SDK 会话 ID。建议集成方为每个终端用户会话创建并保存；未传时服务端会生成并在响应中返回                                                                                                     |
| `history_scope`      | `object`   |   否 | 调用方自定义的扁平字符串 map，用于在 API key、agent、session 之外分区历史，例如 `tenant_id` 或 `user_id`。key/value 会 trim；空 key、空 value、数组、嵌套对象会以 `invalid_history_scope` 拒绝 |
| `knowledge_base_ids` | `string[]` |   否 | 本轮执行前额外绑定到 thread 的知识库 ID。agent 预设的默认知识库会自动绑定。只要本轮存在有效知识库绑定，API key 就需要 token scope `knowledge:read`，且知识库必须属于当前用户或为共享知识库     |
| `metadata`           | `object`   |   否 | 调用方自定义元数据                                                                                                                                                                             |
| `stream`             | `boolean`  |   否 | 是否启用 SSE 流式输出                                                                                                                                                                          |
| `text.format`        | `object`   |   否 | 结构化输出定义                                                                                                                                                                                 |
| `thinking.enabled`   | `boolean`  |   否 | 是否开启思考输出                                                                                                                                                                               |
| `thinking.effort`    | `string`   |   否 | 推理强度，常用值：`low` / `medium` / `high`                                                                                                                                                    |
| `max_output_tokens`  | `integer`  |   否 | 最大输出 token 数                                                                                                                                                                              |

## 6. Turn SSE 事件

当 `stream=true` 时，`POST /v1/turns` 返回 `text/event-stream`。

当前稳定事件预算如下：

- `turn.started`
- `assistant.message.started`
- `assistant.text.delta`
- `assistant.reasoning.delta`
- `tool.call.started`
- `tool.call.completed`
- `turn.requires_input`
- `assistant.message.completed`
- `turn.completed`
- `turn.canceled`
- `turn.failed`

### 6.1 SSE 示例

```text
event: assistant.text.delta
data: {"sequence":3,"type":"assistant.text.delta","turn_id":"turn_123","delta":"你好"}

event: tool.call.started
data: {"sequence":4,"type":"tool.call.started","turn_id":"turn_123","tool_call_id":"call_1","tool_name":"fs_grep","tool_arguments":{"pattern":"灾祸"}}

event: tool.call.completed
data: {"sequence":5,"type":"tool.call.completed","turn_id":"turn_123","tool_call_id":"call_1","tool_name":"fs_grep","tool_output":{"items":[]}}

event: turn.completed
data: {"sequence":9,"type":"turn.completed","turn_id":"turn_123"}

event: turn.canceled
data: {"sequence":10,"type":"turn.canceled","turn_id":"turn_123","status":"canceled"}
```

### 6.2 客户端处理建议

- 保留 delta 原始空白字符，不要先 `trim()`
- 对 `assistant.text.delta` 和 `assistant.reasoning.delta` 做增量合并
- 最终以 `assistant.message.completed` 或 `GET /v1/turns/{id}` 快照为准
- 将 `turn.canceled` 当作终态中断状态处理，不要当成可重试的传输错误
- 工具调用 UI 建议显示：
  - 工具名称
  - 调用参数
  - 返回结果

### 6.3 SDK Message 层

`/v1/turns` 的线协议仍然是上面的 SSE 事件和最终 turn 快照；SDK/demo
消费层可以把它投影成更接近 Claude Code SDK 的高层消息流。推荐 UI 和业务
集成消费 `onMessage` / `messages`，只在调试面板或日志中直接查看原始
`stream_event`。

默认 SDK 消息类型：

- `system` / `init`：本轮 SDK 会话开始
- `system` / `context_compacted`：上下文被压缩
- `tool_call`：工具调用开始，包含 `tool_call_id`、`tool_name`、`tool_arguments`
- `tool_result`：工具调用完成，包含 `tool_call_id` 和 `tool_output`
- `assistant`：完整 assistant message，content 中可能包含 `thinking` 和 `text`
- `result` / `success`：本轮最终结果、usage、artifacts
- `result` / `error`：本轮失败

`includePartialMessages` 默认为关闭。开启后才会额外 yield：

- `stream_event`：原始 turn event，适合实时 token UI、debug、或事件回放

TypeScript 消费示例：

```ts
const session = createPublicAPISession({
  baseURL: "http://127.0.0.1:8083/v1",
  apiToken: "df_xxx",
  agent: "support-cases-http-demo",
});

const result = await session.prompt({
  text: "请检索并总结案例",
  includePartialMessages: true,
  onMessage: ({ message, readModel }) => {
    if (message.type === "tool_call") {
      renderToolCall(
        message.tool_call_id,
        message.tool_name,
        message.tool_arguments,
      );
    }
    if (message.type === "tool_result") {
      renderToolResult(message.tool_call_id, message.tool_output);
    }
    if (
      message.type === "stream_event" &&
      message.event.type === "assistant.text.delta"
    ) {
      renderAssistantText(readModel.liveOutput);
    }
    if (message.type === "result" && message.subtype === "success") {
      renderFinalAnswer(message.output_text);
    }
  },
});

console.log(result.messages);
```

## 7. 获取 Turn 快照

### `GET /v1/turns/{id}`

适用于：

- 页面刷新后恢复
- SSE 中断后补状态
- 历史会话回放

响应示例：

```json
{
  "id": "turn_123",
  "object": "turn",
  "status": "completed",
  "agent": "support-cases-http-demo",
  "session_id": "sess_customer_001",
  "history_scope": {
    "tenant_id": "acme",
    "user_id": "u_123"
  },
  "thread_id": "thread_456",
  "trace_id": "trace_789",
  "output_text": "这是最终答案",
  "reasoning_text": "这是思考内容",
  "artifacts": [],
  "usage": {
    "input_tokens": 120,
    "output_tokens": 80,
    "total_tokens": 200
  },
  "metadata": {
    "ticket_id": "T-1001"
  },
  "events": [],
  "created_at": 1710000000,
  "completed_at": 1710000005
}
```

### 7.1 快照字段说明

| 字段             | 说明                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `id`             | 当前 turn ID                                                                               |
| `status`         | 常见值：`completed` / `requires_input` / `canceled` / `failed`                             |
| `agent`          | agent 名称                                                                                 |
| `session_id`     | 外部 SDK 会话 ID                                                                           |
| `history_scope`  | 随该 turn 保存的调用方自定义历史分区字段                                                   |
| `thread_id`      | 后端运行线程 ID                                                                            |
| `trace_id`       | 观测 trace ID                                                                              |
| `output_text`    | 最终回答文本                                                                               |
| `reasoning_text` | 最终思考文本                                                                               |
| `artifacts`      | 输出文件列表；每一项包含不透明 `id`、`virtual_path` 和 `download_url`；`download_url` 是类似 `/files/{id}/content` 的 API-base 后缀，需要追加到你配置的 `/v1` Base URL 后 |
| `usage`          | token 用量                                                                                 |
| `events`         | 当前 turn 的标准化事件列表                                                                 |

### `POST /v1/turns/{id}/cancel`

取消一个正在执行的 public API turn。用户可见的“停止”按钮应调用这个接口，
不要只依赖关闭浏览器流式连接来表达取消。

服务端会根据 turn 所属 thread 查找活跃的 LangGraph run，执行 interrupt，
并写入终态为 `canceled` 的 turn 快照。成功响应与 `GET /v1/turns/{id}` 的
快照结构一致。

## 8. 获取最近 Turns

### `GET /v1/turns/recent?agent=<agent_name>&limit=50`

用于前端不保存消息列表、需要展示可点击会话列表的场景。不带
`session_id` 时，该接口返回当前 API Token 可见、指定 agent 的最近会话
摘要。每个摘要用最新 turn 排序，但 `input` 字段使用该会话第一条可见用户
输入，方便 UI 用第一句问题作为列表标题。

不传 `history_scope` 表示显式选择 API key + agent 的历史视图。需要按调用方
字段过滤时，传 URL 编码后的 JSON：
`GET /v1/turns/recent?agent=<agent_name>&history_scope=%7B%22tenant_id%22%3A%22acme%22%7D`。
scope 过滤使用 JSON containment 语义，因此查询 `{"tenant_id":"acme"}` 可以
匹配存储为 `{"tenant_id":"acme","user_id":"u_123"}` 的 turns。带 scope
查询没有结果时返回空列表，不会回退到无 scope 历史。

响应中的每个 item 是 turn 快照加上原始 `input`：

```json
{
  "object": "list",
  "data": [
    {
      "id": "turn_123",
      "object": "turn",
      "status": "completed",
      "agent": "support-cases-http-demo",
      "session_id": "sess_customer_001",
      "history_scope": {
        "tenant_id": "acme",
        "user_id": "u_123"
      },
      "thread_id": "thread_456",
      "output_text": "这是最终答案",
      "reasoning_text": "",
      "usage": {
        "input_tokens": 120,
        "output_tokens": 80,
        "total_tokens": 200
      },
      "events": [],
      "created_at": 1710000000,
      "completed_at": 1710000005,
      "input": {
        "text": "上一轮问题",
        "file_ids": ["file_123"]
      }
    }
  ]
}
```

恢复某个会话时，调用
`GET /v1/turns/recent?agent=<agent_name>&session_id=<session_id>&limit=200`。
这个响应返回所选会话的最近 turns。前端用这些 item 重建可见消息，继续使用
同一个 `session_id` 和可选 `history_scope` 发起下一轮；调用方不需要把
turn id 再传回服务端。

恢复带 scope 的会话时，需要带上当前 scope：
`GET /v1/turns/recent?agent=<agent_name>&session_id=<session_id>&history_scope=<urlencoded-json>&limit=200`。

## 9. 文件上传

### `POST /v1/files`

用于在 turn 中附加输入文件。

`multipart/form-data` 字段：

- `file`: 文件本体
- `purpose`: 用途，建议传 `assistants`

示例：

```bash
curl -X POST "http://127.0.0.1:8083/v1/files" \
  -H "Authorization: Bearer df_xxx" \
  -F "file=@./example.pdf" \
  -F "purpose=assistants"
```

响应示例：

```json
{
  "id": "file_123",
  "object": "file",
  "bytes": 10240,
  "created_at": 1710000000,
  "filename": "example.pdf",
  "purpose": "assistants",
  "mime_type": "application/pdf",
  "status": "processed"
}
```

然后把返回的 `id` 放进：

```json
{
  "input": {
    "text": "请阅读附件",
    "file_ids": ["file_123"]
  }
}
```

## 10. Responses 兼容层

### `POST /v1/responses`

适用于已经按 OpenAI Responses 风格接入的客户端。

关键点：

- `model` = 已发布 agent 名称
- `input` 为原始输入
- 支持 `stream=true`
- 支持 `reasoning`
- 支持 `text.format`

示例：

```bash
curl -X POST "http://127.0.0.1:8083/v1/responses" \
  -H "Authorization: Bearer df_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "support-cases-http-demo",
    "input": "请回答 TEST_OK",
    "stream": false
  }'
```

## 11. Chat Completions 兼容层

### `POST /v1/chat/completions`

适用于已有 Chat Completions 客户端。

关键点：

- `model` = 已发布 agent 名称
- Gateway 会把该请求转换到统一的 responses / runtime 流程
- 不建议新项目优先接这个接口

## 12. 常见错误

### 401 Unauthorized

```json
{
  "error": "missing api token"
}
```

或：

```json
{
  "error": "invalid api token"
}
```

### 403 Forbidden

Token scope 不足。例如传入 `knowledge_base_ids` 时，API key 必须具备
`knowledge:read`。

### 404 Not Found

- agent 不存在
- turn / response / file 不存在
- `knowledge_base_ids` 指向不存在或不可访问的知识库

### 422 / runtime_error

运行时执行失败，通常在流式接口里表现为：

```text
event: turn.failed
data: {"type":"turn.failed","error":"..."}
```

## 13. 最小集成示例

### 13.1 同步调用

```python
import requests

base_url = "http://127.0.0.1:8083/v1"
api_key = "df_xxx"

resp = requests.post(
    f"{base_url}/turns",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    json={
        "agent": "support-cases-http-demo",
        "input": {"text": "你好"},
    },
    timeout=60,
)
resp.raise_for_status()
print(resp.json())
```

### 13.2 流式调用

```python
import requests

resp = requests.post(
    "http://127.0.0.1:8083/v1/turns",
    headers={
        "Authorization": "Bearer df_xxx",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    },
    json={
        "agent": "support-cases-http-demo",
        "input": {"text": "请流式回答"},
        "stream": True,
    },
    stream=True,
    timeout=60,
)

for line in resp.iter_lines(decode_unicode=True):
    if line:
        print(line)
```

## 14. 集成建议

- 新接入优先使用 `/v1/turns`
- 客户端内部保存 `session_id`，不要每轮重传完整 `messages[]`
- 已有 turn id 时使用 `GET /v1/turns/{id}` 恢复；会话列表使用 `GET /v1/turns/recent?agent=<agent_name>`，恢复某个会话时再加 `session_id=<session_id>`
- 工具调用展示请直接基于标准事件，不要自己解析底层 trace
- 如果需要上传知识附件，先调用 `/v1/files`

## 15. 文档状态

- 状态：当前仓库实现对应的接口文档
- 适用范围：OpenAgents Public API / SDK 外部调用
- 非目标：内部 LangGraph chunk、trace 原始格式、前端私有事件
