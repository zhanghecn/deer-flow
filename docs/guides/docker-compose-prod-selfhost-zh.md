# OpenAgents Docker 开发与发版流程

这是当前唯一的 Docker 操作文档。正式环境不要再把 `.env`、配置或数据写到 `docker/`，也不要直接用 `docker/docker-compose-prod.yaml` 起服务。

## 速查

开发环境：

```bash
make dev
make stop
make docker-status
make docker-verify
make docker-logs
```

首次正式部署或全新测试环境：

```bash
./scripts/docker-deploy.sh --start
```

后续发版：

```bash
./scripts/docker-release.sh push
./scripts/docker-release.sh deploy
```

指定版本或服务：

```bash
./scripts/docker-release.sh push --tag v0.1.0
./scripts/docker-release.sh deploy --tag v0.1.0
./scripts/docker-release.sh push --service gateway
./scripts/docker-release.sh deploy --service gateway
```

默认镜像仓库是 `zhangxuan2/openagents`，默认 tag 是 `latest`。实际镜像 tag 形如 `gateway-latest`、`nginx-v0.1.0`。

## 目录

源码目录：

- `docker/docker-compose.yaml`：开发环境 compose，给 `make dev` 使用。
- `docker/docker-compose-prod.yaml`：正式环境 compose 模板，只给部署脚本复制。

生成部署目录：

- `deploy/docker-compose.yml`：实际正式部署 compose。
- `deploy/.env`：正式环境 secrets。
- `deploy/config.yaml`、`deploy/gateway.yaml`：正式环境配置副本。
- `deploy/data/openagents`：runtime、commands、system、threads 等文件数据。
- `deploy/data/postgres`：PostgreSQL 数据。
- `deploy/data/minio`：MinIO 对象数据。

`deploy/.env`、`deploy/docker-compose.yml`、`deploy/config.yaml`、`deploy/gateway.yaml`、`deploy/data/` 都被 git ignore。迁移机器时保留 `deploy/.env` 和整个 `deploy/data/`。

## 开发环境

日常开发只用 `make dev`。它会挂载源码，并默认把 runtime 和依赖缓存放在：

```text
deploy/data/openagents
```

本地入口：

- 用户前台：`http://127.0.0.1:8083`
- 管理后台：`http://127.0.0.1:8081`
- demo：`http://127.0.0.1:8084`
- gateway：`http://127.0.0.1:8001`
- langgraph：`http://127.0.0.1:2024`
- sandbox：`http://127.0.0.1:18080`
- onlyoffice：`http://127.0.0.1:8082`

## 首次正式部署

新机器只执行：

```bash
./scripts/docker-deploy.sh --start
```

脚本会生成 `deploy/` 配置和数据目录，先启动 PostgreSQL，空库时自动执行：

```text
migrations/001_init.up.sql
migrations/002_seed_data.up.sql
```

然后再启动完整正式栈。不要在首次部署时直接 `cd deploy && docker compose up -d`，因为空库会让 gateway 在 SQL baseline 之前失败。

## 后续发版

后续发版不要再跑 `docker-deploy.sh --start`，除非你删除了 `deploy/` 或明确要重建全新环境。

如果只发布新镜像：

```bash
./scripts/docker-release.sh push
./scripts/docker-release.sh deploy
```

如果这次发版也改了脚本、compose 模板或文档，服务器先更新代码：

```bash
git pull
./scripts/docker-release.sh deploy
```

推到其他仓库：

```bash
./scripts/docker-release.sh push --repository <namespace>/openagents --tag v0.1.0
```

## 配置和数据

修改正式配置：

```text
deploy/.env
deploy/config.yaml
deploy/gateway.yaml
```

配置变更后按影响范围重启：

```bash
cd deploy
docker compose -f docker-compose.yml restart gateway langgraph
```

如果要自定义数据目录，优先改 `deploy/.env`：

```text
OPENAGENTS_DOCKER_HOST_HOME=/srv/openagents/runtime
OPENAGENTS_POSTGRES_DATA_DIR=/srv/openagents/postgres
OPENAGENTS_MINIO_DATA_DIR=/srv/openagents/minio
```

不要直接改 `deploy/docker-compose.yml`；它下次运行 `docker-deploy.sh` 会被模板覆盖。

## SQL 迁移

首次空库 baseline 由 `docker-deploy.sh --start` 自动执行。

后续发版如果新增 SQL 文件，必须先人工审阅，再在变更窗口手工执行。不要让 gateway 或 compose 在已有正式库上自动跑非 baseline 迁移。

从仓库根目录执行 SQL：

```bash
docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < migrations/<file>.sql
```

如果已经 `cd deploy`，路径才写成 `../migrations/<file>.sql`。

## 正式环境运维

查看最终 compose：

```bash
./scripts/docker-release.sh config
```

查看状态和日志：

```bash
cd deploy
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs -f
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
docker compose -f docker-compose.yml down
```

清空测试环境：

```bash
cd deploy
docker compose -f docker-compose.yml down -v --remove-orphans
cd ..
rm -rf deploy/.env deploy/config.yaml deploy/gateway.yaml deploy/docker-compose.yml deploy/data
```

这会删除 PostgreSQL、MinIO 和 OpenAgents runtime 数据，只适合测试环境或明确要重建的机器。

## 外部模型网关

外部模型网关不放进 OpenAgents 正式 compose。把已有网关容器接入 OpenAgents 网络：

```bash
make docker-model-gateway-attach MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F MODEL_GATEWAY_NETWORK=openagents-prod_openagents
```

模型记录里的 `base_url` 使用：

```text
http://model-gateway:3000
```

`openagents-prod_openagents` 是脚本管理的 external network。这样服务器上如果已经有同名网络，Compose 会直接复用它，不会因为旧 compose label 不一致而启动失败。

## 备份和回滚

发版前至少备份：

```text
deploy/.env
deploy/data/
```

回滚镜像：

```bash
./scripts/docker-release.sh deploy --tag <previous-tag>
```

如果发版涉及数据库结构变更，数据库回滚要单独处理，不能只靠镜像回滚。

## 废弃做法

- 不把正式 `.env`、`config.yaml`、`gateway.yaml` 写到 `docker/`。
- 不把默认持久化数据写到 `docker/data`。
- 不直接用 `docker/docker-compose-prod.yaml` 启动正式环境。
- 不要求日常发版手动 `export OPENAGENTS_IMAGE_NAMESPACE` 或 `OPENAGENTS_IMAGE_TAG`。
- 不把首次空库 SQL 作为必须手工执行的步骤；使用 `./scripts/docker-deploy.sh --start`。
