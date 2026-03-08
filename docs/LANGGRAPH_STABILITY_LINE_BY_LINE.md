# LangGraph 稳定性说明（逐行中文注释版）

## 1. 目标

- 说明 deer-flow 当前稳定性链路。  # [注释] 文档范围是你当前项目而不是泛化场景
- 给出关键源码并逐行中文注释。  # [注释] 每段代码的每一行都带注释
- 让你能快速定位“历史查询/状态存储/回放”是否稳定。  # [注释] 聚焦 threads + checkpoints

## 2. ASCII 稳定性流程图

```text
+---------------------+            +---------------------+            +--------------------------+
| Client / Frontend   | ---------> | Gateway (JWT/Proxy) | ---------> | LangGraph API            |
| - create run        |            | - x-user-id         |            | - /threads/* /runs/*     |
| - query history     | <--------- | - x-thread-id       | <--------- | - stream/history/state    |
+----------+----------+            +----------+----------+            +------------+-------------+
           |                                  |                                    |
           |                                  |                                    |
           |                                  |                                    v
           |                                  |                      +-----------------------------+
           |                                  |                      | inmem runtime backend       |
           |                                  |                      | - queue / ops / stream      |
           |                                  |                      | - thread records (runtime)  |
           |                                  |                      +--------------+--------------+
           |                                  |                                     |
           |                                  |                                     | state/history read-write
           |                                  |                                     v
           |                                  |                      +-----------------------------+
           |                                  |                      | custom checkpointer adapter |
           |                                  |                      | - required methods check    |
           |                                  |                      | - optional capability warn  |
           |                                  |                      +--------------+--------------+
           |                                  |                                     |
           |                                  |                                     v
           |                                  |                      +-----------------------------+
           |                                  |                      | Postgres checkpoints        |
           |                                  |                      | - checkpoint history source |
           |                                  |                      +-----------------------------+
```

稳定性关键点：  # [注释] 这三点决定线上是否“可恢复+可回放”

- `threads/{id}/history` 主要依赖 checkpointer 历史。  # [注释] 如果 checkpointer 出问题，历史接口会退化
- thread 元数据检索依赖 runtime 的 thread 记录。  # [注释] 不是所有线程字段都来自 checkpoint
- custom checkpointer 的可选能力影响删除/回滚/prune。  # [注释] 缺方法时会有功能退化或报错

## 3. 源码 1：deer-flow 启动器（runtime edition + 参数保护）

原始文件：`backend/agents/src/langgraph_dev.py`  # [注释] 这是你项目自有代码

