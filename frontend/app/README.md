# OpenAgents Frontend

Like the original OpenAgents 1.0, we would love to give the community a minimalistic and easy-to-use web interface with a more modern and flexible architecture.

## Tech Stack

- **Bundler / Dev Server**: [Vite 6](https://vite.dev/)
- **Routing**: [React Router 7](https://reactrouter.com/)
- **UI**: [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/), [MagicUI](https://magicui.design/) and [React Bits](https://reactbits.dev/)
- **AI Integration**: [LangGraph SDK](https://www.npmjs.com/package/@langchain/langgraph-sdk) and [Vercel AI Elements](https://vercel.com/ai-sdk/ai-elements)

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10.26.2+

### Installation

```bash
# Install dependencies
pnpm install

# Optional: only if you need to override the default dev gateway URL
# cp .env.example .env.development.local
```

### Development

```bash
# Start development server
pnpm dev

# The app will be available at http://localhost:3000
# In browser-side Vite dev, API calls stay same-origin and go through the Vite proxy.
# Proxy target comes from `.env.development*`.
```

### Build

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Build for production
pnpm build

# Preview the production build
pnpm preview

# `pnpm start` is an alias for `pnpm preview`
```

## Site Map

```
├── /                                  # Redirects to /workspace or /login
├── /login                             # Login page
├── /register                          # Register page
├── /workspace                         # Workspace shell
├── /workspace/chats/new               # New lead-agent chat
├── /workspace/chats/:thread_id        # Existing lead-agent chat
├── /workspace/agents                  # Agent list
├── /workspace/agents/new              # New agent page
├── /workspace/agents/:agent_name/chats/new
└── /workspace/agents/:agent_name/chats/:thread_id
```

## Configuration

### Environment Variables

Optional environment variables (see `.env.example` for overrides):

```bash
# `vite` reads `.env.development*`, `vite build` reads `.env.production*`.
# This variable controls the Vite dev proxy target and the non-dev direct API base URL.
# In browser-side Vite dev, requests still go to same-origin /api and are
# forwarded by the dev server proxy.
VITE_BACKEND_BASE_URL="http://localhost:8001"

# This variable is only used by the Vite dev proxy so local browser requests
# can keep using same-origin /onlyoffice while the dev server forwards them to
# the local Document Server.
VITE_ONLYOFFICE_DEV_SERVER_URL="http://localhost:8082"

# Optional. `debug` shows tool details; `user` hides tool details behind
# user-friendly status labels.
VITE_MESSAGE_TRACE_DISPLAY_MODE="debug"
```

In local Vite development, the dev server now proxies:

- `/api`, `/open`, `/health` -> `VITE_BACKEND_BASE_URL`
- `/onlyoffice` -> `VITE_ONLYOFFICE_DEV_SERVER_URL`

That keeps local browser behavior aligned with production, where nginx exposes
ONLYOFFICE under the same-origin `/onlyoffice` prefix.

## Project Structure

```
src/
├── main.tsx                # Vite entrypoint
├── App.tsx                 # Top-level providers
├── routes.tsx              # React Router route table
├── app/                    # Route components organized by path
│   ├── workspace/          # Main workspace pages
│   └── mock/               # Mock/demo route components
├── components/             # React components
│   ├── ui/                 # Reusable UI components
│   ├── workspace/          # Workspace-specific components
│   ├── landing/            # Landing page components
│   └── ai-elements/        # AI-related UI elements
├── core/                   # Core business logic
│   ├── api/                # API client & data fetching
│   ├── artifacts/          # Artifact management
│   ├── config/              # App configuration
│   ├── i18n/               # Internationalization
│   ├── mcp/                # MCP integration
│   ├── messages/           # Message handling
│   ├── models/             # Data models & types
│   ├── settings/           # User settings
│   ├── skills/             # Skills system
│   ├── threads/            # Thread management
│   ├── todos/              # Todo system
│   └── utils/              # Utility functions
├── hooks/                  # Custom React hooks
├── lib/                    # Shared libraries & utilities
├── mock-server/            # Vite mock/demo API plugin
├── styles/                 # Global styles
└── typings/                # Frontend-only type declarations
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the Vite dev server on `http://localhost:3000` |
| `pnpm build` | Build for production |
| `pnpm preview` | Preview the production bundle on `http://localhost:3000` |
| `pnpm start` | Alias for `pnpm preview` |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix ESLint issues |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm check` | Run both lint and typecheck |
| `pnpm test:unit` | Run Vitest unit tests |
| `pnpm test:e2e` | Run Playwright end-to-end tests |

## Development Notes

- Uses pnpm workspaces (see `packageManager` in package.json)
- Host-run development uses the Vite dev proxy for `/api`, `/open`, and `/health`
- `vite` default development mode reads `.env.development*`; `vite build` default production mode reads `.env.production*`
- `VITE_BACKEND_BASE_URL` controls the proxy target in dev and the direct backend base URL outside Vite dev
- `src/mock-server/plugin.ts` serves mock/demo data under `/mock/api/*`
- The route components still live under `src/app/`, but routing is driven by `src/routes.tsx`, not Next.js App Router

## License

MIT License. See [LICENSE](../LICENSE) for details.
