# OpenAgents 沙箱供应器（Sandbox Provisioner）

**沙箱供应器** 是一个 FastAPI 服务，用于在 Kubernetes 中动态管理沙箱 Pod。它为 OpenAgents 后端提供 REST API，用于创建、监控和销毁用于代码执行的隔离沙箱环境。

## 架构

```
┌────────────┐  HTTP  ┌─────────────┐  K8s API  ┌──────────────┐
│  后端服务   │ ─────▸ │   供应器    │ ────────▸ │  主节点 K8s  │
│ (gateway/  │        │   :8002     │           │  API 服务器  │
│ langgraph) │        └─────────────┘           └──────┬───────┘
└────────────┘                                          │ 创建
                                                        │
                           ┌─────────────┐         ┌────▼─────┐
                           │   后端服务   │ ──────▸ │  沙箱    │
                           │ (通过 Docker │ NodePort│  Pod(s)  │
                           │   网络)     │         └──────────┘
                           └─────────────┘
```

### 工作原理

1. **后端请求**：当后端需要执行代码时，它会发送一个包含 `sandbox_id` 和 `thread_id` 的 `POST /api/sandboxes` 请求。

2. **Pod 创建**：供应器在 `openagents` 命名空间中创建一个专用 Pod，包含：
   - 沙箱容器镜像（all-in-one-sandbox）
   - 挂载的 HostPath 卷：
     - `/mnt/skills` → 对公共技能的只读访问
     - `/mnt/user-data` → 对线程特定数据的读写访问
   - 资源限制（CPU、内存、临时存储）
   - 就绪/存活探针

3. **服务创建**：创建一个 NodePort 服务来暴露 Pod，Kubernetes 从 NodePort 范围（通常为 30000-32767）自动分配端口。

4. **访问 URL**：供应器将 `http://{NODE_HOST}:{NodePort}` 返回给后端。`NODE_HOST` 必须是后端容器可直接访问的真实主机名、IP 或 DNS 名称。

5. **清理**：会话结束时，`DELETE /api/sandboxes/{sandbox_id}` 会删除 Pod 和服务。

## 环境要求

需要一台运行 Kubernetes 集群的主机（Docker Desktop K8s、OrbStack、minikube、kind 等）

### 在 Docker Desktop 中启用 Kubernetes
1. 打开 Docker Desktop 设置
2. 进入 "Kubernetes" 标签页
3. 勾选 "Enable Kubernetes"
4. 点击 "Apply & Restart"

### 在 OrbStack 中启用 Kubernetes
1. 打开 OrbStack 设置
2. 进入 "Kubernetes" 标签页
3. 勾选 "Enable Kubernetes"

## API 端点

### `GET /health`
健康检查端点。

**响应**：
```json
{
  "status": "ok"
}
```

### `POST /api/sandboxes`
创建新的沙箱 Pod + 服务。

**请求**：
```json
{
  "sandbox_id": "abc-123",
  "thread_id": "thread-456"
}
```

**响应**：
```json
{
  "sandbox_id": "abc-123",
  "sandbox_url": "http://192.168.1.10:32123",
  "status": "Pending"
}
```

**幂等性**：使用相同的 `sandbox_id` 调用将返回现有沙箱信息。

### `GET /api/sandboxes/{sandbox_id}`
获取特定沙箱的状态和 URL。

**响应**：
```json
{
  "sandbox_id": "abc-123",
  "sandbox_url": "http://192.168.1.10:32123",
  "status": "Running"
}
```

**状态值**：`Pending`（待处理）、`Running`（运行中）、`Succeeded`（成功）、`Failed`（失败）、`Unknown`（未知）、`NotFound`（未找到）

### `DELETE /api/sandboxes/{sandbox_id}`
销毁沙箱 Pod + 服务。

**响应**：
```json
{
  "ok": true,
  "sandbox_id": "abc-123"
}
```

### `GET /api/sandboxes`
列出当前管理的所有沙箱。

**响应**：
```json
{
  "sandboxes": [
    {
      "sandbox_id": "abc-123",
      "sandbox_url": "http://192.168.1.10:32123",
      "status": "Running"
    }
  ],
  "count": 1
}
```

## 配置

