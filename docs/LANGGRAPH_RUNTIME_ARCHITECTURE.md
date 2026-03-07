# LangGraph Runtime Architecture (Enterprise Multi-Tenant)

## 1) Design原则

- 前端统一用 `context` 传运行时参数（`model_name`、`agent_name`、`mode` 等）。
- 网关只做三件事：JWT 鉴权、透传、附加身份（`x-user-id` / `x-thread-id`）。
- Python/LangGraph 负责所有运行时决策（模型解析、线程归属校验、agent 配置加载）。
- 不使用默认模型兜底；模型必须可解析且在 DB 可用。

## 2) Run链路（官方推荐对齐）

```text
Frontend
  |
  | POST /api/langgraph/threads/{thread_id}/runs/stream
  | body:
  |   input
  |   config: { recursion_limit: 1000 }
  |   context: { model_name, agent_name, thinking_enabled, ... }
  v
Gateway (Go)
  |
  | JWT authenticate
  | add headers:
  |   x-user-id   = <jwt user id>
  |   x-thread-id = <path thread id>
  | inject body context.user_id/thread_id (JSON request only)
  | proxy to LangGraph
  v
LangGraph API
  |
  | create_valid_run():
  |   - context 与 configurable 自动同步
  |   - configurable 注入 headers(取决于 LANGGRAPH_HTTP.configurable_headers)
  v
Python make_lead_agent(config, runtime)
  |
  | cfg = runtime.context + config.configurable
  | user_id <- user_id | x-user-id | langgraph_auth_user_id
  | thread_id <- thread_id | x-thread-id
  | assert thread owner
  | resolve model (strict, no fallback):
  |   1) model_name/model
  |   2) model_config.name
  |   3) agent.model
  |   4) thread_runtime_configs(thread_id,user_id)
  | persist thread runtime(model/agent)
  v
DeepAgent execution + checkpoints
```

## 3) History/Checkpoint链路

```text
Frontend
  |
  | POST /api/langgraph/threads/{thread_id}/history
  v
Gateway
  |
  | JWT + x-user-id/x-thread-id headers
  | proxy
  v
LangGraph threads.read context
  |
  | runtime.execution_runtime is None
  | make_lead_agent 通过 configurable 中的 x-user-id/x-thread-id 做校验与模型解析
  v
Return thread states/checkpoints
```

## 4) 为什么有 005 和 006

- `005_thread_runtime_configs`：线程运行时配置（`model_name`/`agent_name`）持久化。
- `006_thread_ownerships`：线程归属（`thread_id -> user_id`）强隔离。

两张表职责不同，不再互相回填，不重复。

## 5) 必备环境配置

LangGraph 需要允许把网关附加头透传到 `configurable`：

```bash
LANGGRAPH_HTTP='{"configurable_headers":{"includes":["x-user-id","x-thread-id"]}}'
```

统一放在项目根目录 `.env`（单一真源）。`backend/langgraph.json` 读取 `../.env`，
`gateway-go` 启动/迁移优先读取 `../.env`，其次读取本目录 `.env`（仅本地覆盖）。

## 6) 维护检查清单

1. 前端 run 请求仅使用 `context`，不要和 `config.configurable` 并行传业务字段。
2. 网关确认请求头已注入：`x-user-id`、`x-thread-id`。
3. LangGraph 进程确认启用了 `LANGGRAPH_HTTP.configurable_headers`。
4. Python 侧若有 `thread_id` 且无 `user_id`，应直接报错（禁止无身份线程访问）。
5. DB 必须存在并可读：
   - `models`（enabled=true）
   - `agents`
   - `thread_runtime_configs`
   - `thread_ownerships`
