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
     ├── /api/memory          → Go Gateway (:8001)   # 记忆管理
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
- **PostgreSQL** — 用户/Agent/Skill/Token 元数据存储
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

# 运行迁移（会自动读取 .env 中的 DB_HOST/USER/PASSWORD 等变量）
make migrate
```

### 2. 配置

**方式一：使用环境变量（推荐）**

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
# 编辑 .env 填写实际值
```

所需环境变量：
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSLMODE` — 数据库连接
- `JWT_SECRET` — JWT 签名密钥（生成：`openssl rand -base64 32`）
- `OPENAGENTS_HOME` — 数据存储目录（可选，默认 `.openagents`）

**方式二：使用配置文件**

编辑 `gateway.yaml`（支持环境变量占位符 `$VAR`）：

```yaml
server:
  port: 8001
  host: 0.0.0.0

database:
  host: $DB_HOST       # 或填写实际值
  port: $DB_PORT
  user: $DB_USER
  password: $DB_PASSWORD
  dbname: $DB_NAME
  sslmode: $DB_SSLMODE

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

upstream:
  langgraph_url: http://localhost:2024
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
| GET | `/api/models` | 模型列表 |
| GET/POST | `/api/memory` | 记忆管理 |
| GET/PUT | `/api/mcp` | MCP 配置 |
| POST | `/api/threads/:id/uploads` | 文件上传 |
| GET | `/api/threads/:id/uploads` | 上传文件列表 |
| DELETE | `/api/threads/:id/uploads` | 删除上传文件 |
| GET | `/api/threads/:id/artifacts/*path` | 制品访问 |
| ALL | `/api/langgraph/*` | 反向代理到 LangGraph |

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
  -d '{"email":"user@example.com","password":"secret"}'
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

## 数据存储

### PostgreSQL

- `users` — 用户账号
- `api_tokens` — API 访问令牌
- `agents` — Agent 元数据（共享，非按用户隔离）
- `skills` — Skill 元数据（共享）
- `agent_skills` — Agent-Skill 关联
- `threads` — 对话线程索引
- `models` — 模型配置

### 文件系统（双写同步）

Agent/Skill 的 AGENTS.md 和 config.yaml 同步写入文件系统，供 LangGraph Server 读取：

```
{base_dir}/
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
│   ├── memory.json
│   └── USER.md
└── threads/{thread_id}/
    └── user-data/
        ├── workspace/
        ├── uploads/
        └── outputs/
```

## LangGraph 代理

Go 网关代理 `/api/langgraph/*` 请求到 LangGraph Server 时，自动注入当前用户 ID 到请求体的 `configurable` 字段：

```json
{
  "configurable": {
    "user_id": "uuid-from-jwt"
  }
}
```

## 开发

```bash
make build    # 编译到 bin/gateway
make run      # go run 启动
make test     # 运行测试
make clean    # 清理构建产物
make migrate  # 运行数据库迁移
```