供应器通过环境变量进行配置（在 [docker-compose-prod.yaml](../docker-compose-prod.yaml) 中设置）：

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `K8S_NAMESPACE` | `openagents` | 沙箱资源的 Kubernetes 命名空间 |
| `SANDBOX_IMAGE` | `enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest` | 沙箱 Pod 的容器镜像 |
| `SKILLS_HOST_PATH` | - | **主机**上的技能目录路径（必须是绝对路径） |
| `THREADS_HOST_PATH` | - | **主机**上的线程数据目录路径（必须是绝对路径） |
| `KUBECONFIG_PATH` | `/root/.kube/config` | **供应器容器内**的 kubeconfig 路径 |
| `NODE_HOST` | 必填 | 后端容器用于访问主机 NodePort 的真实主机名、IP 或 DNS 名称 |
| `K8S_API_SERVER` | （来自 kubeconfig） | 可选的 K8s API 服务器覆盖地址（例如 `https://192.168.1.10:26443`） |

### 重要：K8S_API_SERVER 覆盖

如果您的 kubeconfig 使用 `localhost`、`127.0.0.1` 或 `0.0.0.0` 作为 API 服务器地址（在 OrbStack、minikube、kind 中很常见），供应器**无法**从 Docker 容器内部访问它。

**解决方案**：将 `K8S_API_SERVER` 设置为供应器容器可访问的真实主机名、IP 或 DNS 名称：

```yaml
# docker-compose-prod.yaml
provisioner:
  environment:
    - K8S_API_SERVER=https://192.168.1.10:26443  # 替换为真实可达的 API 地址
```

检查您的 kubeconfig API 服务器：
```bash
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
```

## 先决条件

### 主机要求

1. **Kubernetes 集群**：
   - 启用 Kubernetes 的 Docker Desktop，或
   - OrbStack（内置 K8s），或
   - minikube、kind、k3s 等

2. **kubectl 已配置**：
   - `~/.kube/config` 必须存在且有效
   - 当前上下文应指向您的本地集群

3. **Kubernetes 访问权限**：
   - 供应器需要以下权限：
     - 在 `openagents` 命名空间中创建/读取/删除 Pod
     - 在 `openagents` 命名空间中创建/读取/删除服务
     - 读取命名空间（以便在缺失时创建 `openagents`）

4. **主机路径**：
   - `SKILLS_HOST_PATH` 和 `THREADS_HOST_PATH` 必须是**主机上的绝对路径**
   - 这些路径通过 K8s HostPath 卷挂载到沙箱 Pod 中
   - 路径必须存在且能被 K8s 节点读取

### Docker Compose 设置

供应器作为统一 Docker Compose 堆栈的一部分运行：

```bash
# 启动 Docker 服务（当 config.yaml 启用供应器模式时，供应器才会启动）
make docker-start

# 或仅启动供应器
docker compose --env-file .env -p openagents-prod -f docker/docker-compose-prod.yaml --profile provisioner up -d provisioner
```

Compose 文件：
- 将您主机的 `~/.kube/config` 挂载到容器中
- 配置 K8s 访问的环境变量
- 在启用 provisioner 模式时要求在根 `.env` 中显式提供 `NODE_HOST`

## 测试

### 手动 API 测试

```bash
# 健康检查
curl http://localhost:8002/health

# 创建沙箱（通过供应器容器进行内部 DNS 解析）
docker compose -p openagents-prod -f docker/docker-compose-prod.yaml exec provisioner curl -X POST http://localhost:8002/api/sandboxes \
  -H "Content-Type: application/json" \
  -d '{"sandbox_id":"test-001","thread_id":"thread-001"}'

# 检查沙箱状态
docker compose -p openagents-prod -f docker/docker-compose-prod.yaml exec provisioner curl http://localhost:8002/api/sandboxes/test-001

# 列出所有沙箱
docker compose -p openagents-prod -f docker/docker-compose-prod.yaml exec provisioner curl http://localhost:8002/api/sandboxes

# 在 K8s 中验证 Pod 和服务
kubectl get pod,svc -n openagents -l sandbox-id=test-001

# 删除沙箱
docker compose -p openagents-prod -f docker/docker-compose-prod.yaml exec provisioner curl -X DELETE http://localhost:8002/api/sandboxes/test-001
```

### 从后端容器验证

沙箱创建后，后端容器（gateway、langgraph）可以访问它：

