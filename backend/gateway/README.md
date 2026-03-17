# OpenAgents Gateway (Go)

Go(Gin) 网关服务，替代原有的 Python FastAPI Gateway，为 OpenAgents 提供企业级多用户认证、Agent/Skill 管理、开放式 API 和 LangGraph 反向代理功能。

## 架构概览

```
Frontend (Next.js :3000)
     │
     ▼
Nginx (:2026)
     │
     ├── /api/auth/*          → Go Gateway (:8001)   # 认证
     ├── /api/agents/*        → Go Gateway (:8001)   # Agent CRUD
     ├── /api/skills/*        → Go Gateway (:8001)   # Skill CRUD
     ├── /api/models          → Go Gateway (:8001)   # 模型列表
     ├── /api/memory          → Go Gateway (:8001)   # 用户+Agent 作用域记忆
     ├── /api/mcp             → Go Gateway (:8001)   # MCP 配置
     ├── /api/langgraph/*     → Go Gateway (:8001)   # 反向代理到 LangGraph，注入 user_id
     ├── /api/threads/*/uploads   → Go Gateway       # 文件上传
     ├── /api/threads/*/artifacts → Go Gateway        # 制品访问
     ├── /open/v1/*           → Go Gateway (:8001)   # 开放式 API (API Token)
     └── /*                   → Frontend (:3000)
                                     │
                              Go Gateway 内部
                                     │
                                     ▼
                            LangGraph Server (:2024)
```

## 技术栈

- **Go 1.22+**
- **Gin** — HTTP 框架
- **PostgreSQL** — 用户、Token、模型配置、线程绑定与观测数据存储
- **pgx** — PostgreSQL 驱动
- **golang-jwt** — JWT 认证
- **bcrypt** — 密码哈希

## 快速开始

### 前置条件

- Go 1.22+
- PostgreSQL 14+
- LangGraph Server 运行在 `localhost:2024`

### 1. 初始化数据库

```bash
# 创建数据库
createdb openagents

# 运行迁移（SQL 位于项目根目录 migrations/，读取仓库根目录 .env）
make migrate
```

### 2. 配置

**方式一：准备密钥文件**

在项目根目录手动创建 `.env`，只放密钥/凭证：

所需环境变量：
- `DATABASE_URI` — PostgreSQL 连接串
- `JWT_SECRET` — JWT 签名密钥（生成：`openssl rand -base64 32`）
- `ONLYOFFICE_JWT_SECRET` — 可选；未设置时复用 `JWT_SECRET`
- 其他第三方 API key / token

说明：
- 非密钥配置放在 `gateway.yaml` 与项目根 `config.yaml`
- 共享技能库位于 `storage.base_dir/skills/`，默认即 `.openagents/skills/`
- 当 `OPENAGENTS_HOME` 或 `storage.base_dir` 使用相对路径时，网关会按项目根目录解析，和 Python runtime 保持一致
- 若通过 `docker/docker-compose-dev.yaml` 启动容器化开发环境：
  - 根 `.env` 仍是唯一共享 secrets 文件
  - 容器化 Gateway 通过进程环境运行，不再直接读取根 `.env` 文件
  - Compose 直接负责容器内固定 URL，例如 `http://langgraph:2024`
  - Compose 负责固定容器内的运行时根路径 `/openagents-home`
  - `OPENAGENTS_DOCKER_HOST_HOME` / `NODE_HOST` 这类值只是可选的 shell/compose 设置

**方式二：使用配置文件**

编辑 `gateway.yaml`：

```yaml
server:
  port: 8001
  host: 0.0.0.0

database:
  uri: $DATABASE_URI

jwt:
  secret: $JWT_SECRET   # 生产环境务必使用强密钥
  expire_hour: 72

storage:
  base_dir: .openagents

logging:
  level: info                # debug | info | warn | error
  access_log: true           # Gin access log
  proxy_debug: false         # 代理层详细日志（推荐排查 502 时开启）
  proxy_log_headers: false   # 打印请求头（会脱敏 Authorization/Cookie）
# Note: upstream 4xx/5xx will still emit [proxy][upstream-reject] with response detail summary.

upstream:
  langgraph_url: http://localhost:2024

onlyoffice:
  server_url: http://localhost:8082
  public_app_url: http://openagents-host:8001

proxy:
  routes:
    - prefix: /api/langgraph
      upstream: http://localhost:2024
      strip_prefix: true
      auth: jwt
```

### 3. 构建和运行

```bash
# 构建
make build

# 运行
make run

# 或直接
go run ./cmd/server
```

服务默认监听 `0.0.0.0:8001`。

## API 路由

### 公开路由（无需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/health` | 健康检查 |

