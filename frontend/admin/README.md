# Admin Console (Standalone)

独立后台管理前端项目（不依赖主站前端），用于监控 LangGraph 智能体执行和管理后台账号。

## Stack

- Vite + React + TypeScript
- Tailwind CSS
- shadcn 风格组件（本地组件实现）

## Features

- 登录并使用 JWT 调用 `backend/gateway`
- 智能体监控：
  - traces 列表
  - 事件流（模型调用/工具调用/子任务分支）
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
