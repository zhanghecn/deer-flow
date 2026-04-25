# 开发栈、真实测试与发布整理 Todo

## 当前状态

- 已完成：本地开发栈统一到 `docker/docker-compose.yaml`，项目名为 `openagents`。
- 已完成：兼容入口 `docker/docker-compose.dev.yaml` 与 `docker/docker-compose-prod.yaml` 仅指向统一 compose，不再维护两套服务定义。
- 已完成：源码目录在 Docker 内读写挂载，依赖缓存持久化到 `.openagents/dev-cache/`。
- 已完成：固定端口已验证：
  - `8081` admin
  - `8083` app
  - `8084` demo chat/workbench
  - `8001` gateway
  - `2024` langgraph
- 已完成：`scripts/docker.sh start/restart` 都会恢复外部 `model-gateway` 网络别名，避免统一网络重启后 agent 连接模型失败。
- 已完成：`/v1/turns` 错误语义对齐，`turn.failed` 作为流内终态，不再依赖后续 snapshot 拉取才显示失败。
- 已完成：`8083`、`8084/chat`、`8081/observability` 真实浏览器测试通过，复杂 KB 问题能看到 `document_search` / `document_read` trace。
- 已完成：`document_list` 对小型 KB 返回完整轻量树，当前 demo KB 验证 `complete_tree=true`。
- 已完成：agent settings 里的 API 文档 URL 不再泄漏 `http://gateway:8001`，浏览器验证为 `http://127.0.0.1:8083/docs/agents/support-cases-http-demo`。

## 已记录证据

- 真实测试记录：`docs/testing/results/2026-04-25-unified-docker-kb-real-test.md`
- 截图证据：
  - `.openagents/dev-cache/manual-kb-tests/2026-04-25-8083-support-after-restart.png`
  - `.openagents/dev-cache/manual-kb-tests/2026-04-25-8084-chat-after-restart.png`
  - `.openagents/dev-cache/manual-kb-tests/2026-04-25-8081-observability-after-restart.png`

## 当前可提交分组建议

1. `/v1/turns` 错误语义对齐
   - `backend/gateway/internal/handler/turns.go`
   - `backend/gateway/internal/handler/turns_test.go`
   - `backend/gateway/internal/model/turns.go`
   - `backend/gateway/internal/service/public_api_turn_failures.go`
   - `backend/gateway/internal/service/turns_service.go`
   - `backend/gateway/internal/service/public_api_service.go`
   - `backend/gateway/internal/service/public_api_service_test.go`
   - `frontend/app/src/core/public-api/**`
   - `frontend/app/src/core/threads/**`
   - `frontend/demo/src/lib/chat-session.ts`

2. 统一 Docker 开发栈
   - `docker/docker-compose.yaml`
   - `docker/docker-compose.dev.yaml`
   - `docker/docker-compose-prod.yaml`
   - `scripts/docker.sh`
   - `Makefile`
   - `docker/README.md`
   - `docs/testing/README.md`
   - `frontend/app/vite.config.ts`
   - `frontend/admin/vite.config.ts`

3. Demo MCP / KB 工具增强
   - `frontend/demo/mcp-file-service/app/documents.py`
   - `frontend/demo/mcp-file-service/app/service.py`
   - `frontend/demo/mcp-file-service/app/main.py`
   - `frontend/demo/mcp-file-service/tests/**`
   - `frontend/demo/mcp-file-service/{Dockerfile,Dockerfile.local-base,pyproject.toml,uv.lock,requirements.txt}`
   - `frontend/demo/**`

4. Runtime shared mount / materialization 修复
   - `backend/agents/src/agents/lead_agent/agent.py`
   - `backend/agents/tests/test_lead_agent_backend.py`

5. 测试证据与文档
   - `docs/testing/results/2026-04-25-unified-docker-kb-real-test.md`
   - 本 todo

## 提交前需要人工确认的文件

- `.env`：当前有本地变更，通常不应提交，除非确认是模板化配置。
- `AGENTS.md` / `CONTRIBUTING.md`：属于仓库协作规则变更，提交前应确认是否要和代码同批进入。
- `docs/testing/results/2026-04-17-support-sdk-demo-runtime/setup-summary.runtime.json`：看起来是运行时 `last_used` 漂移，不建议作为功能变更提交。

## 后续发布镜像工作

- 另起一轮设计稳定发版链路，不和当前开发栈混在同一个提交里。
- 推荐目标：
  - 开发栈继续 bind mount 源码和持久化依赖缓存
  - 发布栈只使用预构建 `image:`
  - CI 构建并推送镜像
  - 服务器只执行 `docker compose pull && docker compose up -d`
- 镜像仓库优先 GHCR；如果国内拉取慢，再评估 Docker Hub 或国内 registry。

## 当前剩余风险

- 工作树仍然包含多组功能改动，尚未拆分提交。
- 稳定发版镜像链路还没有实现。
- 外部 `1Panel-new-api-6d1F` 仍挂在历史 Docker 网络上，当前不影响 `openagents_default`，但 Docker 网络视图仍偏乱。
