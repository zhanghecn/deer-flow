# LangGraph inmem Runtime 解释（结合 OpenAgents）

## 1. 一句话结论

`inmem runtime` 是 LangGraph API 的一个**运行时后端实现**，负责 runs/threads/queue/store 的执行与调度。  
它默认以内存为主，并在开发模式下把部分状态刷到本地 `.langgraph_api/*.pckl` 文件。  
你当前项目使用了**自定义 Postgres checkpointer**，所以核心会话检查点状态是落 Postgres 的，不是只在内存里。

## 2. 你项目当前的真实组合

当前 OpenAgents 的组合是：

- Runtime backend: `inmem`
- Checkpointer: `AsyncPostgresSaver`（自定义）
- Gateway/业务 DB: `DATABASE_URI`（共享）

对应配置点：

- runtime edition 决策：
  `backend/agents/src/langgraph_dev.py`
- 指定自定义 checkpointer：
  `backend/agents/langgraph.json`
- checkpointer 实现（Postgres）：
  `backend/agents/src/checkpointer.py`

## 3. 启动后到底发生了什么

按实际代码路径，流程如下：

1. `run_server(...)` 启动 LangGraph API，并设置 `LANGGRAPH_RUNTIME_EDITION=inmem`。
2. `langgraph_runtime` 动态导入 `langgraph_runtime_inmem`。
3. inmem `lifespan` 启动：
   - 初始化 inmem database/store
   - 启动自定义 checkpointer（你的项目是 Postgres）
   - 加载 graphs
   - 启动后台 queue worker
4. 用户发起 run 后，run 会先进入 inmem 的 runs 队列（pending -> running）。
5. worker 执行 graph 节点。
6. graph checkpoint 写入你自定义的 Postgres checkpointer。
7. stream 事件通过 inmem stream manager 推送。
8. 进程退出时关闭 queue/store/checkpointer。

## 3.1 ASCII 流程图（当前 OpenAgents）

```text
                 HTTP/SSE
+------------------------+        +---------------------+
| Frontend / Client      | -----> | Gateway (Go)        |
| - create run           |        | - JWT/auth headers  |
| - stream events        | <----- | - proxy /api/*      |
+------------------------+        +----------+----------+
                                             |
                                             | proxy
                                             v
                              +-------------------------------+
                              | LangGraph API Server          |
                              | (uv run python -m src...)     |
                              +---------------+---------------+
                                              |
                      LANGGRAPH_RUNTIME_EDITION=inmem
                                              |
                                              v
                              +-------------------------------+
                              | langgraph_runtime_inmem       |
                              | - lifespan                    |
                              | - queue / ops / stream        |
                              | - inmem db/store facade       |
                              +------+------------------------+
                                     |
                      run pending -> | -> worker executes graph
                                     |
                                     v
                 +--------------------------------------------+
                 | custom checkpointer (OpenAgents)           |
                 | src.checkpointer.checkpointer             |
                 | -> AsyncPostgresSaver.from_conn_string() |
                 +-------------------+------------------------+
                                     |
                                     v
                          +----------------------+
                          | PostgreSQL           |
                          | - checkpoints        |
                          | - runtime business DB|
                          +----------------------+

Local dev side persistence (inmem runtime internals):
  .langgraph_api/.langgraph_ops.pckl
  .langgraph_api/store.pckl
  .langgraph_api/store.vectors.pckl
```

## 4. inmem runtime 各模块在做什么

| 模块 | 作用 |
| --- | --- |
| `lifespan.py` | 启动和关闭 runtime 生命周期，挂起 queue/store/checkpointer |
| `queue.py` | 背景任务调度循环，消费 pending runs，调用 worker |
| `ops.py` | 线程、run、assistant、cron 的 CRUD 与状态流转 |
| `database.py` | inmem “数据库”外观，底层是 `PersistentDict` |
| `store.py` | in-memory store（可落地 pckl） |
| `checkpoint.py` | 默认 inmem checkpointer（你项目被 custom checkpointer 替换） |
| `inmem_stream.py` | SSE/stream 消息队列管理 |
| `_persistence.py` | 定时 flush 线程，把 `PersistentDict` 每 10 秒 `sync()` |