```python
runtime_edition = (os.getenv("LANGGRAPH_RUNTIME_EDITION", "inmem").strip() or "inmem")  # [注释] 读取 runtime 版本，默认 inmem
if runtime_edition not in ALLOWED_RUNTIME_EDITIONS:  # [注释] 限定允许值，避免非法配置
    allowed = "|".join(sorted(ALLOWED_RUNTIME_EDITIONS))  # [注释] 构造错误提示中的允许列表
    raise RuntimeError(f"Invalid LANGGRAPH_RUNTIME_EDITION: {runtime_edition} (expected: {allowed})")  # [注释] 非法值直接失败
if runtime_edition == "postgres" and not _has_postgres_runtime_backend():  # [注释] 若请求 postgres 但后端包不存在
    print("LANGGRAPH_RUNTIME_EDITION=postgres requested, but langgraph_runtime_postgres is not installed. Falling back to inmem runtime.")  # [注释] 输出降级说明
    runtime_edition = "inmem"  # [注释] 自动回退到 inmem 保持服务可启动
host = os.getenv("LANGGRAPH_HOST", "0.0.0.0").strip() or "0.0.0.0"  # [注释] 读取监听地址
port = _parse_int_env("LANGGRAPH_PORT", 2024)  # [注释] 读取监听端口并做整型校验
runtime_kwargs: dict[str, str] = {}  # [注释] 为 run_server 构造额外 runtime 参数
database_uri = os.getenv("DATABASE_URI", "").strip()  # [注释] 读取共享数据库地址
if database_uri:  # [注释] 只在有值时覆盖
    runtime_kwargs["__database_uri__"] = database_uri  # [注释] 防止 langgraph_api.cli 默认把 DATABASE_URI 改成 :memory:
if runtime_edition == "postgres":  # [注释] 仅 postgres runtime 需要 Redis 等参数
    if not database_uri:  # [注释] 若上面没拿到 DATABASE_URI 则强制要求
        runtime_kwargs["__database_uri__"] = _required_env("DATABASE_URI")  # [注释] 缺失直接报错
    runtime_kwargs["__redis_uri__"] = _required_env("REDIS_URI")  # [注释] postgres runtime 必需 Redis
    migrations_path = os.getenv("MIGRATIONS_PATH", "").strip()  # [注释] 读取可选迁移路径
    if migrations_path:  # [注释] 仅有值时透传
        runtime_kwargs["__migrations_path__"] = migrations_path  # [注释] 交给 runtime 使用
run_server(  # [注释] 调用官方 API 启动服务
    host=host,  # [注释] 监听地址
    port=port,  # [注释] 监听端口
    reload=False,  # [注释] 显式关闭热重载以稳定行为
    graphs=config_data.get("graphs", {}),  # [注释] 图工厂配置
    env=config_data.get("env"),  # [注释] env 文件路径（langgraph.json 中配置）
    auth=config_data.get("auth"),  # [注释] 认证配置透传
    store=config_data.get("store"),  # [注释] store 配置透传
    http=config_data.get("http"),  # [注释] HTTP 配置透传（含 configurable_headers）
    ui=config_data.get("ui"),  # [注释] UI 配置透传
    webhooks=config_data.get("webhooks"),  # [注释] webhook 配置透传
    ui_config=config_data.get("ui_config"),  # [注释] UI config 透传
    checkpointer=config_data.get("checkpointer"),  # [注释] custom checkpointer 的关键入口
    disable_persistence=config_data.get("disable_persistence", False),  # [注释] 是否禁用 runtime 本地持久化
    runtime_edition=runtime_edition,  # [注释] 最终 runtime backend（inmem/postgres/community）
    **runtime_kwargs,  # [注释] 额外内部参数（database/redis/migrations）
)  # [注释] 启动完成后进入 uvicorn + runtime 生命周期
```

## 4. 源码 2：threads history API 路由（入口）

原始文件：`langgraph_api/api/threads.py`  # [注释] 这是 API 层入口逻辑

```python
@retry_db  # [注释] 数据层异常会自动重试（按框架策略）
async def get_thread_history(request: ApiRequest):  # [注释] GET /threads/{thread_id}/history
    thread_id = request.path_params["thread_id"]  # [注释] 从路径参数读取 thread_id
    validate_uuid(thread_id, "Invalid thread ID: must be a UUID")  # [注释] 做 UUID 合法性校验
    limit_ = request.query_params.get("limit", 1)  # [注释] 读取查询参数 limit，默认 1
    try:  # [注释] 开始 limit 类型转换
        limit = int(limit_)  # [注释] 字符串转整数
    except ValueError:  # [注释] 非数字会进入异常
        raise HTTPException(status_code=422, detail=f"Invalid limit {limit_}") from None  # [注释] 返回 422 参数错误
    before = request.query_params.get("before")  # [注释] 可选游标（checkpoint_id）
    config = {  # [注释] 构造 LangGraph config
        "configurable": {  # [注释] 所有与线程相关配置放在 configurable
            "thread_id": thread_id,  # [注释] 指定线程 ID
            "checkpoint_ns": "",  # [注释] 默认命名空间
            **get_configurable_headers(request.headers),  # [注释] 注入 x-user-id / x-thread-id 等头部
        }  # [注释] configurable 构造结束
    }  # [注释] config 构造结束
    async with connect(supports_core_api=False) as conn:  # [注释] 获取 runtime 连接上下文
        states = [  # [注释] 组装 API 返回数组
            state_snapshot_to_thread_state(c)  # [注释] 将内部 StateSnapshot 转换为 API schema
            for c in await Threads.State.list(conn, config=config, limit=limit, before=before)  # [注释] 实际历史读取入口
        ]  # [注释] 历史数组构造完成
    return ApiResponse(states)  # [注释] 返回历史 state 列表
```

