# `docker-compose-dev.yaml` 检查结论与正式发版建议

本文只讨论人类维护者关心的工程与运维层：

- `docker/docker-compose-dev.yaml` 现在适合做什么
- 哪些配置是开发专用
- 哪些地方存在冗余或不适合作为正式发布基线
- 正常情况下更合适的正式发布流程是什么
- 后续如何做版本更新、回滚和日常运维

## 一句话结论

`docker/docker-compose-dev.yaml` 是一份开发联调编排文件，不应该直接当正式发布清单。

它的主要目标是：

- 本地一键拉起前端、Gateway、LangGraph、Nginx
- 需要时顺带拉起 `sandbox-aio` 和 `ONLYOFFICE`
- 通过源码挂载、缓存挂载、开发端口暴露提升调试效率

这些目标和正式发布的目标不同。正式发布更应该追求：

- 镜像不可变
- 端口最小暴露
- 配置边界清晰
- 数据持久化明确
- 更新、回滚、迁移流程可重复

## 当前文件的定位

当前编排文件包含这些服务：

- `frontend`
- `gateway`
- `langgraph`
- `nginx`
- `onlyoffice`
- `sandbox-aio`
- `provisioner`（仅 profile 启用）

其中：

- `frontend` 是 Vite 开发服务器，不是正式前端服务
- `gateway` 与 `langgraph` 都使用源码目录挂载，偏向开发热更新
- `nginx` 主要是本地统一入口
- `onlyoffice` 和 `sandbox-aio` 属于能力型依赖，不一定是每个正式环境都必须常驻
- `provisioner` 只在 Kubernetes sandbox 模式下需要，不是默认部署组件

## 检查结果

### 1. 不是错误，但明显属于开发专用的配置

这些配置不建议沿用到正式环境：

- `frontend` 使用 `pnpm run dev`
  - 这是开发服务器，不是正式静态资源服务
- 大量源码挂载
  - 例如 `../frontend/app/src`、`../backend/gateway`、`../backend/agents`
  - 正式环境应改为镜像内产物，而不是宿主机源码目录
- 本地缓存挂载
  - `~/.cache/go-build`
  - `~/.cache/uv`
  - `PNPM_STORE_PATH`
  - 这些是开发提速项，不是发布必需项
- 直接暴露调试端口
  - `gateway: 8001`
  - `onlyoffice: 8082`
  - `sandbox-aio: 8083`
  - 正式环境通常只保留统一入口，内部服务走容器网络
- `CHOKIDAR_USEPOLLING=true`
  - 明确是为了容器内前端热更新
- `cache_from: /tmp/docker-cache-*`
  - 这是本机 Docker 构建加速配置，不是发布配置

### 2. 有冗余，但在开发场景里可以接受的配置

这些配置不算 bug，但可以看作“开发便利优先”的写法：

- `container_name`
  - 对正式环境通常不推荐，因为会降低横向扩展和多套环境并行能力
  - 当前仓库里 `scripts/docker.sh`、`docker/provisioner/README*.md` 直接引用了部分固定容器名，所以在开发栈里仍有现实价值
- 每个服务都显式声明 `networks: openagents-dev`
  - 对 Compose 默认单网络场景来说偏冗余
  - 但它能把网络边界写得更直白，开发时可读性还可以
- 顶层 `name: openagents-dev`
  - 这不是冗余，反而建议保留
  - 目的是固定 Compose project name，避免多次从不同目录启动导致 DNS/network 漂移

### 3. 当前应当视为“需要注意”的点

- `docker-compose-dev.yaml` 文件名本身已经说明它是 dev 栈
  - 如果把它直接复制到线上，后续会把开发行为带到正式环境
- `frontend` 当前没有专门的正式镜像编排
  - 现有 Dockerfile 明显以开发运行方式为主
  - 正式发布应改成“构建产物 + 静态服务”或单独的生产启动命令
- `gateway` / `langgraph` 共享 `.openagents` 持久目录是必须的
  - 这不是冗余
  - 因为 agent/skill 归档、thread user-data、知识库文件等依赖这份共享存储
- `models` 不在镜像里，而在 PostgreSQL
  - 正式发版不能只更新镜像，还要明确数据库和迁移策略

### 4. 本次顺手做的低风险清理

为了让 dev 文件本身更干净，我已经做了两处低风险调整：

- 把 `langgraph` 的 `config.yaml` 挂载改成只读
  - 运行时代码读取该文件，不需要写权限
- 删除空的 `volumes: {}`
  - 这是无实际作用的空配置

## 哪些组件在正式环境里应该保留

最简单、最合适的正式部署建议是单机或单节点容器部署，组件控制在最小集合。

### 必需组件

- `nginx`
  - 统一对外入口
  - 同时托管用户前台和后台管理两个正式前端构建产物
- `gateway`
  - Go API 网关
- `langgraph`
  - Python runtime
- `sandbox-aio`
  - 当前仓库正式自托管方案里的基础运行能力
- `onlyoffice`
  - 当前仓库正式自托管方案里的基础文档能力
- PostgreSQL
  - 可自建，也可用托管数据库
- 共享持久目录
  - 同时挂给 `gateway` 和 `langgraph`
  - 存放 `.openagents`

### 按需组件

- `provisioner`
  - 只有你走 Kubernetes provisioner 模式时才需要

## 最推荐的正式拓扑

最简单的正式拓扑建议如下：

```text
Internet
   |
   v
 Nginx / 反向代理
   |----> 用户前台 + 后台管理静态资源
   |
   |----> Gateway
             |
             |----> PostgreSQL
             |
             |----> LangGraph
                           |
                           |----> sandbox-aio
                           |
                           |----> 共享 .openagents 持久目录

 Browser
   |
   |----> ONLYOFFICE :8082
```