```bash
# 从供应器获取沙箱 URL
SANDBOX_URL=$(docker compose -p openagents-prod -f docker/docker-compose-prod.yaml exec -T provisioner curl -s http://localhost:8002/api/sandboxes/test-001 | jq -r .sandbox_url)

# 从 gateway 容器测试
docker compose -p openagents-prod -f docker/docker-compose-prod.yaml exec gateway curl -s $SANDBOX_URL/v1/sandbox
```

## 故障排除

### 问题："Kubeconfig not found"（未找到 kubeconfig）

**原因**：kubeconfig 文件不存在于挂载路径。

**解决方案**：
- 确保您主机上的 `~/.kube/config` 存在
- 运行 `kubectl config view` 进行验证
- 检查 docker-compose-prod.yaml 中的卷挂载

### 问题："Kubeconfig path is a directory"（kubeconfig 路径是目录）

**原因**：挂载的 `KUBECONFIG_PATH` 指向的是目录而不是文件。

**解决方案**：
- 确保 compose 挂载源是文件（例如 `~/.kube/config`）而不是目录
- 在容器内验证：
  ```bash
  docker compose -p openagents-prod -f docker/docker-compose-prod.yaml exec provisioner ls -ld /root/.kube/config
  ```
- 预期输出应指示常规文件（`-`），而不是目录（`d`）

### 问题：连接到 K8s API 时 "Connection refused"（连接被拒绝）

**原因**：供应器无法访问 K8s API 服务器。

**解决方案**：
1. 检查您的 kubeconfig 服务器地址：
   ```bash
   kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
   ```
2. 如果是 `localhost` 或 `127.0.0.1`，请设置 `K8S_API_SERVER`：
   ```yaml
   environment:
     - K8S_API_SERVER=https://192.168.1.10:PORT
   ```

### 问题：创建 Pod 时 "Unprocessable Entity"（无法处理的实体）

**原因**：HostPath 卷包含无效路径（例如带有 `..` 的相对路径）。

**解决方案**：
- 对 `SKILLS_HOST_PATH` 和 `THREADS_HOST_PATH` 使用绝对路径
- 验证路径在您的主机上存在：
  ```bash
  ls -la /path/to/skills
  ls -la /path/to/backend/agents/.openagents/threads
  ```

### 问题：Pod 卡在 "ContainerCreating"（容器创建中）状态

**原因**：通常是从仓库拉取沙箱镜像。

**解决方案**：
- 预拉取镜像：`make docker-init`
- 检查 Pod 事件：`kubectl describe pod sandbox-XXX -n openagents`
- 检查节点：`kubectl get nodes`

### 问题：后端无法访问沙箱 URL

**原因**：NodePort 不可达或 `NODE_HOST` 配置错误。

**解决方案**：
- 验证服务是否存在：`kubectl get svc -n openagents`
- 从主机测试：`curl http://localhost:NODE_PORT/v1/sandbox`
- 从后端容器测试配置的地址：
  `docker compose -p openagents-prod -f docker/docker-compose-prod.yaml exec gateway curl -s http://$NODE_HOST:NODE_PORT/v1/sandbox`
- 检查 `NODE_HOST` 是否是后端容器可达的真实地址

## 安全注意事项

1. **HostPath 卷**：供应器将主机目录挂载到沙箱 Pod 中。确保这些路径仅包含可信数据。

2. **资源限制**：每个沙箱 Pod 都有 CPU、内存和存储限制，以防止资源耗尽。

3. **网络隔离**：沙箱 Pod 在 `openagents` 命名空间中运行，但通过 NodePort 共享主机的网络命名空间。考虑使用 NetworkPolicy 进行更严格的隔离。

4. **kubeconfig 访问**：供应器通过挂载的 kubeconfig 拥有对 Kubernetes 集群的完全访问权限。仅在可信环境中运行它。

5. **镜像信任**：沙箱镜像应来自可信仓库。审查和审计镜像内容。

## 未来增强

- [ ] 支持每个沙箱的自定义资源请求/限制
- [ ] 支持 PersistentVolume 以满足更大的数据需求
- [ ] 自动清理过期的沙箱（基于超时）
- [ ] 指标和监控（Prometheus 集成）
- [ ] 多集群支持（路由到不同的 K8s 集群）
- [ ] Pod 亲和性/反亲和性规则以实现更好的调度
- [ ] 用于沙箱隔离的 NetworkPolicy 模板
