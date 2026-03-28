# Go Gateway Development Context

Shared development guide for coding agents working in `backend/gateway`.

Read this doc before changing knowledge-base APIs, shared preview visibility, or thread/library bindings:
@../../docs/architecture/knowledge-base.md

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
- Do not add runtime-only fields such as `skills_mode` or sandbox selection into DB payloads or archived manifests.
- `lead_agent` is reserved and should not be created through normal agent CRUD.

### Agent status model

- `dev` is internal-only.
- `prod` is published and available through `/open/v1/agents/:name/*`.
- Publish copies `agents/dev/{name}/` to `agents/prod/{name}/`. Agent definitions are filesystem-only and do not have companion DB rows.

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

When the frontend or lead agent creates a new domain agent, the runtime flow depends on `target_agent_name` being forwarded to Python so `setup_agent` can materialize the correct archive directory.

## Working Conventions

- Keep `/api/langgraph/*` policy minimal: pass payload through, inject authenticated identity, leave runtime resolution to Python.
- Preserve the archive-definition-to-runtime-materialization contract.
- When extending agent-owned assets, add them under `agents/{status}/{name}/...`, copy them during create and publish, and rely on Python startup to seed them into the runtime view.
- Thread uploads live under `threads/{thread_id}/user-data/uploads/`. Go owns upload CRUD there, including auto-generating Markdown companions for convertible documents and keeping delete/list behavior consistent with those companions.
- Upload conversion should stay best-effort: save the original file first, then attempt Markdown generation without failing the whole upload when conversion tooling is unavailable.

## Code Style

- Follow standard Go formatting and naming.
- Wrap errors with context: `fmt.Errorf("context: %w", err)`.
- Prefer constructor-based dependency injection such as `NewXxxHandler(...)`.
- Use `c.Request.Context()` for request-scoped DB work.
