# OpenAgents Docker 部署与发版流程

这份文档是 Docker 部署的主入口。生产环境以 `deploy/` 为准：

- `deploy/docker-compose.yml`：正式 compose，提交到仓库。
- `deploy/.env.example`：正式环境变量模板，提交到仓库。
- `deploy/.env`：本机 secrets，由脚本生成，不提交。
- `deploy/config.yaml`、`deploy/gateway.yaml`：本机配置副本，由脚本生成，不提交。
- `deploy/migrations/`：从根目录 `migrations/` 同步出来的发布 SQL，不提交。
- `deploy/data/`：PostgreSQL、MinIO、OpenAgents runtime 数据，不提交。

`docker/` 只保留 Dockerfile 和本地开发 compose；不要再用
`docker/docker-compose-prod.yaml`，这个生产模板已经删除。

## 一行部署

开源用户不需要理解内部脚本、网络和迁移细节，直接执行：

```bash
curl -fsSL https://raw.githubusercontent.com/bytedance/openagents/main/scripts/install.sh | bash
```

如果已经有 New API 容器，也仍然是一行：

```bash
curl -fsSL https://raw.githubusercontent.com/bytedance/openagents/main/scripts/install.sh | env MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F bash
```

如果用户已经 clone 了源码，在仓库根目录执行：

```bash
./scripts/docker-deploy.sh
```

脚本默认会生成 secrets、同步配置和 SQL、创建 `openagents` 网络、尝试自动识别
New API 容器、启动生产栈。启动后访问：

```text
管理后台: http://127.0.0.1:8081
用户前台: http://127.0.0.1:8083
默认管理员: admin / admin123
New API 同步地址: http://model-gateway:3000
```

下面内容只给维护者和需要排障的用户看。

## 常用命令

首次部署：

```bash
./scripts/docker-deploy.sh
```

后续升级：

```bash
./scripts/docker-deploy.sh
```

按影响范围构建、推送、部署镜像：

```bash
./scripts/docker-release.sh push --scope app --version 1.2.3
./scripts/docker-release.sh deploy --scope app --version 1.2.3
```

## 网络

生产 compose 只使用一个固定 Docker 网络：

```text
openagents
```

`deploy/docker-compose.yml` 把这个网络声明为 external。这样做是为了让已有的
New API 容器也能挂到同一个网络，并提供稳定 DNS。`scripts/docker-deploy.sh`
会在只有一个明显 New API 容器时自动接入；识别不出来时再手动指定：

```bash
MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F ./scripts/docker-deploy.sh
```

或者直接用 Docker：

```bash
docker network create openagents 2>/dev/null || true
docker network connect --alias model-gateway openagents 1Panel-new-api-6d1F
```

管理后台同步 New API 模型时，地址写：

```text
http://model-gateway:3000
```

浏览器能访问宿主机端口，不代表容器能用同一个宿主机 IP 访问。容器间访问应优先走
同一个 Docker bridge 网络上的服务名或 network alias。这里的 `model-gateway` 就是
给已有 New API 容器定义的别名。

## 镜像版本

发布只需要记一个版本号：

```text
OPENAGENTS_VERSION=1.2.3
```

默认前缀：

```text
OPENAGENTS_IMAGE_REGISTRY=docker.io
OPENAGENTS_IMAGE_PREFIX=zhangxuan2/openagents
```

最终镜像形如：

```text
docker.io/zhangxuan2/openagents-web:1.2.3
docker.io/zhangxuan2/openagents-gateway:1.2.3
docker.io/zhangxuan2/openagents-langgraph:1.2.3
```

`latest` 适合个人自托管；生产环境建议固定 `OPENAGENTS_VERSION`。CI/tag 发布时应由
Git tag 生成版本号，操作者不需要记 `gateway-v0.1.0` 这种服务前缀 tag。

## 首次部署

从仓库根目录执行：

```bash
./scripts/docker-deploy.sh
```

脚本会做这些事：

