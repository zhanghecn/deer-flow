# Go Gateway Development Context

Shared development guide for coding agents working in `backend/gateway`.

## Overview

OpenAgents Go Gateway is a Gin-based HTTP gateway on port `8001`. It owns JWT and API-token authentication, Agent and Skill CRUD, PostgreSQL persistence, filesystem sync, LangGraph reverse proxying, and the external Open API.

Stack: Go 1.22, Gin, PostgreSQL (`pgx`), `golang-jwt`, `bcrypt`.

## Commands

| Command | Purpose |
|---------|---------|
| `make build` | Compile `bin/gateway` |
| `make run` | Start with `go run ./cmd/server` |
| `make test` | Run `go test ./...` |
| `make clean` | Remove build artifacts |
| `make migrate` | Apply SQL migrations with `DATABASE_URL` |

## Source Layout

```txt
cmd/server/main.go          # Entry point
internal/
├── config/                 # YAML config loading and env resolution
├── middleware/             # Auth, CORS, rate limiting
├── handler/                # HTTP handlers
├── model/                  # Domain models and DTOs
├── repository/             # PostgreSQL data access
├── service/                # Business logic and filesystem sync
└── proxy/                  # LangGraph reverse proxy
pkg/
├── jwt/                    # JWT helpers
└── storage/                # Filesystem sync helpers
```

## Key Concepts

### Dual-write model

Agent and Skill metadata live in PostgreSQL for querying, while `AGENTS.md` and `config.yaml` are materialized to the filesystem for Python runtime consumption. The service layer owns both writes.

### Auth and proxy flow

1. Frontend users authenticate with JWTs.
2. External clients authenticate with API tokens.
3. Gateway validates auth, injects `user_id` and sometimes `thread_id` into `configurable`, then forwards the request to LangGraph.
4. Gateway should not resolve runtime model config or runtime backend choice.

### Runtime ownership split

- Go owns CRUD, publish, DB persistence, and local archive writes.
- Python owns runtime backend selection, thread-local seeding, and execution.
- `dev` and `prod` are archive statuses, not runtime backend switches.

### Agent status model

- `dev` is internal-only.
- `prod` is published and available through `/open/v1/agents/:name/*`.
- Publish copies `agents/dev/{name}/` to `agents/prod/{name}/` and updates DB state.

## Filesystem Layout

```txt
{base_dir}/
├── agents/{status}/{name}/
│   ├── config.yaml
│   ├── AGENTS.md
│   └── skills/{skill-name}/SKILL.md
├── users/{user_id}/
└── threads/{thread_id}/user-data/{workspace,uploads,outputs}/
```

The Go gateway writes archived agent definitions. The Python runtime later seeds those archived files into thread-local runtime paths.

## Working Conventions

- Keep `/api/langgraph/*` policy minimal: pass payload through, inject authenticated identity, leave runtime resolution to Python.
- Preserve the archive-definition-to-runtime-materialization contract.
- When extending agent-owned assets, add them under `agents/{status}/{name}/...`, copy them during create and publish, and rely on Python startup to seed them into the runtime view.

## Code Style

- Follow standard Go formatting and naming.
- Wrap errors with context: `fmt.Errorf("context: %w", err)`.
- Prefer constructor-based dependency injection such as `NewXxxHandler(...)`.
- Use `c.Request.Context()` for request-scoped DB work.
