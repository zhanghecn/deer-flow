# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenAgents Frontend is a Next.js 16 web interface for an AI agent system. It communicates with a Go Gateway (JWT auth) and LangGraph-based backend to provide thread-based AI conversations with streaming responses, artifacts, and a skills/tools system. Supports multi-user authentication, Agent management with dev/prod status, and Agent publishing.

**Stack**: Next.js 16, React 19, TypeScript 5.8, Tailwind CSS 4, pnpm 10.26.2

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Dev server with Turbopack (http://localhost:3000) |
| `pnpm build` | Production build |
| `pnpm check` | Lint + type check (run before committing) |
| `pnpm lint` | ESLint only |
| `pnpm lint:fix` | ESLint with auto-fix |
| `pnpm typecheck` | TypeScript type check (`tsc --noEmit`) |
| `pnpm start` | Start production server |

No test framework is configured.

## Architecture

```
Frontend (Next.js) ──▶ Go Gateway (:8001) ──▶ LangGraph Server (:2024)
      │                     │                        ├── lead_agent (deepagents)
      │                     │                        ├── Sub-Agents
      │                     │                        └── Tools & Skills
      │                     │
      │                     ├── JWT Auth (register/login)
      │                     ├── Agent/Skill CRUD + publish
      │                     └── Open API (API Token)
      │
      └── authFetch() ── auto-injects JWT, handles 401
```

The frontend is a stateful chat application. Users authenticate via JWT, create **threads** (conversations), send messages, and receive streamed AI responses. The backend orchestrates agents that can produce **artifacts** (files/code) and **todos**.

### Source Layout (`src/`)

- **`app/`** — Next.js App Router. Routes:
  - `/` (landing)
  - `/login`, `/register` (authentication)
  - `/workspace/chats/[thread_id]` (chat)
  - `/workspace/agents/[agent_name]/chats/new` (agent-specific chat)
- **`components/`** — React components split into:
  - `ui/` — Shadcn UI primitives (auto-generated, ESLint-ignored)
  - `ai-elements/` — Vercel AI SDK elements (auto-generated, ESLint-ignored)
  - `workspace/` — Chat page components (messages, artifacts, settings, agent-card, agent-gallery)
  - `landing/` — Landing page sections
- **`core/`** — Business logic, the heart of the app:
  - `auth/` — JWT authentication system:
    - `store.ts` — Auth state (token, user) in localStorage with subscribe pattern
    - `api.ts` — Login/register API calls
    - `hooks.ts` — `useAuth()` hook via `useSyncExternalStore`
    - `fetch.ts` — `authFetch()` wrapper: auto-injects JWT, handles 401 → redirect to login
  - `threads/` — Thread creation, streaming, state management (hooks + types)
  - `api/` — LangGraph client singleton (injects JWT via `defaultHeaders`)
  - `agents/` — Agent CRUD, publish, types (`Agent`, `CreateAgentRequest`, `UpdateAgentRequest`)
  - `artifacts/` — Artifact loading and caching
  - `i18n/` — Internationalization (en-US, zh-CN)
  - `settings/` — User preferences in localStorage
  - `memory/` — Persistent user memory system
  - `skills/` — Skills installation and management
  - `messages/` — Message processing and transformation
  - `mcp/` — Model Context Protocol integration
  - `models/` — TypeScript types and data models
- **`hooks/`** — Shared React hooks
- **`lib/`** — Utilities (`cn()` from clsx + tailwind-merge)
- **`styles/`** — Global CSS with Tailwind v4 `@import` syntax and CSS variables for theming

### Authentication Flow

1. User visits `/login` → enters email/password → `POST /api/auth/login` → receives JWT
2. `setAuth(token, user)` stores in localStorage and updates subscribers
3. All API calls use `authFetch()` which auto-injects `Authorization: Bearer <jwt>`
4. LangGraph SDK Client recreates with `defaultHeaders` when token changes
5. On 401 response → `clearAuth()` → redirect to `/login`

### Data Flow

1. User input → thread hooks (`core/threads/hooks.ts`) → LangGraph SDK streaming
2. Stream events update thread state (messages, artifacts, todos)
3. TanStack Query manages server state; localStorage stores user settings + auth token
4. Components subscribe to thread state and render updates

### Key Patterns

- **Server Components by default**, `"use client"` only for interactive components
- **Thread hooks** (`useThreadStream`, `useSubmitThread`, `useThreads`) are the primary API interface
- **LangGraph client** is a singleton obtained via `getAPIClient()` in `core/api/`
- **authFetch** wraps all non-LangGraph API calls (agents, models, skills, mcp, memory, uploads)
- **Agent types** use `agents_md` (primary) and `soul` (@deprecated backward compat) fields
- **Agent status**: `"prod"` (published) or `"dev"` (development), shown as badges in UI
- **Environment validation** uses `@t3-oss/env-nextjs` with Zod schemas (`src/env.js`). Skip with `SKIP_ENV_VALIDATION=1`

## Code Style

- **Imports**: Enforced ordering (builtin → external → internal → parent → sibling), alphabetized, newlines between groups. Use inline type imports: `import { type Foo }`.
- **Unused variables**: Prefix with `_`.
- **Class names**: Use `cn()` from `@/lib/utils` for conditional Tailwind classes.
- **Path alias**: `@/*` maps to `src/*`.
- **Components**: `ui/` and `ai-elements/` are generated from registries (Shadcn, MagicUI, React Bits, Vercel AI SDK) — don't manually edit these.

## Environment

Backend API URLs are optional; an nginx proxy is used by default:
```
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8001
NEXT_PUBLIC_LANGGRAPH_BASE_URL=http://localhost:2024
```

Requires Node.js 22+ and pnpm 10.26.2+.
