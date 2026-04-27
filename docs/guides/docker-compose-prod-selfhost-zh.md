# OpenAgents Docker 开发与发版流程

这是当前唯一的 Docker 操作文档。旧流程里直接在 `docker/` 目录生成 `.env`、配置和数据，或者直接用 `docker/docker-compose-prod.yaml` 起正式环境的说明，都不再是推荐路径。

## 目录职责

- `docker/docker-compose.yaml`：开发环境 compose，源码读写挂载，给 `make dev` / `make docker-start` 使用。
- `docker/docker-compose-prod.yaml`：正式环境 compose 模板，只作为 `scripts/docker-deploy.sh` 的生成源。
- `deploy/docker-compose.yml`：实际正式部署 compose，由脚本从模板复制生成。
- `deploy/.env`：正式部署 secrets，由脚本生成，默认 PostgreSQL 和 MinIO 用户名都是 `openagents`。
- `deploy/config.yaml`、`deploy/gateway.yaml`：正式部署配置副本。
- `deploy/data/openagents`：OpenAgents runtime、commands、system、threads 等可迁移数据。
- `deploy/data/postgres`：PostgreSQL 数据目录。
- `deploy/data/minio`：MinIO 对象存储数据目录。

`deploy/.env`、`deploy/docker-compose.yml`、`deploy/config.yaml`、`deploy/gateway.yaml`、`deploy/data/` 都被 git ignore。迁移机器时迁移整个 `deploy/` 目录即可，至少要保留 `deploy/.env` 和 `deploy/data/`。

## 开发环境

日常开发只用：

```bash
make dev
```

等价入口：

```bash
make docker-start
```

停止：

```bash
make stop
```

查看状态、健康检查和日志：

```bash
make docker-status
make docker-verify
make docker-logs
```

开发 compose 会挂载源码，并默认把 runtime 和依赖缓存放在：

```text
deploy/data/openagents
```

这样开发环境和正式测试环境共享同一套可迁移数据根目录。不要再使用旧的 `docker/data` 作为默认数据目录。

开发入口：

- 用户前台：`http://127.0.0.1:8083`
- 管理后台：`http://127.0.0.1:8081`
- demo：`http://127.0.0.1:8084`
- gateway：`http://127.0.0.1:8001`
- langgraph：`http://127.0.0.1:2024`
- sandbox：`http://127.0.0.1:18080`
- onlyoffice：`http://127.0.0.1:8082`

## 首次正式部署

新机器或全新测试环境只执行：

```bash
./scripts/docker-deploy.sh --start
```

这个命令会完成全部首次部署动作：

1. 生成 `deploy/docker-compose.yml`。
2. 生成 `deploy/.env`，写入 PostgreSQL、MinIO、JWT 等 secrets。
3. 复制 `config.yaml` 到 `deploy/config.yaml`。
4. 复制 `backend/gateway/gateway.yaml` 到 `deploy/gateway.yaml`。
5. 创建 `deploy/data/openagents`、`deploy/data/postgres`、`deploy/data/minio`。
6. 同步 `.openagents/commands` 和 `.openagents/system` 到 `deploy/data/openagents`。
7. 先启动 PostgreSQL。
8. 如果数据库是空库，自动执行：

```bash
migrations/001_init.up.sql
migrations/002_seed_data.up.sql
```

9. 启动完整正式环境。

不要在首次部署时直接 `cd deploy && docker compose up -d`，因为空库时 gateway 会在 SQL baseline 之前启动失败。

## 后续发版

后续发版不再运行 `docker-deploy.sh --start`，除非你删除了 `deploy/` 或要重建一套全新环境。

本机构建并推送默认 `latest` 镜像：

```bash
./scripts/docker-release.sh push
```

服务器拉取并重启到新镜像：

```bash
./scripts/docker-release.sh deploy
```

如果这次发版也改了脚本、compose 模板或部署文档，服务器先更新代码：

```bash
git pull
./scripts/docker-release.sh deploy
```

如果你在同一台机器上构建、推送、部署，完整流程就是：

```bash
./scripts/docker-release.sh push
./scripts/docker-release.sh deploy
```

发指定版本：

```bash
./scripts/docker-release.sh push --tag v0.1.0
./scripts/docker-release.sh deploy --tag v0.1.0
```

只发某个服务：

```bash
./scripts/docker-release.sh push --service gateway
./scripts/docker-release.sh deploy --service gateway
```

默认镜像仓库和 tag：

