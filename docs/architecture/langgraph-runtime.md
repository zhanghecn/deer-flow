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
  |   4) thread_bindings(thread_id,user_id)
  | persist thread runtime(model/agent)
  v
DeepAgent execution + checkpoints
```

## 3) History/Checkpoint链路

```text
Frontend / SDK
  |
  | thread page load / reconnect / branching / interrupt restore
  | GET/POST /api/langgraph/threads/{thread_id}/history
  | GET      /api/langgraph/threads/{thread_id}/state
  v
Gateway (Go)
  |
  | JWT authenticate
  | inject x-user-id / x-thread-id headers
  | proxy request as-is
  v
LangGraph API
  |
  | get_thread_history() -> Threads.State.list(...)
  | get_thread_state()   -> Threads.State.get(...)
  v
LangGraph graph loader
  |
  | get_graph(graph_id, config, access_context="threads.read")
  | build_server_runtime("threads.read") -> _ReadRuntime
  | invoke graph factory: make_lead_agent(config, runtime)
  v
Python make_lead_agent(config, runtime)
  |
  | runtime.execution_runtime is None
  | prepare_runtime_resources = False
  | still resolve user_id / thread_id / model / agent ownership
  | but skip thread-scoped runtime seeding and skip runtime persistence
  v
Compiled graph (shared read context)
  |
  | history -> graph.aget_state_history(...)
  | state   -> graph.aget_state(...)
  v
Return prepared state snapshots / checkpoints
```

### 3.1) `threads.create_run` 与 `threads.read` 的分叉点

```text
LangGraph get_graph(...)
  |
  +--> access_context="threads.create_run"
  |      |
  |      | build_server_runtime(...) -> _ExecutionRuntime
  |      | runtime.execution_runtime is available
  |      | make_lead_agent(...):
  |      |   prepare_runtime_resources = True
  |      |   build thread-scoped backend under /mnt/user-data/...
  |      |   persist thread runtime(model/agent)
  |      v
  |      run graph / tools / checkpoints
  |
  +--> access_context="threads.read"
         |
         | build_server_runtime(...) -> _ReadRuntime
         | runtime.execution_runtime is None
         | make_lead_agent(...):
         |   prepare_runtime_resources = False
         |   reuse shared read backend
         |   no tool execution, no thread runtime persistence
         v
         read checkpoint-backed state/history only
```

### 3.2) 为什么 `history/state` 也要重新 load graph

LangGraph 读线程状态时不是简单地“直接查一张消息表”。它仍然需要 graph，原因是：

- `history` 需要通过 `graph.aget_state_history(...)` 把 checkpoint 历史转成可返回的状态快照。
- `state` 需要通过 `graph.aget_state(...)` 生成当前线程的准备态视图。
- graph topology 会影响 pending tasks、subgraphs、interrupts 等状态解释；因此读接口也必须拿到同一张 graph。
- 但这属于只读访问，不应该为每次页面加载都准备真实的线程执行资源。

## 4) 线程表收敛（现状）

- SQL 已清理为单表模型，不再保留线程拆分表（`thread_runtime_configs` / `thread_ownerships`）。
- 当前运行时只使用 `thread_bindings`：
  - `thread_id -> user_id`（租户隔离）
  - `agent_name` / `assistant_id` / `model_name`（运行时绑定）
- 线程元数据（如 title/metadata）由 LangGraph `threads` 接口提供，不落本地 `threads` 业务表。

## 5) 必备环境配置

LangGraph 需要允许把网关附加头透传到 `configurable`：

```bash
LANGGRAPH_HTTP='{"configurable_headers":{"includes":["x-user-id","x-thread-id"]}}'
```

宿主机运行统一使用项目根目录 `.env`。`backend/agents/langgraph.json` 读取 `../../.env`，
`backend/gateway` 本地启动也会优先读取根 `.env`。Gateway 已不再内置 SQL 迁移入口。

Docker 开发栈也使用同一个根 `.env`：

- compose 插值读取根 `.env`
- gateway / LangGraph 容器都挂载同一个 `/app/.env`
- 容器内固定地址差异直接在 compose 里内联覆盖
- LangGraph 仍使用同一个 `backend/agents/langgraph.json`

## 6) 维护检查清单

1. 前端 run 请求仅使用 `context`，不要和 `config.configurable` 并行传业务字段。
2. 网关确认请求头已注入：`x-user-id`、`x-thread-id`。
3. LangGraph 进程确认启用了 `LANGGRAPH_HTTP.configurable_headers`。
4. Python 侧若有 `thread_id` 且无 `user_id`，应直接报错（禁止无身份线程访问）。
5. DB 必须存在并可读：
   - `models`（enabled=true）
   - `agents`
   - `thread_bindings`
