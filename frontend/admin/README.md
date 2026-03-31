# Admin Console (Standalone)

独立后台管理前端项目（不依赖主站前端），用于监控 LangGraph 智能体执行和管理后台账号。

## Stack

- Vite + React + TypeScript
- Tailwind CSS
- shadcn 风格组件（本地组件实现）

## Features

- 登录并使用 JWT 调用 `backend/gateway`
- 智能体监控：
  - traces 列表（首条用户消息 + 绝对时间）
  - 按 run 聚合的事件流（模型调用/工具调用/中间件链路/子任务分支）
  - 点击时间线行或 3D 节点直接弹出完整 payload 详情
  - 详情优先展示可读内容块（消息、工具、配置、输出），需要时再展开字段浏览器和高级 JSON
  - token 汇总
- Runtime 管理：
  - checkpoint 状态
  - runtime thread 绑定
- 账号管理：
  - admin 账号授权/回收

## Environment

开发环境默认读取 `.env.development`。如果你只想在本机覆写，不改仓库文件，可以新建 `.env.development.local`：

```bash
cp .env.example .env.development.local
```

开发环境变量示例：

```bash
VITE_GATEWAY_BASE_URL=http://localhost:8001
VITE_FRONTEND_BASE_URL=http://localhost:3000
```

## Run

```bash
pnpm install
pnpm dev
```

默认地址：`http://localhost:5173`

- 浏览器请求默认走同源 `/api`
- Vite dev server 再把 `/api`、`/open`、`/health` 代理到 `VITE_GATEWAY_BASE_URL`

## Build

```bash
pnpm build
pnpm preview
```

`pnpm build` 默认走 Vite production mode，因此会读取 `.env.production`