## 5. 源码 3：history 实际读取（依赖 checkpointer）

原始文件：`langgraph_runtime_inmem/ops.py`  # [注释] inmem backend 的状态读取逻辑

```python
@staticmethod  # [注释] 静态方法，不依赖实例
async def list(conn: InMemConnectionProto, *, config: Config, limit: int = 1, before: str | Checkpoint | None = None, metadata: MetadataInput = None, ctx: Auth.types.BaseAuthContext | None = None) -> list[StateSnapshot]:  # [注释] 线程历史读取函数签名
    thread_id = _ensure_uuid(config["configurable"]["thread_id"])  # [注释] 标准化线程 ID
    filters = await Threads.handle_event(ctx, "read", Auth.types.ThreadsRead(thread_id=thread_id))  # [注释] 计算鉴权过滤条件
    thread = await fetchone(await Threads.get(conn, config["configurable"]["thread_id"], ctx=ctx))  # [注释] 读取线程基础记录
    thread_metadata = thread["metadata"]  # [注释] 拿到线程 metadata
    if not _check_filter_match(thread_metadata, filters):  # [注释] 鉴权过滤不通过
        return []  # [注释] 直接返回空列表
    thread_config = cast(dict[str, Any], thread["config"])  # [注释] 拿到线程 config
    thread_config = {"configurable": {**thread_config.get("configurable", {}), **config.get("configurable", {})}, **thread_config}  # [注释] 合并请求 config 与线程 config
    if graph_id := thread_metadata.get("graph_id"):  # [注释] 必须能解析 graph_id 才能读状态历史
        checkpointer = await _get_checkpointer(conn, unpack_hook=_msgpack_ext_hook_to_json)  # [注释] 获取 checkpointer（可 custom）
        async with get_graph(graph_id, thread_config, checkpointer=checkpointer, store=(await get_store()), access_context="threads.read") as graph:  # [注释] 构造 graph 运行上下文
            before_param = ({"configurable": {"checkpoint_id": before}} if isinstance(before, str) else before)  # [注释] before 字符串转为 checkpoint config
            states = [state async for state in graph.aget_state_history(config, limit=limit, filter=metadata, before=before_param)]  # [注释] 历史读取核心：从 checkpointer 拉 checkpoint 历史
            return states  # [注释] 返回历史快照列表
    return []  # [注释] 无 graph_id 时返回空历史
```

## 6. 源码 4：thread 最新状态镜像（不等于历史）

原始文件：`langgraph_runtime_inmem/ops.py`  # [注释] inmem thread 记录更新逻辑

