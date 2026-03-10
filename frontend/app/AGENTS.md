# Frontend Development Context

Shared development guide for coding agents working in `frontend/app`.

## Overview

OpenAgents Frontend is a Next.js 16 web interface for the OpenAgents system. It talks to the Go Gateway for auth and CRUD APIs, and to LangGraph for thread streaming, artifacts, and agent execution.

Stack: Next.js 16, React 19, TypeScript 5.8, Tailwind CSS 4, pnpm 10.26.2.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start the dev server with Turbopack on `http://localhost:3000` |
| `pnpm build` | Build the production bundle |
| `pnpm check` | Run lint and type-check together |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Run ESLint with autofix |
| `pnpm typecheck` | Run `tsc --noEmit` |
| `pnpm start` | Start the production server |

No test framework is configured in this app. Use `pnpm check` before handing changes off.

## Runtime Shape

```txt
Frontend (Next.js) -> Go Gateway (:8001) -> LangGraph Server (:2024)
      |                     |
      |                     |- JWT auth
      |                     |- Agent/Skill CRUD + publish
      |                     |- /api/langgraph/* reverse proxy
      |                     `- Open API
      |
      `- authFetch() injects JWT and handles 401s
```

The frontend is a stateful chat application. Users authenticate, create threads, send messages, and receive streamed assistant output plus artifacts and todos.

## Source Layout

```txt
src/
├── app/            # App Router pages and route handlers
├── components/     # UI components
├── core/           # Business logic and API integration
├── hooks/          # Shared React hooks
├── lib/            # Utilities
├── server/         # Reserved for server-only code
└── styles/         # Global styles
```

Important directories:

- `src/app/`
  - `/` landing
  - `/login`, `/register`
  - `/workspace/chats/[thread_id]`
  - `/workspace/agents/[agent_name]/chats/new`
- `src/components/`
  - `ui/` and `ai-elements/` are generated; avoid manual edits unless regeneration is part of the task
  - `workspace/` contains chat workspace UI
  - `landing/` contains marketing pages
- `src/core/`
  - `auth/` owns JWT state, hooks, and `authFetch()`
  - `api/` owns the LangGraph client singleton
  - `threads/` owns thread creation, streaming, and thread state
  - `agents/`, `skills/`, `memory/`, `mcp/`, `artifacts/` own domain APIs and types

## Key Flows

### Authentication

1. `/login` calls `POST /api/auth/login`.
2. `setAuth()` stores token and user in localStorage.
3. `authFetch()` injects `Authorization: Bearer <jwt>`.
4. LangGraph client headers refresh when auth state changes.
5. A `401` clears auth and redirects back to `/login`.

### Thread Streaming

1. UI submits user input through thread hooks in `src/core/threads/`.
2. LangGraph streaming events update messages, artifacts, and todos.
3. Components subscribe to thread state and rerender as events arrive.

## Working Conventions

- Prefer Server Components by default. Add `"use client"` only when interactivity requires it.
- Treat thread hooks such as `useThreadStream`, `useSubmitThread`, and `useThreads` as the primary integration layer.
- Use `authFetch()` for non-LangGraph APIs and `getAPIClient()` for LangGraph APIs.
- Agent payloads use `agents_md` only.
- Agent status values are `dev` and `prod`.
- The new-agent bootstrap flow depends on forwarding `target_agent_name` through thread extra context. Do not re-introduce `is_bootstrap` or `soul` compatibility fields on the frontend side.

## Code Style

- Keep imports ordered `builtin -> external -> internal -> parent -> sibling`.
- Use inline type imports: `import { type Foo }`.
- Prefix intentionally unused variables with `_`.
- Use `cn()` from `@/lib/utils` for conditional Tailwind classes.
- Use the `@/*` path alias for `src/*`.
- Do not hand-edit generated component registries unless the task explicitly requires it.

## Environment

Optional override:

```bash
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8001
```

Requires Node.js 22+ and pnpm 10.26.2+.
