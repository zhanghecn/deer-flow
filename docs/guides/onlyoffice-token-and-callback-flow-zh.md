# ONLYOFFICE Token、回显与保存回调链路

这份文档单独说明 OpenAgents 当前的 ONLYOFFICE 集成是如何工作的，重点覆盖：

- 浏览器如何拿到 ONLYOFFICE 配置与 token
- 文档内容如何被 Document Server 拉取并回显
- 编辑后的文件如何通过回调重新保存到 thread artifact
- 为什么生产环境与本地开发都建议走同源 `/onlyoffice`

## 1. 角色分工

系统里有两类 token，职责不同：

1. 用户 JWT
   - 浏览器访问 OpenAgents 受保护 API 使用
   - 例如 `/api/threads/:id/office-config/*path`

2. ONLYOFFICE JWT
   - Gateway 为 ONLYOFFICE 配置现场签发
   - Document Server 使用它访问：
     - `/api/office/threads/:id/files/*path`
     - `/api/office/threads/:id/callback/*path`

另外现在有两类 ONLYOFFICE 地址配置：

- `ONLYOFFICE_SERVER_URL`
  - 浏览器可见地址
  - 例如生产里的同源 `/onlyoffice`
- `ONLYOFFICE_INTERNAL_SERVER_URL`
  - Gateway 自己回拉保存产物时使用的容器/进程内可达地址
  - 例如 compose 里的 `http://onlyoffice`

前端不会自行生成 office token。前端只负责向 Gateway 请求 editor config，然后把 Gateway 返回的 `config` 原样交给 ONLYOFFICE 编辑器。

## 2. 总体链路

```text
+---------+          +---------+          +-------------------+          +-------------+
| Browser |          | Gateway |          | ONLYOFFICE Server |          | Thread File |
+---------+          +---------+          +-------------------+          +-------------+
     |                    |                          |                            |
     | GET office-config  |                          |                            |
     | Bearer user JWT    |                          |                            |
     |------------------->|                          |                            |
     |                    | build config + sign JWT  |                            |
     |                    |------------------------->|  config used by editor     |
     | <------------------|                          |                            |
     |                    |                          |                            |
     | load /onlyoffice   |                          |                            |
     | instantiate editor |                          |                            |
     |--------------------------------------------------------------->            |
     |                    |                          | GET file + office JWT       |
     |                    |<-------------------------|---------------------------> |
     |                    | serve bytes              |                            |
     |                    |------------------------->|                            |
     |                    |                          | render current document     |
     |                    |                          |                            |
     | edit / save        |                          |                            |
     |--------------------|--------------------------|                            |
     |                    |                          | POST callback + office JWT  |
     |                    |<-------------------------|                            |
     |                    | download latest file     |                            |
     |                    |-----------------------------------------------------> |
     |                    | atomic replace target    |                            |
     |                    |<-----------------------------------------------------|
```

## 3. 浏览器如何拿 config 与 token

前端 artifact 详情组件检测到 Word / Excel / PPT 文件后，会请求 ONLYOFFICE 配置接口：

- 路由构造：`frontend/app/src/core/artifacts/utils.ts`
- 请求入口：`frontend/app/src/core/artifacts/onlyoffice.ts`
- 使用位置：`frontend/app/src/components/workspace/artifacts/artifact-file-detail.tsx`

核心流程：

```text
Browser
  -> GET /api/threads/:thread_id/office-config/:path?mode=view|edit
  -> Header: Authorization: Bearer <user-jwt>
Gateway
  -> 校验用户 JWT
  -> 找到真实 artifact 文件
  -> 生成 document.url / editorConfig.callbackUrl / document.key
  -> 用 ONLYOFFICE secret 签整个 payload
  -> 返回:
     {
       "documentServerUrl": "/onlyoffice" 或 "http://localhost:8082",
       "config": {
         ...,
         "token": "<office-jwt>"
       }
     }
```

对应代码：

- Gateway handler 初始化：`backend/gateway/cmd/server/main.go`
- config 路由注册：`backend/gateway/cmd/server/main.go`
- config 构造与签名：`backend/gateway/internal/handler/onlyoffice.go`

关键代码片段：

```go
fileURL := fmt.Sprintf("%s/api/office/threads/%s/files/%s", baseURL, ...)
callbackURL := fmt.Sprintf("%s/api/office/threads/%s/callback/%s", baseURL, ...)

payload := map[string]any{
    "document": map[string]any{
        "url": fileURL,
        "key": documentKey,
    },
    "editorConfig": map[string]any{
        "callbackUrl": callbackURL,
    },
}

token, err := h.signPayload(payload)
payload["token"] = token
```

说明：

- `document.url` 给 Document Server 拉原文件
- `editorConfig.callbackUrl` 给 Document Server 保存时回调
- `token` 不是用户 JWT，而是 Gateway 用 ONLYOFFICE secret 签的 office JWT

## 4. 文档是如何“回显”的

“回显”不是前端自己读取 Office 二进制后渲染，而是 ONLYOFFICE Document Server 做的。

流程如下：

```text
1. React 拿到 { documentServerUrl, config }
2. React 动态加载:
   /onlyoffice/web-apps/apps/api/documents/api.js
3. React 调用:
   new DocsAPI.DocEditor(id, config)
4. ONLYOFFICE 校验 config.token
5. ONLYOFFICE 请求 config.document.url
6. Gateway 校验 office JWT 后返回真实文件字节流
7. ONLYOFFICE 在 iframe/editor 内渲染文档
```

前端关键实现：

- `frontend/app/src/components/workspace/artifacts/onlyoffice-document-editor.tsx`

几个关键点：

1. 脚本地址来自 `documentServerUrl`