## 5. 哪些数据会持久化到哪里

| 数据类型 | inmem 默认行为 | OpenAgents 当前行为 |
| --- | --- | --- |
| runs/threads/assistants 运行时元数据 | 内存 + `.langgraph_api/.langgraph_ops.pckl` | 同左（运行时层面） |
| store 数据 | 内存 + `.langgraph_api/store*.pckl` | 同左（如启用默认 store） |
| graph checkpoints（最关键） | 默认走 inmem checkpointer（可落盘） | 走 Postgres（`AsyncPostgresSaver`） |
| 业务配置/模型/绑定 | 不由 inmem 自带维护 | 由你自己的 PostgreSQL 表维护 |

## 6. 常见误解

### 误解 A：`inmem` 就是“完全不持久化”

不对。inmem 也会把一些状态刷到 `.langgraph_api/*.pckl`。  
只是这种持久化更偏开发体验，不是多副本一致性存储。

### 误解 B：用了 `inmem runtime` 就不能企业化

不对。你现在这套 `inmem runtime + Postgres checkpointer + Gateway + DB` 可以作为企业版一期。  
它已经具备会话状态持久化、鉴权、线程隔离、模型/agent 配置管理能力。

### 误解 C：`langgraph-checkpoint-postgres` 和 `postgres runtime` 是一回事

不是一回事。  
`checkpoint-postgres` 只解决 checkpoint 状态持久化。  
`runtime-postgres`（若使用）是运行时调度后端本身（队列/调度语义层）。

## 7. 你现在最该关注的边界

- 单进程内，inmem queue 语义简单直接，维护成本低。
- 跨多副本时，inmem runtime 的队列与调度不是天然共享协调层。
- 但你已经用 Postgres 保存 checkpoint，因此“会话状态丢失”风险已经明显降低。

## 8. 企业化演进建议（不推翻现有代码）

1. 继续用当前方案做产品迭代（推荐当前阶段）。
2. 增加可观测性与压测，确认并发上限与故障恢复目标。
3. 当你需要更强分布式调度语义，再切到官方完整 postgres runtime/平台化部署路线。

## 9. 你可直接做的验证

在 `backend/agents` 启动后看日志：

- 出现 `Using langgraph_runtime_inmem`
- 同时出现 `Using custom checkpointer: AsyncPostgresSaver`

这就说明当前确实是：

`inmem runtime（执行/调度） + Postgres checkpointer（持久化）`

## 10. 关键源码（带注释）

下面是与你问题最相关的源码摘录（已省略无关代码），并加了中文注释。

### 10.1 runtime 后端如何被选择

来源：`langgraph_runtime/__init__.py`

```python
RUNTIME_EDITION = os.environ["LANGGRAPH_RUNTIME_EDITION"]
RUNTIME_PACKAGE = f"langgraph_runtime_{RUNTIME_EDITION}"

if importlib.util.find_spec(RUNTIME_PACKAGE):
    backend = importlib.import_module(RUNTIME_PACKAGE)
else:
    raise ImportError(
        f'pip install "langgraph-runtime-{RUNTIME_EDITION}"'
    )

# 把 backend 的模块挂到统一命名空间 langgraph_runtime.*
for module_name in ("checkpoint", "database", "lifespan", "ops", "store", "routes"):
    mod = getattr(backend, module_name, None)
    if mod is not None:
        sys.modules["langgraph_runtime." + module_name] = mod
```

解释：

- `LANGGRAPH_RUNTIME_EDITION=inmem` -> 导入 `langgraph_runtime_inmem`
- `LANGGRAPH_RUNTIME_EDITION=postgres` -> 导入 `langgraph_runtime_postgres`

