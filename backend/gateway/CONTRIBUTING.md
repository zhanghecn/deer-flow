# Contributing to OpenAgents Go Gateway

感谢你考虑为 OpenAgents Go Gateway 做贡献。本文档介绍开发规范和工作流程。

## 开发环境

### 前置条件

- Go 1.22+
- PostgreSQL 14+
- Make

### 本地开发设置

```bash
# 1. 克隆仓库（如果还没有）
git clone <repo-url>
cd openagents/backend/gateway

# 2. 创建 PostgreSQL 数据库
createdb openagents

# 3. 配置环境变量
export DATABASE_URI=postgresql://root:zhangxuan66@localhost:5432/openagents?sslmode=disable
export JWT_SECRET=dev-secret-change-me

# 4. 手工执行项目根目录 migrations/ 下的 SQL
#    Gateway 不再内置自动迁移命令
#    例如在仓库根目录执行：
#    psql "$DATABASE_URI" -f migrations/001_init.up.sql
#    psql "$DATABASE_URI" -f migrations/002_seed_data.up.sql

# 5. 启动
make run
```

### 运行测试

```bash
make test
```

## 项目结构

```
backend/gateway/
├── cmd/server/main.go       # 入口，组装所有组件
├── internal/                 # 私有包（外部不可导入）
│   ├── config/              # 配置加载
│   ├── middleware/           # HTTP 中间件
│   ├── handler/             # HTTP 请求处理
│   ├── model/               # 领域模型和 DTO
│   ├── repository/          # 数据库访问层
│   ├── service/             # 业务逻辑层
│   └── proxy/               # LangGraph 反向代理
├── pkg/                     # 公共包（可外部导入）
│   ├── jwt/                 # JWT 工具
│   └── storage/             # 文件系统操作
├── (root)/migrations/       # SQL 迁移文件（项目根目录）
├── gateway.yaml             # 配置模板
├── Makefile
└── go.mod
```

## 编码规范

### 通用

- 使用 `gofmt` 格式化代码
- 运行 `go vet` 检查常见问题
- 错误信息使用小写，不以句号结尾
- 使用 `fmt.Errorf("context: %w", err)` 包装错误

### 分层架构

代码遵循严格的分层架构：

```
Handler → Service → Repository → Database
                 → Storage (Filesystem)
```

- **Handler**: 解析 HTTP 请求/响应，不包含业务逻辑
- **Service**: 业务逻辑，协调 Repository 和 Storage
- **Repository**: 纯数据库操作，一个方法对应一个 SQL 查询
- **Storage (pkg/storage)**: 文件系统操作

### 新增 API 端点的流程

1. 在 `internal/model/dto.go` 中定义请求/响应 DTO
2. 在 `internal/repository/` 中添加数据库查询方法
3. 在 `internal/service/` 中添加业务逻辑（如需要）
4. 在 `internal/handler/` 中实现 HTTP 处理函数
5. 在 `cmd/server/main.go` 中注册路由
6. 添加测试
7. 更新 README.md

### 数据库迁移

- 迁移文件放在项目根目录 `migrations/` 目录
- 根基线固定为两份 SQL：`001_init.up.sql`（结构）和 `002_seed_data.up.sql`（数据）
- 新的结构或数据变更应直接折叠回这两份基线文件，而不是继续追加根目录 stepwise SQL
- 每个迁移文件包裹在 `BEGIN; ... COMMIT;` 事务中
- 使用 `IF NOT EXISTS` 保证幂等性
- 不要通过 Gateway 服务或启动脚本自动执行这些 SQL

### 认证

- 内部 API 使用 JWT（`middleware.JWTAuth`）
- 开放 API 使用 API Token（`middleware.APITokenAuth`）
- 使用 `middleware.GetUserID(c)` 获取当前用户 ID
- 永远不要在日志中打印 token 或密码

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat(gateway): add agent export endpoint
fix(auth): handle expired JWT gracefully
docs(gateway): update API route table
refactor(handler): extract common error response
```

## 与后端的关系

Go 网关与 Python 后端（LangGraph Server）协同工作：

- Go 网关管理用户认证、模型配置、线程绑定和文件系统同步
- LangGraph Server 负责 Agent 执行和对话管理
- Go 网关代理 `/api/langgraph/*` 请求到 LangGraph，注入 `user_id`
- Agent/Skill 的 AGENTS.md 和 config.yaml 通过文件系统同步给 LangGraph 读取

**关键约定**：修改 Agent/Skill 存储结构时，必须同时更新 Go 网关（`pkg/storage/fs.go`）和 Python agents（`backend/agents/src/config/paths.py`），保持路径布局一致。