### 受保护路由（JWT 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/auth/tokens` | API Token 列表/创建 |
| DELETE | `/api/auth/tokens/:id` | 删除 Token |
| GET/POST | `/api/agents` | Agent 列表/创建 |
| GET/PUT/DELETE | `/api/agents/:name` | Agent CRUD |
| POST | `/api/agents/:name/publish` | 发布 Agent (dev → prod) |
| GET | `/api/agents/:name/export` | 导出 Agent API 文档 |
| GET/POST | `/api/skills` | Skill 列表/创建 |
| PUT/DELETE | `/api/skills/:name` | Skill 更新/删除 |
| POST | `/api/skills/:name/publish` | 发布 Skill |
| GET | `/api/models` | 模型列表（读取 PostgreSQL `models` 表） |
| GET/POST | `/api/memory?agent_name=:name&agent_status=dev|prod` | 读取/写入当前用户在指定 Agent 下的记忆 |
| GET/PUT | `/api/mcp` | MCP 配置 |
| POST | `/api/threads/:id/uploads` | 文件上传；对 PDF/PPT/Excel/Word 生成 Markdown companion |
| GET | `/api/threads/:id/uploads/list` | 上传文件列表（折叠自动生成的 Markdown companion） |
| DELETE | `/api/threads/:id/uploads/:filename` | 删除上传文件；原文件的 Markdown companion 会一并删除 |
| GET | `/api/threads/:id/artifacts/*path` | 制品访问 |
| ALL | `/api/langgraph/*` | 反向代理到 LangGraph |

说明：
- `/api/memory` 必须显式传 `agent_name`；`agent_status` 省略时默认为 `dev`
- 记忆文件固定存储在 `{OPENAGENTS_HOME}/users/{user_id}/agents/{status}/{agent_name}/memory.json`
- 文档上传转换依赖运行 Gateway 的环境里可执行的 `markitdown`；可用 `OPENAGENTS_MARKITDOWN_BIN` 显式指定二进制路径。
- Office 文件的 `?preview=pdf` 转换依赖运行 Gateway 的环境内可执行的 `soffice`（LibreOffice）。
- `docker/docker-compose-dev.yaml` 构建的 Gateway 镜像已内置 LibreOffice；若直接在宿主机运行 Gateway，需要自行安装 `soffice`。
- 即使未安装 LibreOffice，工作区内联预览仍可通过 `/api/threads/:id/office-config/*path` 走 ONLYOFFICE 编辑器。

### 开放式 API（API Token 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/open/v1/agents/:name/chat` | 同步调用 Agent |
| POST | `/open/v1/agents/:name/stream` | SSE 流式调用 Agent |
| GET | `/open/v1/agents/:name/threads/:tid/artifacts/*path` | 获取制品 |

## 认证机制

### JWT 认证

```bash
# 注册
curl -X POST http://localhost:8001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret","name":"User"}'

# 登录
curl -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"user-account","password":"secret"}'
# 返回: {"token":"eyJ...","user":{...}}

# 使用 JWT 访问受保护 API
curl http://localhost:8001/api/agents \
  -H "Authorization: Bearer eyJ..."
```

### API Token 认证

```bash
# 创建 API Token（需要 JWT）
curl -X POST http://localhost:8001/api/auth/tokens \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"name":"my-token"}'
# 返回: {"token":"df_...","api_token":{...}}

# 使用 API Token 调用开放式 API
curl -X POST http://localhost:8001/open/v1/agents/my-agent/stream \
  -H "Authorization: Bearer df_..." \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

## Agent 发布流程

```
创建 (dev) → 测试 → 发布 (prod) → 开放 API 可调用