### 10.2 OpenAgents 的启动器如何兜底并保留 DATABASE_URI

来源：`backend/agents/src/langgraph_dev.py`

```python
runtime_edition = os.getenv("LANGGRAPH_RUNTIME_EDITION", "inmem").strip() or "inmem"

if runtime_edition == "postgres" and not _has_postgres_runtime_backend():
    # [注释] 如果 postgres runtime 后端包不可用，回退到 inmem
    runtime_edition = "inmem"

runtime_kwargs = {}
database_uri = os.getenv("DATABASE_URI", "").strip()
if database_uri:
    # [注释] 避免 langgraph_api.cli 默认把 DATABASE_URI 覆盖为 :memory:
    runtime_kwargs["__database_uri__"] = database_uri

run_server(
    runtime_edition=runtime_edition,
    checkpointer=config_data.get("checkpointer"),
    **runtime_kwargs,
)
```

解释：

- 这里把 runtime 与 checkpointer 解耦了：runtime 可以是 `inmem`，checkpointer 仍可走 Postgres。

### 10.3 你项目的自定义 Postgres checkpointer

来源：`backend/agents/src/checkpointer.py`

```python
@asynccontextmanager
async def checkpointer():
    database_uri = _build_runtime_db_dsn()
    async with AsyncPostgresSaver.from_conn_string(database_uri) as saver:
        await saver.setup()
        yield saver
```

解释：

- 这段代码决定了 checkpoint 最终写入 PostgreSQL。
- 所以你当前并不是“纯 inmem 无持久化”。

### 10.4 inmem runtime 启动时会做什么

来源：`langgraph_runtime_inmem/lifespan.py`

```python
await start_http_client()
await start_pool()                      # [注释] 初始化 inmem database/store
await api_checkpointer.start_checkpointer()  # [注释] 启动 checkpointer（可自定义）
await start_ui_bundler()

await graph.collect_graphs_from_env(True)
if config.N_JOBS_PER_WORKER > 0:
    tg.create_task(queue_with_signal())  # [注释] 启动后台队列
```

解释：

- 重点是 `api_checkpointer.start_checkpointer()`：会加载你在 `langgraph.json` 里配置的 custom checkpointer。

### 10.5 inmem 的 run 调度核心（pending -> running）

来源：`langgraph_runtime_inmem/ops.py` (`Runs.next`)

```python
pending_runs = sorted(
    [run for run in conn.store["runs"] if run["status"] == "pending"],
    key=lambda x: x.get("created_at", datetime.min),
)

for run in pending_runs[:limit]:
    # [注释] 同一 thread 同时只允许一个 running
    if any(
        r.get("thread_id") == run["thread_id"] and r.get("status") == "running"
        for r in conn.store["runs"]
    ):
        continue

    attempt = await conn.retry_counter.increment(run["run_id"])
    run["status"] = "running"
    yield run, attempt
```

解释：

- 这就是 inmem runtime 的最小调度语义：从内存 run 列表取任务，做串行化限制，再交给 worker 执行。

### 10.6 inmem 的本地落盘机制（开发态）

来源：`langgraph_runtime_inmem/_persistence.py`

```python
_flush_interval = 10  # 秒

def register_persistent_dict(d):
    _stores[d.filename] = weakref.ref(d)
    if _flush_thread is None:
        # [注释] 后台线程每 10 秒 sync 一次
        _flush_thread = (stop_event, threading.Thread(target=_flush_loop, daemon=True))
        _flush_thread[1].start()

def _flush_loop(stop_event):
    while not stop_event.wait(timeout=_flush_interval):
        for store_key in list(_stores.keys()):
            if store := _stores[store_key]():
                store.sync()
```

解释：

- inmem 并非完全不落盘；默认会周期性把 `PersistentDict` 同步到 `.langgraph_api/*.pckl`。
