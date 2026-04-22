# OpenAgents 正式环境 Compose 使用说明

本文对应文件：

- `docker/docker-compose-prod.yaml`

目标不是做云原生大规模编排，而是提供一份适合单机/单节点正式环境、同时也能作为本地 Docker 默认入口的自托管方案。

## 设计取向

这份 Compose 现在就是仓库唯一保留的编排文件：

- 前端不再跑 Vite dev server
- 两个前端都先构建产物，再由一个 Nginx 容器托管
- `gateway` 和 `langgraph` 不对外暴露端口
- `sandbox-aio` 和 `onlyoffice` 作为基础能力常驻
- `openpencil` 默认从仓库内置的 `openpencil/` 源码副本构建，避免 Deer Flow 与设计编辑器版本漂移
- `gateway` / `langgraph` 只挂各自需要热更新的源码目录与显式配置文件
- Python 依赖保留在镜像里的 `/opt/venv`，代码更新只需要重启容器，不会因为源码挂载而反复安装

注意：

- 根目录 `config.yaml` 依然会被挂进正式环境容器
- 但其中 `sandbox.base_url: http://127.0.0.1:18080` 属于宿主机/开发视角地址
- 正式环境里 `langgraph` 会用 `OPENAGENTS_SANDBOX_BASE_URL=http://sandbox-aio:8080` 覆盖它
- `sandbox-aio` 额外对宿主机暴露 `18080 -> 8080`，方便访问它的管理页面
- `langgraph` 的 inmem 运行时目录固定落在 `.openagents/runtime/langgraph/`
- `gateway` / `langgraph` 继续输出到容器标准日志，由 Docker 做日志轮转
- 浏览器访问链路仍然是 `nginx -> gateway -> langgraph -> sandbox-aio`
- 如果外部模型网关由别的面板/Compose 单独托管，推荐把它直接接入
  `openagents-prod_openagents` bridge 网络，并在该网络上暴露稳定别名
  `model-gateway`

这份方案更适合：

- 你已经把仓库 clone 到正式机器
- 你希望直接复用本地的 `.env`、`config.yaml`、`gateway.yaml`
- 你希望以后 `git pull + compose build + compose up -d` 就能更新

## 最省事的用法

这套正式环境现在不依赖额外的 docker 专用 env 文件，也不依赖 sh 脚本。

默认值直接写在 compose 里：

- 用户前台端口：`8083`
- 后台管理端口：`8081`
- ONLYOFFICE 暴露端口：`8082`
- sandbox 管理端口：`18080`
- 持久化目录：仓库根目录 `.openagents/`
- secrets 文件：仓库根目录 `.env`
- OpenPencil 源码目录：`openpencil/`

只有你确实要改部署形态时，才需要覆写这些变量：

- `OPENAGENTS_ENV_FILE`
- `OPENAGENTS_DOCKER_HOST_HOME`
- `OPENAGENTS_APP_PORT`
- `OPENAGENTS_ADMIN_PORT`
- `OPENAGENTS_ONLYOFFICE_PORT`
- `OPENAGENTS_SANDBOX_PORT`

如果你有外部模型网关容器，例如 1Panel 托管的 `new-api`，推荐把那个容器直接接到
`openagents-prod_openagents`，然后在模型记录里统一写：

```text
http://model-gateway:3000
```

临时接入时可以直接执行：

```bash
make docker-model-gateway-attach MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F
```

也就是说，正常情况下你不用再猜任何 `VITE_*`、`OPENAGENTS_*` 这类正式环境参数。

推荐直接在 `docker/` 目录执行：

```bash
docker compose -f docker-compose-prod.yaml build
docker compose -f docker-compose-prod.yaml up -d
```

如果你要自定义端口、数据目录或 `.env` 路径，可以在同一条命令前加环境变量：

```bash
OPENAGENTS_APP_PORT=80 \
OPENAGENTS_DOCKER_HOST_HOME=/srv/openagents \
docker compose -f docker-compose-prod.yaml up -d
```

如果你希望启动命令在返回前就把关键入口也校验掉，推荐直接用仓库根目录：

```bash
make docker-start
```

它会在 compose 启动后继续等待并校验：