```ts
${documentServerUrl}/web-apps/apps/api/documents/api.js
```

2. `document.key` 会被附加到脚本 URL 的 `shardkey`，帮助 ONLYOFFICE 做实例路由与缓存隔离

3. 前端不会解构或改写 Gateway 返回的 `config.token`

## 5. document.key 如何生成

`document.key` 不是随机值，而是基于文件状态生成：

```text
threadID + resolvedPath + fileSize + fileModTime
    -> sha256
    -> hex 前 16 字节
```

这样文件内容或 mtime 变化后，key 会变化，ONLYOFFICE 会把它当成新文档版本处理。

实现位置：

- `backend/gateway/internal/handler/onlyoffice.go`

## 6. 文件接口如何鉴权

Document Server 拉原文件时会访问：

```text
GET /api/office/threads/:id/files/*path
Authorization: Bearer <office-jwt>
```

Gateway 不接受用户 JWT 来访问这个接口，而是校验 ONLYOFFICE JWT。

校验逻辑：

```text
优先取 callback body 里的 token
否则取 Authorization: Bearer <token>
然后用 ONLYOFFICE secret 验签
```

实现位置：

- `backend/gateway/internal/handler/onlyoffice.go`

对应测试：

- `backend/gateway/internal/handler/onlyoffice_test.go`

## 7. 保存回调如何落盘

当用户编辑并触发保存时，ONLYOFFICE 会 POST callback：

```json
{
  "status": 2,
  "url": "http://document-server/cache/files/.../output.pptx",
  "token": "<office-jwt>"
}
```

当前代码只在 `status` 为 `2` 或 `6` 时下载并替换目标文件。
下载时不会直接盲信浏览器可见的 `localhost:8083/onlyoffice/...` 之类地址，
而是按 `ONLYOFFICE_INTERNAL_SERVER_URL` 重写成 Gateway 自己可访问的地址。

ASCII 流程：

```text
ONLYOFFICE
  -> POST /api/office/threads/:thread_id/callback/:path
     body: { status, url, token }

Gateway
  -> 校验 body.token
  -> 校验目标 artifact 路径合法且存在
  -> 把 body.url 从浏览器地址重写到 internal server 地址
  -> GET 最新文件
  -> 写入同目录临时文件
  -> chmod 成原文件权限
  -> rename 原子替换原文件
  -> 返回 { "error": 0 }
```

实现位置：

- 回调处理：`backend/gateway/internal/handler/onlyoffice.go`
- 原子替换实现：`backend/gateway/internal/handler/onlyoffice.go`

对应测试：

- `backend/gateway/internal/handler/onlyoffice_test.go`

## 8. secret 从哪里来

Gateway 侧：

```text
ONLYOFFICE_JWT_SECRET 优先
否则回退到 JWT_SECRET
```

ONLYOFFICE 容器侧：

```text
export JWT_SECRET="${ONLYOFFICE_JWT_SECRET:-${JWT_SECRET}}"
```

这保证 Gateway 签出的 office JWT 与 Document Server 校验使用的是同一套 secret。

相关代码：

- `backend/gateway/cmd/server/main.go`
- `docker/docker-compose-prod.yaml`
- `docker/docker-compose-dev.yaml`

## 9. 为什么生产环境要走同源 /onlyoffice

生产环境当前已经固定使用：

```text
documentServerUrl = /onlyoffice
```

优点：

1. 浏览器始终从当前站点 origin 请求 ONLYOFFICE 静态资源与 websocket
2. 避免在前端里写死 `http://host:8082`
3. 避免跨域、cookie、混合内容、反代前缀错位等问题
4. nginx 可以统一处理超时、upgrade、forwarded headers

生产配置位置：

- `docker/docker-compose-prod.yaml`
- `docker/nginx/nginx.prod.conf`

## 10. 本地开发为什么也建议模拟 nginx

如果本地开发仍返回 `http://localhost:8082`，那本地与生产会出现两套路径模型：

- 生产：同源 `/onlyoffice`
- 本地：绝对地址 `http://localhost:8082`

这样排查问题时容易出现“本地正常、生产异常但路径模型不同”的偏差。

更稳妥的做法是让本地也走：

```text
Browser -> http://localhost:3000/onlyoffice/*
Vite dev proxy -> http://localhost:8082/*
```

这样本地浏览器看到的仍然是同源 `/onlyoffice`，行为更接近生产 nginx 反代。

## 11. 当前推荐的本地联调方式

```text
frontend dev server   : http://localhost:3000
gateway               : http://localhost:8001
onlyoffice            : http://localhost:8082

浏览器访问:
  http://localhost:3000/onlyoffice/*

Vite 代理转发到:
  http://localhost:8082/*

gateway 返回给前端的:
  documentServerUrl = /onlyoffice
```

这要求两件事同时成立：

1. Vite dev server 代理 `/onlyoffice`
2. dev compose 或本地网关把 `ONLYOFFICE_SERVER_URL` 设成 `/onlyoffice`

## 12. 代码入口索引

- Frontend
  - `frontend/app/src/core/artifacts/onlyoffice.ts`
  - `frontend/app/src/components/workspace/artifacts/artifact-file-detail.tsx`
  - `frontend/app/src/components/workspace/artifacts/onlyoffice-document-editor.tsx`
  - `frontend/app/vite.config.ts`

- Gateway
  - `backend/gateway/cmd/server/main.go`
  - `backend/gateway/internal/handler/onlyoffice.go`
  - `backend/gateway/internal/handler/onlyoffice_test.go`

- Deploy / Proxy
  - `docker/docker-compose-prod.yaml`
  - `docker/docker-compose-dev.yaml`
  - `docker/nginx/nginx.prod.conf`