```python
@staticmethod  # [注释] 静态方法
async def set_status(conn: InMemConnectionProto, thread_id: UUID, checkpoint: CheckpointPayload | None, exception: BaseException | None) -> None:  # [注释] 更新 thread 当前状态
    thread_id = _ensure_uuid(thread_id)  # [注释] 标准化 UUID
    thread = next((thread for thread in conn.store["threads"] if thread["thread_id"] == thread_id), None)  # [注释] 从 runtime store 查找线程记录
    if not thread:  # [注释] 线程不存在
        raise HTTPException(status_code=404, detail=f"Thread {thread_id} not found.")  # [注释] 直接返回 404
    has_next = False if checkpoint is None else bool(checkpoint["next"])  # [注释] checkpoint 是否还有待执行节点
    if exception:  # [注释] 有异常优先
        status = "error"  # [注释] 线程状态置为 error
    elif has_next:  # [注释] 无异常但有待执行节点
        status = "interrupted"  # [注释] 线程状态置为 interrupted
    else:  # [注释] 无异常且无待执行节点
        status = "idle"  # [注释] 线程状态置为 idle
    if any(run["status"] in ("pending", "running") and run["thread_id"] == thread_id for run in conn.store["runs"]):  # [注释] 如果还有在途 run
        status = "busy"  # [注释] 覆盖为 busy
    now = datetime.now(UTC)  # [注释] 记录更新时间
    update = {  # [注释] 准备更新字段
        "updated_at": now,  # [注释] 普通更新时间
        "state_updated_at": now,  # [注释] 状态更新时间
        "status": status,  # [注释] 最新线程状态
        "interrupts": ({t["id"]: [_patch_interrupt(i) for i in t["interrupts"]] for t in checkpoint["tasks"] if t.get("interrupts")} if checkpoint else {}),  # [注释] 中断信息镜像
        "error": json_loads(json_dumpb(exception)) if exception else None,  # [注释] 错误信息镜像
    }  # [注释] 更新字段组装结束
    if checkpoint is not None:  # [注释] 如果有 checkpoint
        update["values"] = checkpoint["values"]  # [注释] 把最新 values 镜像到 thread 记录
    thread.update(update)  # [注释] 写回 runtime thread store
```

## 7. 源码 5：custom checkpointer 能力与稳定性退化提示

原始文件：`langgraph_api/_checkpointer/_adapter.py`  # [注释] custom checkpointer 适配层

```python
if not caps.has_adelete_thread:  # [注释] 缺少线程删除能力
    await logger.awarning("Custom checkpointer missing adelete_thread: DELETE /threads/<id> will fail. Thread deletion and delete_all pruning are not supported.")  # [注释] 删除线程能力退化
if not caps.has_adelete_for_runs:  # [注释] 缺少按 run 删除能力
    await logger.awarning("Custom checkpointer missing adelete_for_runs: multitask_strategy='rollback' will not clean up checkpoints from cancelled runs. Thread state may reflect the rolled-back run until a new run completes.")  # [注释] rollback 清理退化
if not caps.has_acopy_thread:  # [注释] 缺少线程复制能力
    await logger.ainfo("Custom checkpointer missing acopy_thread: using generic fallback (functional but slower). POST /threads/<id>/copy will re-insert checkpoints one-by-one via aput/aput_writes.")  # [注释] 可用但会慢
if not caps.has_aprune:  # [注释] 缺少历史裁剪能力
    await logger.awarning("Custom checkpointer missing aprune: thread history pruning (keep_latest) is not supported. Old checkpoints will accumulate and storage usage will grow without bound for long-lived threads.")  # [注释] keep_latest 会退化
```

## 8. 对你项目的直接结论

- 你当前 `history/state` 主链路是走 checkpoints 的。  # [注释] 核心历史能力已具备
- 线程列表与最新状态镜像仍依赖 runtime thread 记录。  # [注释] 不建议只保留 checkpoints 而删掉 thread 存储层
- 稳定性上要关注 custom checkpointer 的扩展能力。  # [注释] 缺方法会在删除/回滚/裁剪上退化

## 9. 快速验收命令（建议）

```bash
cd backend/agents  # [注释] 进入 agents 目录
uv run python -m src.langgraph_dev  # [注释] 启动服务并观察日志
```

启动后你应看到两类日志：  # [注释] 这两条同时出现才是你期望架构

- `Using langgraph_runtime_inmem`  # [注释] 说明 runtime backend 是 inmem
- `Using custom checkpointer: AsyncPostgresSaver`  # [注释] 说明 checkpoint 实际落 Postgres