- `http://127.0.0.1:8083/health`
- `http://127.0.0.1:8083/`
- `http://127.0.0.1:8081/`

日常排查时也建议优先用：

```bash
make docker-status
make docker-verify
```

这样可以直接发现“容器已经创建，但还停在 `Created` / `starting` / 非 healthy”
这种最容易误判成“已经启动成功”的状态。

数据库结构 SQL 不再由 gateway 或 compose 自动执行。
如果 `migrations/` 下有变更，请先人工审阅并手工执行，再启动服务。

查看当前生效参数：

```bash
docker compose -f docker-compose-prod.yaml config
```

查看状态：

```bash
docker compose -f docker-compose-prod.yaml ps
```

或者：

```bash
make docker-status
```

查看日志：

```bash
docker compose -f docker-compose-prod.yaml logs -f
```

## 速查表

### 1. compose 里的 `env_file` 是什么

- `env_file: ${OPENAGENTS_ENV_FILE:-../.env}`
- 作用：把仓库根目录 `.env` 里的 secrets 注入给容器进程
- 你正常只需要维护这一份 `.env`
- 这里适合放：
  - `DATABASE_URI`
  - `JWT_SECRET`
  - `ONLYOFFICE_JWT_SECRET`
  - 各种第三方 API Key

### 2. compose 里的 `environment` 是什么

- `environment:` 下面写的是容器内部固定运行参数
- 这些不是让你日常手工改的“部署变量”，而是容器之间彼此通信时的固定地址或固定路径
- 例如：
  - `LANGGRAPH_URL=http://langgraph:2024`
    - 含义：gateway 在容器网络里访问 langgraph
  - `OPENAGENTS_SANDBOX_BASE_URL=http://sandbox-aio:8080`
    - 含义：langgraph 在容器网络里访问 sandbox
  - `OPENAGENTS_HOME=/openagents-home`
    - 含义：运行时数据根目录在容器内固定挂载到这里

### 3. compose 里的 `command` 是什么

- `command:` 是容器启动后真正执行的命令
- 这决定了“这个容器起来后到底跑什么”
- 例如：
  - `gateway` 跑的是挂载进来的源码 `go run ./cmd/server`
  - `langgraph` 直接以 `.openagents/runtime/langgraph/` 作为工作目录启动，避免把运行时状态写回源码目录

### 4. 每个容器是干什么的

- `nginx`
  - 托管用户前台和管理后台静态页面
  - 反向代理 `/api`、`/open`、`/health` 到 gateway
- `openpencil`
  - 设计编辑器服务
  - 通过 nginx 同源代理到 `/openpencil/*`
- `gateway`
  - 统一 API 入口
  - 管登录、Agent/Skill/Thread/Knowledge 相关接口
- `langgraph`
  - Python runtime
  - 真正执行 agent 运行、线程、工具调用
- `sandbox-aio`
  - 真正执行文件读写、命令运行等 sandbox 能力
- `onlyoffice`
  - 文档在线预览与编辑

### 5. 直接 `docker compose` 常用命令做什么

- `docker compose ... config`
  - 打印最终 compose 配置
  - 适合上线前检查
- `docker compose ... build`
  - 构建镜像
- `docker compose ... up -d`
  - 启动整套服务
- `docker compose ... restart`
  - 重启容器
- `docker compose ... ps`
  - 看当前容器状态
- `make docker-status`
  - 看当前 compose 状态，适合作为日常入口
- `make docker-verify`
  - 等待服务 ready，并校验正式入口 HTTP 可达
- `docker compose ... logs -f`
  - 看日志
- `docker compose ... down`
  - 停止容器，但不会删 `.openagents` 数据

## 暴露端口

默认暴露两个端口：

- 用户前台：`80`
- 后台管理：`8081`

说明：

- 用户前台走 `http://你的主机/`
- 后台管理走 `http://你的主机:8081/`
- ONLYOFFICE 编辑器脚本与 websocket 统一走同源 `http://你的主机/onlyoffice/`

之所以把后台放到单独端口，而不是 `/admin/` 子路径，是因为当前 admin 前端没有做 basename 子路径部署，这样最简单、改动最少、最稳。

如果你以后真要改端口，就直接改 `docker/docker-compose-prod.yaml` 里的端口映射。

