# OpenAgents 生产使用

这份文档给使用者和运维人员看，只写生产使用、更新、迁移和排障。
本文不记录开发过程中的自测规则。

## 安装

一行安装：

```bash
curl -fsSL https://raw.githubusercontent.com/bytedance/openagents/main/scripts/install.sh | bash
```

已有 New API 容器：

```bash
curl -fsSL https://raw.githubusercontent.com/bytedance/openagents/main/scripts/install.sh | env MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F bash
```

已经 clone 源码：

```bash
./scripts/docker-deploy.sh
```

启动后访问：

```text
管理后台: http://127.0.0.1:8081
用户前台: http://127.0.0.1:8083
默认管理员: admin / admin123
New API 同步地址: http://model-gateway:3000
```

## 更新

普通更新：

```bash
./scripts/docker-deploy.sh
```

如果服务器源码也更新：

```bash
git pull
./scripts/docker-deploy.sh
```

## 发版

构建并推送应用镜像：

```bash
./scripts/docker-release.sh push --scope app --version 1.2.3
```

服务器部署指定版本：

```bash
./scripts/docker-release.sh deploy --scope app --version 1.2.3
```

scope：

```text
frontend  只发布 openagents-web
gateway   只发布 openagents-gateway
app       发布 web + gateway + langgraph
all       发布全栈镜像，包括 sandbox 和 ONLYOFFICE
```

生产环境建议固定版本号；`latest` 只适合个人自托管或临时使用。

## New API

生产 compose 使用固定 Docker 网络：

```text
openagents
```

部署脚本会自动尝试接入唯一的 New API 容器。识别不出来时手动指定：

```bash
MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F ./scripts/docker-deploy.sh
```

后台同步 New API 模型时填写：

```text
http://model-gateway:3000
```

不要填 `127.0.0.1` 或宿主机 IP。容器之间应走 Docker 网络里的服务名或 alias。

## 数据和迁移

首次空库初始化由 compose 内的 `migrate` 服务完成。

默认管理员：

```text
account: admin
password: admin123
```

新增 SQL 只追加新文件：

```text
migrations/NNN_name.up.sql
```

不要改已经在生产库执行过的迁移文件。迁移记录写在
`openagents_schema_migrations`，checksum 不一致会失败。

手动跑迁移：

```bash
cd deploy
docker compose run --rm migrate
```

迁移机器或备份时至少保留：

```text
deploy/.env
deploy/config.yaml
deploy/gateway.yaml
deploy/data/
```

## 配置

生产只改这些文件：

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

## 排障

查看状态：

```bash
cd deploy
docker compose ps
```

看日志：

```bash
cd deploy
docker compose logs -f
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8083/health
curl -fsS http://127.0.0.1:8081/
```

确认 New API DNS：

```bash
cd deploy
docker compose exec langgraph getent hosts model-gateway
```
