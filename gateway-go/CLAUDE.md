# CLAUDE.md

This file provides guidance to Claude Code when working with the Go Gateway codebase.

## Project Overview

OpenAgents Go Gateway is a Gin-based HTTP gateway that replaces the Python FastAPI Gateway (port 8001). It provides JWT/API Token authentication, Agent/Skill CRUD with PostgreSQL + filesystem dual-write, LangGraph reverse proxy with user_id injection, and an Open API for external agent invocation.

**Stack**: Go 1.22, Gin, PostgreSQL (pgx), golang-jwt, bcrypt

## Commands

| Command | Purpose |
|---------|---------|
| `make build` | Compile to `bin/gateway` |
| `make run` | Start via `go run ./cmd/server` |
| `make test` | Run all tests (`go test ./...`) |
| `make clean` | Remove build artifacts |
| `make migrate` | Apply SQL migrations (requires `DATABASE_URL`) |

## Architecture

```
cmd/server/main.go          # Entry point, wires all components
internal/
├── config/config.go         # YAML config loader, env var resolution ($VAR)
├── middleware/
│   ├── auth.go              # JWT + API Token dual auth middleware
│   ├── cors.go              # CORS middleware
│   └── ratelimit.go         # Rate limiting
├── handler/
│   ├── auth.go              # Register/Login/Token management
│   ├── agents.go            # Agent CRUD + publish
│   ├── skills.go            # Skill CRUD + publish
│   ├── models.go            # Model list (reads main config.yaml)
│   ├── memory.go            # Memory management (proxy/direct)
│   ├── mcp.go               # MCP config read/write
│   ├── uploads.go           # File upload to thread dirs
│   ├── artifacts.go         # Artifact serving from thread dirs
│   └── open_api.go          # Open API: Chat/Stream/GetArtifact
├── model/
│   ├── models.go            # Domain models (User, Agent, Skill, Thread, etc.)
│   └── dto.go               # Request/Response DTOs
├── repository/              # PostgreSQL DAOs
│   ├── db.go                # Connection pool
│   ├── users.go
│   ├── api_tokens.go
│   ├── agents.go
│   ├── skills.go
│   ├── threads.go
│   └── models.go
├── service/
│   ├── agent_service.go     # Agent business logic + filesystem sync
│   └── skill_service.go     # Skill business logic + filesystem sync
└── proxy/
    └── langgraph.go         # Reverse proxy to LangGraph with user_id injection
pkg/
├── jwt/jwt.go               # JWT token generation and validation
└── storage/fs.go            # Filesystem operations for agent/skill sync
migrations/
└── 001_init.sql             # PostgreSQL schema
```

## Key Concepts

### Dual-Write Pattern

Agent and Skill metadata are stored in PostgreSQL for querying, while AGENTS.md/config.yaml are synced to the filesystem for LangGraph Server to read. Both writes happen in the service layer (`agent_service.go`, `skill_service.go`).

### Authentication Flow

1. **JWT**: Frontend → `POST /api/auth/login` → JWT (user_id, role, exp) → `Authorization: Bearer <jwt>`
2. **API Token**: External clients → `POST /api/auth/tokens` (create) → SHA256-hashed in DB → `Authorization: Bearer <token>`
3. **LangGraph Proxy**: Go gateway validates JWT → extracts user_id → injects into `configurable` → forwards to LangGraph

### Agent Status Model

- `dev` — Development, only accessible via internal API
- `prod` — Published, accessible via Open API (`/open/v1/agents/:name/*`)
- Publish: `POST /api/agents/:name/publish` copies `agents/dev/{name}/` → `agents/prod/{name}/` and updates DB status

### Config Resolution

`gateway.yaml` values starting with `$` are resolved as environment variables:
- `$DB_HOST` → `os.Getenv("DB_HOST")`
- `$JWT_SECRET` → `os.Getenv("JWT_SECRET")`

The gateway also locates the main project `config.yaml` (for model list compatibility) by searching `../config.yaml`, `config.yaml`, `../../config.yaml`.

## Database Schema

Tables: `users`, `api_tokens`, `agents`, `skills`, `agent_skills`, `threads`, `models`

See `migrations/001_init.sql` for the full schema.

Key design decisions:
- Agents and Skills are **shared** (not per-user), with `created_by` for audit
- API Tokens are hashed with SHA256, stored as `token_hash`
- User passwords hashed with bcrypt

## Filesystem Layout

```
{base_dir}/
├── agents/{status}/{name}/     # Agent definitions (shared)
│   ├── config.yaml
│   ├── AGENTS.md
│   └── skills/{skill-name}/SKILL.md
├── users/{user_id}/            # Per-user data
├── threads/{thread_id}/        # Per-thread runtime data
│   └── user-data/{workspace,uploads,outputs}/
```

## Code Style

- Standard Go conventions (`gofmt`, `go vet`)
- Error wrapping with `fmt.Errorf("context: %w", err)`
- Handler methods on structs (`*AgentHandler`, `*AuthHandler`)
- Dependency injection via constructor functions (`NewXxxHandler(...)`)
- Context propagation via `c.Request.Context()` for DB queries