- 生成或保留 `deploy/.env`。
- 复制 `config.yaml` 和 `backend/gateway/gateway.yaml` 到 `deploy/`。
- 同步 `.openagents/commands` 和 `.openagents/system` 到 `deploy/data/openagents`。
- 同步根目录 `migrations/*.up.sql` 和 `migrations/run.sh` 到 `deploy/migrations`。
- 创建固定网络 `openagents`。
- 如果传入 `MODEL_GATEWAY_CONTAINER`，或脚本只发现一个 New API 容器，把它接入 `openagents` 并设置 `model-gateway` alias。
- 启动 `deploy/docker-compose.yml`。

首次空库初始化由 compose 内的 `migrate` 服务完成。`gateway` 和 `langgraph` 都等待
`migrate` 成功后才启动。

## 后续升级

如果只是使用已经发布的镜像，仍然执行同一个入口：

```bash
./scripts/docker-deploy.sh
```

如果服务器上也更新了仓库代码，先同步部署资产：

```bash
git pull
./scripts/docker-deploy.sh
```

如果用仓库脚本构建和发布镜像：

```bash
./scripts/docker-release.sh push --scope gateway --version 1.2.3
./scripts/docker-release.sh deploy --scope gateway --version 1.2.3
```

scope 约定：

- `frontend`：只发布 `openagents-web`，对应用户前台、管理后台和 nginx 配置。
- `gateway`：只发布 `openagents-gateway`。
- `app`：发布 `openagents-web`、`openagents-gateway`、`openagents-langgraph`。
- `all`：发布并 reconcile 全栈镜像，包括 sandbox、ONLYOFFICE。

`deploy` 命令会在需要时先运行 idempotent 的 `migrate` 服务，再用 `--no-deps`
重启非全栈 scope，避免普通应用发布误动 PostgreSQL、MinIO 等依赖。

## SQL 初始化与迁移

根目录 `migrations/` 是 SQL 的代码审阅来源：

- `001_init.up.sql`：空库结构 baseline。
- `002_seed_data.up.sql`：确定性启动数据，目前只包含默认管理员。
- `run.sh`：compose `migrate` 服务使用的迁移 runner。

默认管理员：

```text
account: admin
password: admin123
```

后续新增 SQL 时追加 `NNN_name.up.sql`，不要改已经在生产库执行过的文件。
`migrate` 服务会把版本和 checksum 写入 `openagents_schema_migrations`，如果已执行文件
内容发生变化会直接失败，避免静默漂移。

手工验证迁移：

```bash
cd deploy
docker compose run --rm migrate
```

## 配置和数据

生产环境只改这些文件：

```text
deploy/.env
deploy/config.yaml
deploy/gateway.yaml
```

常用端口：

```text
OPENAGENTS_APP_PORT=8083
OPENAGENTS_ADMIN_PORT=8081
OPENAGENTS_POSTGRES_PORT=15432
OPENAGENTS_ONLYOFFICE_PORT=8082
OPENAGENTS_SANDBOX_PORT=18080
```

持久化目录：

```text
OPENAGENTS_DOCKER_HOST_HOME=./data/openagents
OPENAGENTS_POSTGRES_DATA_DIR=./data/postgres
OPENAGENTS_MINIO_DATA_DIR=./data/minio
```

迁移机器时至少保留：

```text
deploy/.env
deploy/config.yaml
deploy/gateway.yaml
deploy/data/
```

## 运维命令

查看最终 compose：

```bash
./scripts/docker-release.sh config
```

查看状态和日志：

```bash
cd deploy
docker compose ps
docker compose logs -f
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8083/health
curl -fsS http://127.0.0.1:8083/
curl -fsS http://127.0.0.1:8081/
```

停止但保留数据：

```bash
cd deploy
docker compose down
```

测试环境清空：

```bash
cd deploy
docker compose down -v --remove-orphans
cd ..
rm -rf deploy/.env deploy/config.yaml deploy/gateway.yaml deploy/migrations deploy/data
```

## 本地开发

开发环境仍然使用：

```bash
make dev
make docker-verify
make stop
```

开发 compose 的默认网络是 `openagents_default`，生产网络是 `openagents`。这不是两套
New API 网关；同一个 New API 容器可以按需同时接入两个网络并使用同一个
`model-gateway` alias。
