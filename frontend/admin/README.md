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

创建 `.env`：

```bash
cp .env.example .env
```

`.env` 示例：

```bash
VITE_GATEWAY_BASE_URL=http://localhost:8001
```

## Run

```bash
pnpm install
pnpm dev
```

默认地址：`http://localhost:5173`

## Build

```bash
pnpm build
pnpm preview
```
