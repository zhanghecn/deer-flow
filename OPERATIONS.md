# OpenAgents 操作手册

这是一份唯一操作入口。部署、测试、更新、发镜像、迁移和常用排障都放在这里。

如果你只是想把系统跑起来，看“最快路径”。如果你是维护者，看后面的“测试”和“发版”。

## 最快路径

开源用户自托管：

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

## 目录边界

```text
OPERATIONS.md              操作手册，部署/测试/发版都看这里
deploy/docker-compose.yml  生产 compose
deploy/.env.example        生产环境变量模板
deploy/.env                本机 secrets，脚本生成，不提交
deploy/config.yaml         生产配置副本，脚本生成，不提交
deploy/gateway.yaml        生产网关配置副本，脚本生成，不提交
deploy/migrations/         发布 SQL 副本，脚本同步，不提交
deploy/data/               PostgreSQL、MinIO、runtime 数据，不提交
docker/docker-compose.yaml 本地开发 compose，不是生产入口
scripts/install.sh         一行自托管安装入口
scripts/docker-deploy.sh   生产部署/升级入口
scripts/docker-release.sh  镜像构建/推送/发布入口
scripts/docker.sh          本地开发 Docker 辅助脚本
```

## 测试

生产或自托管真实验证：

```bash
./scripts/docker-deploy.sh
```

然后验证：

```bash
curl -fsS http://127.0.0.1:8083/health
curl -fsS http://127.0.0.1:8081/
```

浏览器真实测试：

```text
用户前台: http://127.0.0.1:8083
管理后台: http://127.0.0.1:8081
```

干净测试，清空所有生产数据：

```bash
cd deploy
docker compose down -v --remove-orphans
cd ..
rm -rf deploy/.env deploy/config.yaml deploy/gateway.yaml deploy/migrations deploy/data
./scripts/docker-deploy.sh
```

只有在测试本地源码挂载开发栈时，才使用：

```bash
make dev
make docker-verify
make stop
```

知识库、agent UX、`/v1/turns` 等专项真实测试要求仍记录在 `docs/testing/README.md`。

## 部署和升级

首次部署、后续升级、服务器源码更新后部署，都是同一个入口：

```bash
./scripts/docker-deploy.sh
```

这个脚本会：

- 生成或保留 `deploy/.env`
- 复制 `config.yaml` 和 `backend/gateway/gateway.yaml` 到 `deploy/`
- 同步 `.openagents/commands` 和 `.openagents/system` 到 `deploy/data/openagents`
- 同步根目录 `migrations/*.up.sql` 和 `migrations/run.sh` 到 `deploy/migrations`
- 创建固定 Docker 网络 `openagents`
- 自动或按 `MODEL_GATEWAY_CONTAINER` 接入已有 New API 容器
- 拉取镜像并启动 `deploy/docker-compose.yml`

如果服务器上也更新了仓库代码：

```bash
git pull
./scripts/docker-deploy.sh
```

停止但保留数据：

```bash
cd deploy
docker compose down
```

## 发镜像和发版

发布只需要一个版本号：

```text
OPENAGENTS_VERSION=1.2.3
```

构建并推送应用镜像：

```bash
./scripts/docker-release.sh push --scope app --version 1.2.3
```

在服务器部署这个版本：

```bash
./scripts/docker-release.sh deploy --scope app --version 1.2.3
```

scope 约定：

```text
frontend  只发布 openagents-web
gateway   只发布 openagents-gateway
app       发布 web + gateway + langgraph
all       发布全栈镜像，包括 sandbox 和 ONLYOFFICE
```

镜像命名：

```text
docker.io/zhangxuan2/openagents-web:1.2.3
docker.io/zhangxuan2/openagents-gateway:1.2.3
docker.io/zhangxuan2/openagents-langgraph:1.2.3
```

生产环境建议固定版本号；`latest` 只适合个人自托管或临时测试。

## New API

生产 compose 使用固定 Docker 网络：

```text
openagents
```

`scripts/docker-deploy.sh` 会在只发现一个明显 New API 容器时自动接入。识别不出来时手动指定：

```bash
MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F ./scripts/docker-deploy.sh
```

管理后台同步 New API 模型时填写：

```text
http://model-gateway:3000
```

不要在容器里填 `127.0.0.1` 或宿主机 IP。浏览器能访问宿主机端口，不代表容器之间能用同样地址访问。

## SQL 和数据

首次空库初始化由 compose 内的 `migrate` 服务完成。`gateway` 和 `langgraph` 都等待迁移成功后启动。

默认管理员：

```text
account: admin
password: admin123
```

新增 SQL 时只追加新文件：

```text
migrations/NNN_name.up.sql
```

不要改已经在生产库执行过的迁移文件。迁移记录写入 `openagents_schema_migrations`，checksum 不一致会失败。

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

查看最终 compose：

```bash
./scripts/docker-release.sh config
```

确认 New API DNS：

```bash
cd deploy
docker compose exec langgraph getent hosts model-gateway
```
