# OpenAgents 生产使用

这份文档给使用者和运维人员看，只写生产使用、更新、迁移和排障。
本文不记录开发过程中的自测规则。

## 安装

一行安装：

```bash
curl -fsSL https://raw.githubusercontent.com/bytedance/openagents/main/scripts/install.sh | bash
```

已有外部模型网关容器，并希望部署脚本显式帮你接入 OpenAgents 网络：

```bash
curl -fsSL https://raw.githubusercontent.com/bytedance/openagents/main/scripts/install.sh | env MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F bash
```

已经 clone 源码：

```bash
./scripts/docker-deploy.sh
```

这条命令既用于第一次初始化，也用于后续生产更新。它不负责发镜像；发镜像使用
`./scripts/docker-release.sh push --scope ...` 或推送 `v*` tag 触发 GitHub Actions。

启动后访问：

```text
管理后台: http://127.0.0.1:8081
用户前台: http://127.0.0.1:8083
默认管理员: admin / admin123
模型网关同步地址: http://model-gateway:3000
```

## 更新

普通更新：

```bash
./scripts/docker-deploy.sh
```

这和首次安装是同一条命令：已有 `deploy/.env` 时会保留生产密钥，只刷新部署资产、
拉取配置中的镜像、执行新增 SQL，并重启服务。

普通更新默认只主动拉取 OpenAgents 运行镜像，不主动升级 Postgres/MinIO 这类有状态
基础服务镜像。首次安装缺镜像时 compose 仍会自动拉取。需要显式升级基础服务镜像时再运行：

```bash
OPENAGENTS_PULL_INFRA_IMAGES=1 ./scripts/docker-deploy.sh
```

当前生产 compose 不包含 Redis。

如果服务器是源码部署，先更新源码再部署：

```bash
git pull
./scripts/docker-deploy.sh
```

这条命令会刷新部署目录、拉取 `latest` 镜像、执行 SQL，然后重启服务。

## 发版

正式发版对齐 Sub2API：推送 `v*` git tag 后由 GitHub Actions 构建镜像，
同时发布不可变版本 tag 和 `latest`。配置了 DockerHub secrets 时会发布到
`deploy/.env` 默认使用的 DockerHub 仓库，同时也会发布 GHCR 备份镜像。
如果 DockerHub 命名空间不是 `<DOCKERHUB_USERNAME>/openagents`，只需要在
仓库变量里配置一次 `DOCKERHUB_IMAGE_PREFIX`。

创建版本号：

```bash
git tag v1.2.3
git push origin v1.2.3
```

GitHub Actions 会把 `v1.2.3` 转成镜像 tag `1.2.3`，并同时刷新 `latest`。
服务器日常更新不需要填写 `1.2.3`，继续运行：

```bash
./scripts/docker-deploy.sh
```

需要在本机手动发镜像时，第一次发布到一个新的镜像仓库先推完整栈：

```bash
./scripts/docker-release.sh push --scope all
```

后续只改应用代码时，推应用镜像：

```bash
./scripts/docker-release.sh push --scope app
```

scope：

```text
frontend  只发布 openagents-web
gateway   只发布 openagents-gateway
app       发布 web + gateway + langgraph
all       发布全栈镜像，包括 sandbox 和 ONLYOFFICE
```

本机手动 `push` 时，版本号由脚本从当前 `v*` git tag 自动生成。当前 commit
没有 tag 会直接报错；先创建版本 tag 再发镜像：

```bash
git tag v1.2.3
./scripts/docker-release.sh push --scope all
```

注意：tag 必须精确打在当前要发布的 commit 上。`git ls-remote --tags origin`
只能说明远程仓库有某个 tag；如果这个 tag 指向旧 commit，当前新代码仍然不能发布。
检查当前 commit 上有没有 tag：

```bash
git tag --points-at HEAD
```

镜像会发布 `1.2.3` 并同时刷新 `latest`。用户不需要在命令里手写或记忆镜像版本号；
服务器更新仍然使用：

```bash
./scripts/docker-deploy.sh
```

镜像仓库信息只在 `deploy/.env` 里配置，不要在日常命令里反复传参数。

`./scripts/docker-deploy.sh` 不会构建镜像，也不会在拉取失败后继续使用旧本地镜像。
如果镜像不存在或 DockerHub/代理拉取失败，部署会直接报错。先发布镜像：

```bash
./scripts/docker-release.sh push --scope app
```

然后再部署：

```bash
./scripts/docker-deploy.sh
```

## 模型网关 / New API

生产 compose 使用固定 Docker 网络 `openagents`。OpenAgents 不内置 New API，也不会
默认启动第二套模型网关；把你已有的 New API / One API / LiteLLM 等容器加入这个网络即可。

