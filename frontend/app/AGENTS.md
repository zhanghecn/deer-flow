# Frontend Development Context

Shared development guide for coding agents working in `frontend/app`.

Read this doc before changing knowledge-base UI, citation preview behavior, or shared-library routes:
@../../docs/architecture/knowledge-base.md
@../../docs/architecture/runtime-semantic-boundary.md

## Overview

OpenAgents Frontend is a Vite-powered React web interface for the OpenAgents system. It talks to the Go Gateway for auth and CRUD APIs, and to LangGraph for thread streaming, artifacts, and agent execution.

Stack: Vite 6, React 19, React Router 7, TypeScript 5.8, Tailwind CSS 4, pnpm 10.26.2.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start the Vite dev server on `http://localhost:3000` |
| `pnpm build` | Build the production bundle |
| `pnpm check` | Run lint and type-check together |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Run ESLint with autofix |
| `pnpm typecheck` | Run `tsc --noEmit` |
| `pnpm preview` | Preview the production bundle on `http://localhost:3000` |
| `pnpm start` | Alias for `pnpm preview` |
| `pnpm test:unit` | Run Vitest unit tests |
| `pnpm test:e2e` | Run Playwright end-to-end tests |

Use at least `pnpm typecheck` before handing changes off. Prefer `pnpm test:unit` when touching routing, state management, or artifact rendering.

## Runtime Shape

```txt
Frontend (Vite + React Router) -> Go Gateway (:8001) -> LangGraph Server (:2024)
            |                            |
            |                            |- JWT auth
            |                            |- Agent/Skill CRUD + publish
            |                            |- /api/langgraph/* reverse proxy
            |                            `- Open API
            |
            |- Vite dev proxy forwards /api, /open, /health in local dev
            `- authFetch() injects JWT and handles 401s
```

The frontend is a stateful chat application. Users authenticate, create threads, send messages, and receive streamed assistant output plus artifacts and todos.

## Source Layout

```txt
src/
├── main.tsx        # Vite bootstrap entry
├── App.tsx         # Root providers
├── routes.tsx      # React Router route definitions
├── app/            # Route components organized by URL shape
├── components/     # UI components
├── core/           # Business logic and API integration
├── hooks/          # Shared React hooks
├── lib/            # Utilities
├── mock-server/    # Vite mock/demo API plugin
└── styles/         # Global styles
```

Important directories:

- `src/app/`
  - page-style route components used by `src/routes.tsx`
  - `/login`, `/register`
  - `/workspace/chats/[thread_id]`
  - `/workspace/agents/[agent_name]/chats/new`
- `src/routes.tsx`
  - owns actual route binding and redirects
  - `/` currently redirects to `/workspace` or `/login`
- `src/components/`
  - `ui/` and `ai-elements/` are generated; avoid manual edits unless regeneration is part of the task
  - `workspace/` contains chat workspace UI
  - `landing/` contains marketing pages
- `src/core/`
  - `auth/` owns JWT state, hooks, and `authFetch()`
  - `api/` owns the LangGraph client singleton
  - `threads/` owns thread creation, streaming, and thread state
  - `agents/`, `skills/`, `memory/`, `mcp/`, `artifacts/` own domain APIs and types
- `src/mock-server/`
  - serves `/mock/api/*` in local/demo mode through a Vite plugin

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

- Keep route composition in `src/routes.tsx` and page modules in `src/app/`.
- Do not re-introduce Next.js-only concepts such as Server Components, App Router route handlers, or `next.config.js`.
- Treat thread hooks such as `useThreadStream`, `useSubmitThread`, and `useThreads` as the primary integration layer.
- Use `authFetch()` for non-LangGraph APIs and `getAPIClient()` for LangGraph APIs.
- Agent payloads use `agents_md` only.
- Agent status values are `dev` and `prod`.
- Slash commands are routing hints only. Do not parse free-form user text on the frontend to infer target agents, target skills, or other business entities.
- The new-agent page may forward an explicit `target_agent_name` only because the UI already owns that value as a dedicated field. Do not re-introduce `is_bootstrap`, `soul`, or natural-language target inference on the frontend side.
- Frontend may parse explicit syntax and machine-readable payloads such as slash tokens, `@document` mentions, and `<next_steps>` JSON.
- Frontend must not read free-form user/assistant prose and infer runtime switching, next-step target agents, current-thread reuse, or other business behavior from that prose.

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
VITE_BACKEND_BASE_URL=http://localhost:8001
```

Requires Node.js 22+ and pnpm 10.26.2+.
