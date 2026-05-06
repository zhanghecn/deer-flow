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

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/v1/models` | 列出当前 API Token 可见的已发布 Agent |
| `POST` | `/v1/files` | 上传输入文件，返回 `file_id` |
| `GET` | `/v1/files/{id}/content` | 下载响应产出的文件内容 |
| `POST` | `/v1/turns` | 推荐的原生对话接口 |
| `GET` | `/v1/turns/{id}` | 获取 turn 快照，适合恢复和重放 |
| `GET` | `/v1/turns/recent` | 获取最近会话摘要，或获取指定 `session_id` 的 turns |
| `POST` | `/v1/responses` | OpenAI Responses 兼容层 |
| `GET` | `/v1/responses/{id}` | 获取历史 response |
| `POST` | `/v1/chat/completions` | Chat Completions 兼容层 |

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
- 通过 `session_id` 绑定外部用户会话；可选用 `previous_turn_id` 指定上一轮
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
  "previous_turn_id": "turn_abc",
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

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `agent` | `string` | 是 | 已发布 `prod` agent 名称 |
| `input.text` | `string` | 是 | 当前轮用户输入文本 |
| `input.file_ids` | `string[]` | 否 | 之前通过 `/v1/files` 上传得到的 `file_id` |
| `session_id` | `string` | 否 | 外部 SDK 会话 ID。建议集成方为每个终端用户会话创建并保存；未传时服务端会生成并在响应中返回 |
| `previous_turn_id` | `string` | 否 | 上一轮 turn ID。传了 `session_id` 时，服务端会校验二者属于同一会话 |
| `knowledge_base_ids` | `string[]` | 否 | 本轮执行前额外绑定到 thread 的知识库 ID。agent 预设的默认知识库会自动绑定。只要本轮存在有效知识库绑定，API key 就需要 token scope `knowledge:read`，且知识库必须属于当前用户或为共享知识库 |
| `metadata` | `object` | 否 | 调用方自定义元数据 |
| `stream` | `boolean` | 否 | 是否启用 SSE 流式输出 |
| `text.format` | `object` | 否 | 结构化输出定义 |
| `thinking.enabled` | `boolean` | 否 | 是否开启思考输出 |
| `thinking.effort` | `string` | 否 | 推理强度，常用值：`low` / `medium` / `high` |
| `max_output_tokens` | `integer` | 否 | 最大输出 token 数 |

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
```

### 6.2 客户端处理建议

- 保留 delta 原始空白字符，不要先 `trim()`
- 对 `assistant.text.delta` 和 `assistant.reasoning.delta` 做增量合并
- 最终以 `assistant.message.completed` 或 `GET /v1/turns/{id}` 快照为准
- 工具调用 UI 建议显示：
  - 工具名称
  - 调用参数
  - 返回结果

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
  "thread_id": "thread_456",
  "trace_id": "trace_789",
  "previous_turn_id": "turn_prev",
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

| 字段 | 说明 |
|---|---|
| `id` | 当前 turn ID |
| `status` | 常见值：`completed` / `failed` / `incomplete` |
| `agent` | agent 名称 |
| `session_id` | 外部 SDK 会话 ID |
| `thread_id` | 后端运行线程 ID |
| `trace_id` | 观测 trace ID |
| `previous_turn_id` | 上一轮 turn ID |
| `output_text` | 最终回答文本 |
| `reasoning_text` | 最终思考文本 |
| `artifacts` | 输出文件列表；每一项包含不透明 `id`、`download_url`，以及用于解析回答引用的 `virtual_path` |
| `usage` | token 用量 |
| `events` | 当前 turn 的标准化事件列表 |

## 8. 获取最近 Turns

### `GET /v1/turns/recent?agent=<agent_name>&limit=20`

用于前端不保存消息列表、需要展示可点击会话列表的场景。不带
`session_id` 时，该接口返回当前 API Token 可见、指定 agent 的最近会话
摘要。每个摘要用最新 turn 排序，但 `input` 字段使用该会话第一条可见用户
输入，方便 UI 用第一句问题作为列表标题。

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
`GET /v1/turns/recent?agent=<agent_name>&session_id=<session_id>&limit=50`。
这个响应返回所选会话的最近 turns。前端用这些 item 重建可见消息，继续使用
同一个 `session_id`，并把最新 item 的 `id` 作为下一轮
`previous_turn_id`。

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
