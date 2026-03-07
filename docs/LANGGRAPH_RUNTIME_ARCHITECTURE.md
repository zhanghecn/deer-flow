# LangGraph Runtime Architecture (Gateway + Python + DB)

## 目标

- 网关只做鉴权和透传，不做模型拼接/查库。
- Python 智能体工厂统一负责运行时解析：`user_id + thread_id + 前端参数`。
- 多用户隔离依赖 `user_id` 贯穿请求与线程运行时表。

## 端到端流程（运行接口）

```text
Frontend
  |
  | POST /api/langgraph/threads/{thread_id}/runs/stream
  | body: input + config + context(model_name, mode, ...)
  v
Gateway
  |
  | 1) JWT 校验
  | 2) 原样透传 body
  | 3) 注入 configurable.user_id
  | 4) 注入 configurable.thread_id (从 URL)
  v
LangGraph API
  |
  | invoke graph factory: make_lead_agent(config, runtime)
  v
Python Agent Factory
  |
  | cfg = runtime.execution_runtime.context + config.configurable
  | model_name 解析优先级:
  |   configurable.model_name / model
  |   -> configurable.model_config.name
  |   -> agent.model (DB)
  |   -> thread_runtime_configs.model_name (DB)
  |
  | DB 查询:
  | - agents(name,status)
  | - models(name, enabled=true)
  | - thread_runtime_configs(thread_id,user_id)
  |
  | 成功后写回 thread_runtime_configs:
  | - thread_id, user_id, model_name, agent_name
  v
DeepAgent 执行
```

## 读取接口（history）流程

```text
Frontend
  |
  | POST /api/langgraph/threads/{thread_id}/history
  v
Gateway
  |
  | JWT + 注入 configurable.user_id/thread_id
  v
LangGraph API -> make_lead_agent(config, runtime)
  |
  | runtime.access_context = threads.read (无 execution context)
  | 仅可从 configurable + DB 解析模型
  | 优先使用 thread_runtime_configs(thread_id,user_id)
  v
返回历史
```

## 流式续连接口（join stream）

```text
GET /api/langgraph/threads/{thread_id}/runs/{run_id}/stream

- 无请求体，网关只做 JWT + 反向代理 + CORS
- 不涉及模型注入
```

## 多用户隔离点

- 网关从 JWT 注入 `user_id` 到 `configurable`。
- Python 查 `thread_runtime_configs` 必须使用 `(thread_id, user_id)` 组合。
- 相同 `thread_id` 若 `user_id` 不同，不会命中同一运行时模型记录。

## 数据表

- `models`: 大模型运行参数来源（`config_json`）。
- `agents`: Agent 元数据（含 `model`, `tool_groups`, `mcp_servers`）。
- `thread_runtime_configs`: 线程级运行时模型持久化。

## 维护约束

- 不在网关新增模型解析策略分支。
- 不依赖 `config.yaml` 作为运行时模型兜底。
- 所有 run/history 相关问题先查：
  1. 请求是否带 `configurable.user_id/thread_id`
  2. Python 是否能读 DB 环境变量
  3. `models.enabled` 是否为 `true`
  4. `thread_runtime_configs` 是否已写入对应 `(thread_id,user_id)`