推荐在 1Panel 面板里操作：

```text
把模型网关容器加入 openagents 网络
```

如果面板支持 alias，给它加 `model-gateway`，后台同步模型时填写：

```text
http://model-gateway:3000
```

如果面板只能加入网络、不能设置 alias，先用面板里的容器名：

```text
http://1Panel-new-api-6d1F:3000
```

容器名重建后可能变化，长期生产建议固定 alias。也可以让部署脚本显式接入一次：

```bash
MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F ./scripts/docker-deploy.sh
```

部署脚本不会自动猜哪个容器是模型网关，也不会默认修改外部模型网关网络。只有你明确
设置 `MODEL_GATEWAY_CONTAINER` 时才会操作该容器。默认 alias 只有 `model-gateway`；
如果确认需要 `new-api` 这个别名，显式写：

```bash
MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F MODEL_GATEWAY_ALIASES=model-gateway,new-api ./scripts/docker-deploy.sh
```

也可以把配置写进 `deploy/.env`：

```dotenv
MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F
MODEL_GATEWAY_ALIASES=model-gateway
```

不要填 `127.0.0.1` 或宿主机 IP。容器之间应走 Docker 网络里的服务名或 alias。

### 模型网关网络排查

看网络里的容器和 IP：

```bash
docker network inspect openagents --format '{{range $id,$c := .Containers}}{{println $c.Name $c.IPv4Address}}{{end}}'
```

看每个容器在 `openagents` 里的 alias：

```bash
docker network inspect openagents -f '{{range $id,$_ := .Containers}}{{println $id}}{{end}}' \
| xargs -r docker inspect -f '{{.Name}} {{range $name,$net := .NetworkSettings.Networks}}{{if eq $name "openagents"}}aliases={{$net.Aliases}} ip={{$net.IPAddress}}{{end}}{{end}}' \
| sed 's#^/##'
```

从 OpenAgents 容器里验证：

```bash
docker exec openagents-gateway-1 getent hosts model-gateway
docker exec openagents-gateway-1 curl -sS -o /dev/null -w '%{http_code}\n' http://model-gateway:3000/
```

没有 alias 时先验证容器名：

```bash
docker exec openagents-gateway-1 getent hosts 1Panel-new-api-6d1F
docker exec openagents-gateway-1 curl -sS -o /dev/null -w '%{http_code}\n' http://1Panel-new-api-6d1F:3000/
```

手动重接 alias：

```bash
docker network disconnect openagents 1Panel-new-api-6d1F || true
docker network connect --alias model-gateway openagents 1Panel-new-api-6d1F
```

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

当前初始基线只保留两个文件：

```text
migrations/001_init.up.sql
migrations/002_data.up.sql
```

正式发版后不要改已经在生产库执行过的 SQL 文件。迁移记录写在
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

文件日志：

```bash
ls -lah deploy/data/logs
tail -f deploy/data/logs/gateway.log
tail -f deploy/data/logs/langgraph.log
```

OpenAgents 对齐 Sub2API 的生产习惯：应用服务会把持久日志写到
`deploy/data/logs/`。`gateway` 和 `langgraph` 默认按 100MB 单文件、10 个历史
文件轮转；`nginx` 访问日志和错误日志走 Docker 日志轮转，避免额外文件无限增长。

实时容器日志：

```bash
./scripts/docker-logs.sh
./scripts/docker-logs.sh gateway
./scripts/docker-logs.sh langgraph --tail 500
./scripts/docker-logs.sh migrate --no-follow
```

Docker compose 日志仍然保留，用于看容器启动、健康检查和基础服务输出。
`deploy/docker-compose.yml` 也配置了 Docker `json-file` 日志驱动轮转，避免
Docker 自己的日志无限增长。

健康检查：

```bash
curl -fsS http://127.0.0.1:8083/health
curl -fsS http://127.0.0.1:8081/
```

确认模型网关 DNS：

```bash
cd deploy
docker compose exec langgraph getent hosts model-gateway
```

DockerHub push 超时：

```bash
docker info | grep -A3 'Proxy'
curl -I https://registry-1.docker.io/v2/
```

`docker push` 走 Docker daemon 的代理配置，不只看当前 shell 的
`HTTP_PROXY`。如果 `docker info` 里没有 `HTTP Proxy` / `HTTPS Proxy`，
需要配置 Docker daemon 代理后重启 Docker。偶发 `TLS handshake timeout`
通常是 DockerHub 或代理链路抖动，`scripts/docker-release.sh push` 会自动
重试 3 次；需要调整时设置 `OPENAGENTS_PUSH_RETRIES=5`。