关键点：

- 对外主要入口是 `nginx`
- `gateway` 和 `langgraph` 只在内部网络通信
- `.openagents` 必须持久化
- PostgreSQL 必须持久化
- 当前仓库的单机正式版建议保留 `onlyoffice` 与 `sandbox-aio`
- `sandbox-aio` 不应暴露到公网

## 不建议的正式发布方式

不要把以下模式作为正式发布方案：

- 直接复用 `docker/docker-compose-dev.yaml`
- 线上继续用 `pnpm run dev`
- 线上继续挂载宿主机源码目录
- 线上暴露 `gateway:8001`、`sandbox-aio:8083` 这类调试口到公网
- 线上依赖本机 `~/.cache/*` 缓存目录
- 线上继续使用 `:latest` 作为长期固定版本策略

## 正常情况下的正式发版流程

### 1. 代码发布和运行时数据要分开看

这个仓库有三类“要发布”的东西：

- 代码镜像
  - `frontend`
  - `gateway`
  - `langgraph`
- 数据库结构与数据
  - `migrations/`
  - PostgreSQL 中的 `models` 等表
- 运行时归档数据
  - `.openagents/agents`
  - `.openagents/skills`
  - `.openagents/threads`
  - `.openagents/knowledge`

它们不是一回事，不应该混成一个“覆盖式发布”。

### 2. 最简正式发版步骤

建议采用下面的顺序：

1. 在主分支合并代码并打版本号
2. 构建固定版本镜像，不使用 `latest` 作为唯一标识
3. 推送镜像到镜像仓库
4. 备份数据库
5. 备份 `.openagents` 持久目录
6. 在目标机器拉取新镜像
7. 若 `migrations/` 有变更，先人工审阅并手工执行 SQL
8. 再重建并重启 `nginx`、`gateway`、`langgraph`、`sandbox-aio`、`onlyoffice`
9. 做发布后验证

### 3. 推荐的版本标记方式

建议同时使用两类 tag：

- 语义版本
  - 例如 `v0.9.3`
- Git 提交哈希
  - 例如 `987bf2b`

这样回滚时更清晰。

## 数据库迁移建议

推荐做法：

- 每次代码发布前，先确认目标版本对应的 `migrations/`
- 如有 SQL 变更，在维护窗口由人手工执行一次
- 不要把 SQL 放进 Gateway 服务启动、docker compose 启动或容器 entrypoint
- 不要让多个应用实例同时执行同一批结构变更

## 后续如何做版本更新

### 场景 A：纯代码更新

例如：

- 前端页面改动
- Gateway 接口逻辑改动
- LangGraph runtime 改动

流程：

1. 拉取新镜像
2. 如有需要，人工执行必要 SQL
3. 重启对应服务
4. 验证核心功能

### 场景 B：配置更新

例如：

- `.env` 密钥变化
- `config.yaml` runtime 配置变化
- `gateway.yaml` upstream / onlyoffice / logging 变化

流程：

1. 先备份旧配置
2. 更新配置文件
3. 重启受影响服务
4. 验证配置是否生效

注意：

- `.env` 放 secrets
- `config.yaml` / `gateway.yaml` 放非 secrets
- 不要把 host-view URL 和 container-view URL 混进同一个通用变量里

### 场景 C：模型或后台数据更新

例如：

- `models` 表调整
- 管理后台新增/修改模型

流程：

1. 先确认数据库是唯一真源
2. 更新数据库数据
3. 验证 `gateway` / `langgraph` 读到的是新值
4. 必要时重启服务清理缓存

### 场景 D：agent / skill / 知识库内容更新

这类内容多数落在 `.openagents` 持久目录和数据库里，不完全属于“代码发版”。

建议：

- 不要用重新部署镜像去覆盖 `.openagents`
- 把 `.openagents` 视为持久数据目录
- 发布代码时保持该目录不变

## 发布后检查清单

每次发布后至少检查：

- 首页是否能正常打开
- 登录是否正常
- `/health` 是否正常
- `/api/models` 是否返回正确
- 能否创建新线程并正常对话
- 若启用了 knowledge-base：
  - 上传
  - 建库
  - 引用
  - 预览
- ONLYOFFICE 文档预览/编辑是否正常
- sandbox 运行时文件与命令执行是否正常

## 回滚建议

推荐最小回滚单元如下：

- 镜像版本回滚
- 数据库回滚
  - 仅在迁移确实需要回退时执行
- `.openagents` 数据目录恢复
  - 仅在运行时归档/知识库数据被误写时执行

正常情况下优先做：

1. 回滚镜像
2. 保留数据库和 `.openagents`
3. 观察是否恢复

只有在确认问题来自数据库结构或运行时持久数据时，才进一步回滚数据库或恢复目录快照。

## 对当前仓库最合适的建议

如果目标是“尽量最简单、最合适”：

- 保留 `docker/docker-compose-dev.yaml` 只做开发联调
- 另建一份正式部署清单，不复用 dev 文件
- 正式环境只保留最小服务集：
  - `nginx`
  - `gateway`
  - `langgraph`
  - `sandbox-aio`
  - `onlyoffice`
  - PostgreSQL
  - `.openagents` 持久卷
- `provisioner` 仅在 Kubernetes sandbox 模式下按需启用
- 代码发版、数据库 SQL 手工执行、运行时数据持久化分开管理

如果后续要继续完善，优先级建议是：

1. 增加专门的生产前端镜像或静态资源构建流程
2. 增加正式部署编排文件，不再复用 dev compose
3. 把镜像构建、推送、迁移、重启、验证串成固定发版脚本或 CI/CD