但要注意：

- 如果用户前台不再走 `80`，后台里生成的 demo/workspace 链接默认仍会按 `http(s)://<host>/` 生成

## 服务说明

### `nginx`

职责：

- 托管用户前台构建产物
- 托管后台管理构建产物
- 反向代理 `/api/*`、`/open/*`、`/health` 到 Gateway

端口：

- `80`
- `8081`

### `gateway`

职责：

- 鉴权
- Agent/Skill CRUD
- `models`、threads、knowledge-base、ONLYOFFICE 配置接口
- 代理 `/api/langgraph/*`

对外端口：

- 不暴露

### `langgraph`

职责：

- Python runtime
- 运行 lead agent / domain agent
- 连接 sandbox-aio

对外端口：

- 不暴露

### 外部模型网关

职责：

- 提供 OpenAgents 运行时可直接访问的 OpenAI / Anthropic 兼容模型 API

说明：

- 不放进 `docker/docker-compose-prod.yaml`
- 由你自己的 1Panel / 其他 Compose / 其他面板继续托管
- 但要接入 `openagents-prod_openagents`，并在该网络上提供 `model-gateway` 别名
- 模型记录里的 `base_url` 统一写成 `http://model-gateway:3000`

如果你用的是 1Panel `new-api`，更推荐直接在它自己的 compose 里补共享网络，而不是让
OpenAgents 再起一层 host-network 代理。形态类似：

```yaml
networks:
  1panel-network:
    external: true
  openagents-runtime:
    external: true
    name: openagents-prod_openagents

services:
  new-api:
    networks:
      1panel-network: {}
      openagents-runtime:
        aliases:
          - model-gateway
```

### `sandbox-aio`

职责：

- 提供运行时文件/命令执行能力

对外端口：

- 不暴露

说明：

- 会直接使用根 `.env`
- 也会把 `.env` 挂进容器，方便你在容器内排查时看到同一份配置来源

### `onlyoffice`

职责：

- Office 文档预览与编辑

对外端口：

- 不单独暴露；由 nginx 反向代理 `/onlyoffice/`

## 目录与配置约定

正式环境机器上，建议直接使用仓库根目录下这些文件：

- `.env`
- `config.yaml`
- `backend/gateway/gateway.yaml`
- `.openagents/`

### `.env`

放 secrets：

- `DATABASE_URI`
- `JWT_SECRET`
- `ONLYOFFICE_JWT_SECRET`
- 第三方 API Key

### `config.yaml`

放 runtime 的非 secrets 配置：

- `runtime`
- `sandbox`
- `storage`
- `tools`
- `skills`

### `backend/gateway/gateway.yaml`

放 Gateway 非 secrets 配置：

- `server`
- `logging`
- `proxy`
- `onlyoffice`

其中 `onlyoffice.server_url` 要写成浏览器可访问的地址。
正式环境 compose 已通过环境变量固定覆盖成同源 `/onlyoffice`，一般不需要你再手工改：

```yaml
onlyoffice:
  server_url: /onlyoffice
```

而容器之间回调用的 `ONLYOFFICE_PUBLIC_APP_URL` 已经由 compose 固定注入为 `http://gateway:8001`，不需要你再手工写进 `gateway.yaml`。

### `.openagents/`

这是正式环境必须持久化的数据目录，里面包含：

- agents
- skills
- users
- threads
- knowledge
- runtime/langgraph

不要在发版时覆盖或删除这个目录。

## 启动前准备

### 1. 准备配置

在项目根目录准备好：

```bash
cp config.example.yaml config.yaml
```

然后确认：

- `.env` 已填写
- `config.yaml` 已填写
- `backend/gateway/gateway.yaml` 已填写

### 2. 准备持久目录

如果你没改默认值，Compose 会直接使用：

```text
../.openagents
```

也就是仓库根目录下的 `.openagents`。

如果你想把正式数据放到别的位置，直接修改 `docker/docker-compose-prod.yaml` 里的 `../.openagents` 挂载路径。
更推荐直接在启动命令前覆写：

```bash
OPENAGENTS_DOCKER_HOST_HOME=/srv/openagents docker compose -f docker-compose-prod.yaml up -d
```

### 3. 准备数据库