```text
repository: zhangxuan2/openagents
tag: latest
```

实际 service tag 形如：

```text
zhangxuan2/openagents:nginx-latest
zhangxuan2/openagents:gateway-latest
zhangxuan2/openagents:langgraph-latest
zhangxuan2/openagents:sandbox-aio-latest
zhangxuan2/openagents:onlyoffice-latest
zhangxuan2/openagents:openpencil-latest
```

需要推到其他仓库时：

```bash
./scripts/docker-release.sh push --repository <namespace>/openagents --tag v0.1.0
```

## 数据和配置更新

正式环境配置文件：

```text
deploy/.env
deploy/config.yaml
deploy/gateway.yaml
```

修改这些文件后，按影响范围重启服务：

```bash
cd deploy
docker compose -f docker-compose.yml restart gateway langgraph
```

如果只是改端口、镜像 tag 或数据目录，优先改 `deploy/.env`，不要直接改生成出来的 `deploy/docker-compose.yml`。`deploy/docker-compose.yml` 下次运行 `docker-deploy.sh` 会被模板覆盖。

如果确实要把数据放到别的位置，可以在 `deploy/.env` 里改：

```text
OPENAGENTS_DOCKER_HOST_HOME=/srv/openagents/runtime
OPENAGENTS_POSTGRES_DATA_DIR=/srv/openagents/postgres
OPENAGENTS_MINIO_DATA_DIR=/srv/openagents/minio
```

默认情况下不需要改这些变量。

## SQL 迁移规则

首次空库 baseline 由 `docker-deploy.sh --start` 自动执行。

后续发版如果新增 SQL 文件，必须先人工审阅，再在变更窗口手工执行。不要让 gateway 或 compose 在已有正式库上自动跑非 baseline 迁移。

从仓库根目录执行 SQL 的路径示例：

```bash
docker exec -i openagents-prod-postgres-1 psql -U openagents -d openagents -v ON_ERROR_STOP=1 < migrations/001_init.up.sql
```

如果你已经 `cd deploy`，路径才需要写成 `../migrations/...`。

## 常用正式环境命令

查看最终 compose：

```bash
./scripts/docker-release.sh config
```

查看服务状态：

```bash
cd deploy
docker compose -f docker-compose.yml ps
```

查看日志：

```bash
cd deploy
docker compose -f docker-compose.yml logs -f
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8083/health
curl -fsS http://127.0.0.1:8083/
curl -fsS http://127.0.0.1:8081/
```

停止正式环境但保留数据：

```bash
cd deploy
docker compose -f docker-compose.yml down
```

删除全新测试环境数据：

```bash
cd deploy
docker compose -f docker-compose.yml down -v --remove-orphans
cd ..
rm -rf deploy/.env deploy/config.yaml deploy/gateway.yaml deploy/docker-compose.yml deploy/data
```

这会删除 PostgreSQL、MinIO 和 OpenAgents runtime 数据，只适合测试环境或你明确要重建的机器。

## 外部模型网关

外部模型网关不放进 OpenAgents 正式 compose。推荐把现有网关容器接入 OpenAgents 网络，并提供 `model-gateway` 别名：

```bash
make docker-model-gateway-attach MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F MODEL_GATEWAY_NETWORK=openagents-prod_openagents
```

模型记录里的 `base_url` 使用：

```text
http://model-gateway:3000
```

## 备份和回滚

发版前至少备份：

```text
deploy/.env
deploy/data/
```

其中：

- `deploy/data/postgres` 保存结构化数据。
- `deploy/data/minio` 保存知识库对象。
- `deploy/data/openagents` 保存 runtime、threads、commands、system 等文件。

回滚镜像：

```bash
./scripts/docker-release.sh deploy --tag <previous-tag>
```

如果发版涉及数据库结构变更，数据库回滚要单独处理，不能只靠镜像回滚。

## 不再使用的旧路径

以下做法已经废弃：

- 不再把正式 `.env`、`config.yaml`、`gateway.yaml` 写到 `docker/`。
- 不再把默认持久化数据写到 `docker/data`。
- 不再直接使用 `docker/docker-compose-prod.yaml` 启动正式环境。
- 不再要求日常发版手动 `export OPENAGENTS_IMAGE_NAMESPACE` 或 `OPENAGENTS_IMAGE_TAG`。
- 不再把首次空库 SQL 作为必须手工执行的步骤；使用 `./scripts/docker-deploy.sh --start`。