POST /api/agents          # 创建 dev agent
POST /api/agents/:name/publish  # dev → prod
POST /open/v1/agents/:name/stream  # 只有 prod agent 可通过 Open API 调用
```

### 统一协议（ASCII）

```text
                     +-----------------------------------------+
                     | shared skills library                   |
                     | {OPENAGENTS_HOME}/skills/{shared,store} |
                     +-------------------+---------------------+
                                      |
                                      | select skill names
                                      v
 +------------------+       +---------+---------+
 | agent AGENTS.md  | ----> | materialize dev   |
 | agent metadata   |       | agents/dev/<name> |
 +------------------+       | - AGENTS.md       |
                            | - config.yaml     |
                            | - copied skills/  |
                            +---------+---------+
                                      |
                                      | publish
                                      v
                            +---------+---------+
                            | materialize prod  |
                            | agents/prod/<name>|
                            | - AGENTS.md       |
                            | - config.yaml     |
                            | - copied skills/  |
                            | - keep runtime_   |
                            |   backend         |
                            +---------+---------+
                                      |
                                      | open API / LangGraph
                                      v
                    +-----------------+------------------+
                    | threads/<id>/user-data/*          |
                    | workspace + uploads + outputs     |
                    +-----------------------------------+
```

## 数据存储

### PostgreSQL

- `users` — 用户账号
- `api_tokens` — API 访问令牌
- `models` — 模型配置
- `thread_bindings` — 线程归属与运行时绑定
- `agent_traces` / `agent_trace_events` — Agent 观测数据

`/api/models` 数据来自 `models` 表。运行时模型选择由 Python(LangGraph graph factory)直接查询数据库，不再由网关注入 `model_config`。`models` 是唯一的模型配置真源。

Agent/Skill 定义已经完全脱离数据库：
- Agent 真源在 `{OPENAGENTS_HOME}/agents/{status}/{name}/`
- Skill 真源在 `{OPENAGENTS_HOME}/skills/{shared|store/dev|store/prod}/{name}/`
- 发布只是文件复制与状态切换，不写任何 agent/skill 元数据表

运行时职责分界：
- Go gateway 只负责写归档文件
- 是否启用 sandbox 由 Python runtime 启动时根据环境变量 / `config.yaml` 决定
- 运行时无论是本地还是 sandbox，都读取同一套已归档的 `AGENTS.md` 和 agent-local `skills/`

### 文件系统（运行时物化）

数据库只存引用；真正被 Python runtime 消费的是文件系统物化结果：

```
{OPENAGENTS_HOME}/
├── skills/
│   ├── shared/{skill-name}/SKILL.md
│   └── store/
│       ├── dev/{skill-name}/SKILL.md
│       └── prod/{skill-name}/SKILL.md
├── agents/
│   ├── prod/{name}/
│   │   ├── config.yaml
│   │   ├── AGENTS.md
│   │   └── skills/{skill-name}/SKILL.md
│   └── dev/{name}/
│       ├── config.yaml
│       ├── AGENTS.md
│       └── skills/{skill-name}/SKILL.md
├── users/{user_id}/
│   ├── USER.md
│   └── agents/{status}/{agent_name}/memory.json
└── threads/{thread_id}/
    └── user-data/
        ├── workspace/
        ├── uploads/
        └── outputs/
```

说明：
- `AGENTS.md` 归 agent 自己所有
- 共享技能真源位于 `{OPENAGENTS_HOME}/skills/{shared|store/dev|store/prod}/`
- agent 只引用并复制选中的 skill 到 `agents/{status}/{name}/skills/`
- 发布时 Go gateway 会从共享技能库复制到 `agents/prod/{name}/skills/`
- `lead_agent` 也走标准 agent 目录和 agent-local skills 副本
- 本地调试时，runtime 使用线程级 `/mnt/user-data/...` 虚拟路径，并仅对 legacy `/mnt/skills/...` 做后端映射兼容
- 启用 sandbox 时，运行时仍读取同一套线程级 `/mnt/user-data/...` 副本，只是执行后端不同

## LangGraph 代理

当前网关对 `/api/langgraph/*` 的职责只有三件事：
- JWT 鉴权
- 请求透传（不查模型库、不做模型解析）
- 对 JSON `POST/PUT/PATCH` 注入运行时身份字段：
  - `configurable.user_id`
  - `config.configurable.user_id`
  - 若 URL 含 `/threads/{thread_id}/...`，再注入 `thread_id` 到同位置

模型解析、Agent/Skill 绑定、线程级模型持久化全部在 Python(LangGraph graph factory) 内完成，直接查 PostgreSQL。

### 运行流程（ASCII）

```text
Browser / Frontend
        |
        | OPTIONS preflight
        v
[Gateway CORS]
- reflect Access-Control-Request-Headers
- OPTIONS -> 204
        |
        | /api/langgraph/*
        v
[Gateway JWT]
        |
        v
[Gateway runtime middleware]
- keep payload as-is
- inject user_id/thread_id into configurable
        |
        v
[Reverse proxy -> LangGraph]
        |
        v
[Python make_lead_agent]
- read configurable + runtime.execution_runtime.context
- resolve model via DB (models / thread_bindings)
- persist thread_bindings(thread_id,user_id,model_name,agent_name,assistant_id)
        |
        v
LangGraph run/history response
```

### 关键约束

- 网关不再维护 `langgraph_runtime` 模型策略配置。
- 前端发什么参数，网关只透传并补充 `user_id/thread_id`。
- Python 侧必须能通过 DB 独立完成模型与 Agent 解析（无网关兜底）。

## 开发

```bash
make build    # 编译到 bin/gateway
make run      # go run 启动
make test     # 运行测试
make clean    # 清理构建产物
make migrate  # 运行数据库迁移
```