确认 `.env` 里的 `DATABASE_URI` 指向正式 PostgreSQL。

如果这是首次部署，或者 `migrations/` 下有新 SQL，请先人工执行这些 SQL。
不要通过 gateway 或 docker compose 自动执行结构变更。

## 首次启动

在仓库根目录执行：

```bash
cd docker
docker compose -f docker-compose-prod.yaml build
docker compose -f docker-compose-prod.yaml up -d
```

默认行为已经固定好：

- 用户前台走当前访问域名同源 `/api`
- 后台管理也走当前访问域名同源 `/api`
- 后台里生成的用户侧链接默认指向 `http(s)://当前主机名/`

启动后访问：

- 用户前台：`http://<host>/`
- 后台管理：`http://<host>:8081/`
- ONLYOFFICE 静态资源：`http://<host>/onlyoffice/`

## 运行中的修改方式

如果你直接修改：

- `.env`
- `config.yaml`
- `backend/gateway/gateway.yaml`
- `backend/gateway/**`
- `backend/agents/**`
- `backend/deepagents/**`

由于 prod compose 挂的是这几个服务自己的源码目录，所以重启对应容器即可让改动生效。

补充说明：

- 服务源码在 prod compose 里保持只读挂载，避免运行时把代码树写脏。
- `langgraph` 的 `.langgraph_api` 运行时文件不再写回源码目录，而是写到 `.openagents/runtime/langgraph/`。
- `gateway` / `langgraph` 日志继续通过 `docker compose logs` 查看，compose 已配置 Docker 日志轮转。

常见操作：

```bash
cd docker
docker compose -f docker-compose-prod.yaml restart gateway langgraph
```

如果你改了前端代码，则需要重新 build `nginx` 镜像，因为前端产物是在镜像构建阶段生成的。

## 日常发版流程

这套 compose 适合这样的发布方式：

### 1. 代码更新

```bash
git pull
```

### 2. 构建新镜像

```bash
cd docker
docker compose -f docker-compose-prod.yaml build nginx gateway langgraph sandbox-aio onlyoffice
```

### 3. 人工执行 SQL（如有）

如果本次发版涉及数据库结构变更，请在变更窗口手工执行 `migrations/*.sql`。
这一步不再由 gateway 或 compose 自动处理。

### 4. 重启到新版本

```bash
docker compose -f docker-compose-prod.yaml up -d --remove-orphans
```

## 最小更新策略

不是每次都要全量重建。

### 只改前端

```bash
cd docker
docker compose -f docker-compose-prod.yaml build nginx
docker compose -f docker-compose-prod.yaml up -d nginx
```

### 只改 Gateway

```bash
cd docker
docker compose -f docker-compose-prod.yaml build gateway
docker compose -f docker-compose-prod.yaml up -d gateway nginx
```

### 只改 LangGraph

```bash
cd docker
docker compose -f docker-compose-prod.yaml build langgraph
docker compose -f docker-compose-prod.yaml up -d langgraph gateway nginx
```

## 发布前建议备份

每次正式更新前，至少备份两类数据：

### 1. PostgreSQL

备份：

- `models`
- `users`
- `thread_bindings`
- knowledge-base 相关表
- 其他业务表

### 2. `.openagents`

备份整个目录：

```text
.openagents/
```

尤其要保留：

- `agents/`
- `skills/`
- `threads/`
- `knowledge/`

## 回滚方式

如果发布后出问题，优先按下面顺序回滚：

1. 回滚到上一版代码
2. 重新 build 对应镜像
3. 重新执行 `up -d`

如果问题涉及数据库迁移，再单独处理数据库回滚。

如果问题涉及 agent/skill/knowledge 运行时数据，再恢复 `.openagents` 备份。

## 适用范围说明

这份 `docker-compose-prod.yaml` 不是“完全不可变镜像”的企业标准发布模型。

它更准确的定位是：

- 正式环境可用
- 单机自托管
- 配置简单
- 能直接复用仓库里的本地配置
- 方便你后续自己维护和更新

如果你后面要继续升级，可以再往下演进成：

- 完全去掉源码挂载
- 单独产出 Gateway/LangGraph 的发布镜像 tag
- 用 CI/CD 自动 build / push / deploy
