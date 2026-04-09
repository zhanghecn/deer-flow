# Contributing to OpenAgents

Thank you for your interest in contributing to OpenAgents! This guide will help you set up your development environment and understand our development workflow.

## Documentation Boundaries

Before treating two documents as if they describe the same thing, check [docs/guides/documentation-boundaries.md](docs/guides/documentation-boundaries.md).

In short:

- `README.md`, `CONTRIBUTING.md`, `docs/**`, and service `README.md` files are repository engineering docs for humans.
- `AGENTS.md` / subtree `AGENTS.md` / `CLAUDE.md` are collaboration docs for coding agents modifying this repo.
- `.openagents/**` plus runtime prompt/skill contracts are the runtime-agent layer and should not be mixed into normal project-doc audits unless the task is explicitly about runtime behavior.
- Inside `docs/`, use `architecture/`, `guides/`, and `testing/` as the default current-doc tree. Treat `plans/` and `history/` as non-authoritative supporting context unless the task is explicitly historical.

## Development Environment Setup

We offer two development environments. **Docker is recommended** when you want
the same compose stack locally and in release-style verification.

### Option 1: Docker Compose (Recommended)

Docker provides a consistent, isolated environment with all dependencies
pre-configured. This repository now uses one production-style compose file for
both local Docker runs and release-style deployment checks.

#### Prerequisites

- Docker Desktop or Docker Engine
- pnpm (for caching optimization)

#### Setup Steps

1. **Configure the application**:
   ```bash
   # Copy example configuration
   cp config.example.yaml config.yaml

   # Set your API keys
   export OPENAI_API_KEY="your-key-here"
   # or edit config.yaml directly
   ```

2. **Initialize Docker environment** (first time only):
   ```bash
   make docker-init
   ```
   This will:
   - Build Docker images
   - Install frontend dependencies (pnpm)
   - Install backend dependencies (uv)
   - Share pnpm cache with host for faster builds

3. **Start development services**:
   ```bash
   make docker-start
   ```
   `make docker-start` reads `config.yaml` and starts `provisioner` only for provisioner/Kubernetes sandbox mode.

4. **Access the application**:
   - Web Interface: http://localhost:8083
   - Admin: http://localhost:8081
   - Sandbox management UI: http://localhost:18080

#### Docker Commands

```bash
# Pull the shared sandbox image
make docker-init
# Start Docker services (mode-aware, app on localhost:8083)
make docker-start
# Stop Docker services
make docker-stop
# View Docker logs
make docker-logs
# View Docker nginx logs
make docker-logs-nginx
# View Docker gateway logs
make docker-logs-gateway
```

#### Docker Architecture

```
Host Machine
  ↓
Docker Compose (openagents-prod)
  ├→ nginx (host ports 8083 / 8081) ← User app + admin entrypoint
  ├→ gateway (internal) ← Go Gateway (JWT auth, Agent/Skill CRUD, LangGraph proxy)
  ├→ langgraph (internal) ← LangGraph server (deepagents engine)
  ├→ sandbox-aio (host port 18080) ← Shared sandbox + management UI
  ├→ onlyoffice (host port 8082) ← Document server for local host-run reuse
  └→ provisioner (optional) ← Started only in provisioner/K8s sandbox mode
```

**Benefits of Docker Compose**:
- ✅ Consistent environment across different machines
- ✅ No need to install Node.js, Python, or nginx locally
- ✅ Isolated dependencies and services
- ✅ Easy cleanup and reset
- ✅ Production-like environment

### Option 2: Local Development

If you prefer to run services directly on your machine:

#### Prerequisites

Check that you have all required tools installed:

```bash
make check
```

Required tools:
- Node.js 22+
- pnpm
- uv (Python package manager)
- Go 1.22+
- nginx
- PostgreSQL 14+ (for Go Gateway)

#### Setup Steps

1. **Configure the application** (same as Docker setup above)

2. **Install dependencies**:
   ```bash
   make install
   ```

3. **Run development server** (starts all services with nginx):
   ```bash
   make dev
   ```

4. **Access the application**:
   - Web Interface: http://localhost:2026
   - All API requests are automatically proxied through nginx

#### Manual Service Control

If you need to start services individually:

1. **Start backend services**:
   ```bash
   # Terminal 1: Start LangGraph Server (port 2024)
   cd backend/agents
   make dev

   # Terminal 2: Start Gateway API (port 8001)
   cd backend/gateway
   make run

   # Terminal 3: Start Frontend App (port 3000)
   cd frontend/app
   pnpm dev

   # Terminal 4: Start Frontend Admin (port 5173, optional)
   cd frontend/admin
   pnpm dev
   ```

2. **Start nginx**:
   ```bash
   nginx -c $(pwd)/docker/nginx/nginx.local.conf -p $(pwd) -g 'daemon off;'
   ```

3. **Access the application**:
   - Web Interface: http://localhost:2026

#### Nginx Configuration

The nginx configuration provides:
- Unified entry point on port 2026
- Routes `/api/langgraph/*` to LangGraph Server (2024)
- Routes other `/api/*` endpoints to Gateway API (8001)
- Routes non-API requests to Frontend (3000)
- Centralized CORS handling
- SSE/streaming support for real-time agent responses
- Optimized timeouts for long-running operations

## Project Structure

```
openagents/
├── config.example.yaml           # Configuration template
├── extensions_config.example.json # MCP and Skills configuration template
├── Makefile                      # Build and development commands
├── scripts/
│   ├── docker.sh                 # Docker management script
│   └── cleanup-containers.sh     # Sandbox container cleanup
├── docker/
│   ├── docker-compose-prod.yaml  # Unified Docker Compose configuration
│   ├── nginx/
│   │   ├── nginx.conf            # Nginx config for Docker
│   │   └── nginx.local.conf      # Nginx config for local dev
│   └── provisioner/              # Sandbox provisioner (K8s mode)
├── backend/
│   ├── agents/                   # Python LangGraph runtime
│   │   ├── src/                  # Agents, tools, sandbox, community integrations
│   │   ├── docs/                 # Agents documentation
│   │   ├── tests/                # Agents test suite
│   │   └── langgraph.json        # LangGraph server config
│   ├── deepagents/               # Vendored deepagents upstream source
│   └── gateway/                  # Go Gateway
│       ├── cmd/server/main.go    # Entry point
│       ├── internal/             # Handlers, middleware, repository, service, proxy
│       ├── pkg/                  # JWT, filesystem storage
│       └── gateway.yaml          # Gateway configuration
├── migrations/                   # PostgreSQL schema + seed SQL
├── frontend/
│   ├── app/                      # Vite user frontend
│   └── admin/                    # Vite admin console
└── .openagents/                  # Host-side runtime/archive root created locally
    ├── agents/                   # Archived agents (dev/prod)
    ├── skills/                   # Archived skill library (store/dev + store/prod)
    ├── users/                    # User-scoped durable data
    └── threads/                  # Thread-scoped runtime workspaces
```

## Architecture

```
Browser (JWT auth)
  ↓
Nginx (port 2026) ← Unified entry point
  ├→ Frontend (port 3000) ← / (non-API requests)
  ├→ Go Gateway (port 8001) ← /api/* (auth, agents, skills, models, uploads, artifacts)
  │   ├→ JWT/API Token authentication
  │   ├→ Agent/Skill CRUD (PostgreSQL + filesystem dual-write)
  │   ├→ Public API: /v1/* (external API Token auth)
  │   └→ Reverse proxy to LangGraph with user_id injection
  └→ LangGraph Server (port 2024) ← /api/langgraph/* (agent execution)
      ├→ deepagents engine (create_deep_agent)
      ├→ CompositeBackend (LocalShellBackend + FilesystemBackend)
      ├→ SubAgentMiddleware (general-purpose, bash)
      └→ SkillsMiddleware + FilesystemMiddleware
```

### Key Design Decisions

- **Go Gateway** replaces Python Gateway for multi-user JWT auth, PostgreSQL storage, and Open API
- **deepagents framework** replaces legacy sandbox/subagent systems with `create_deep_agent()`
- **Dual-write pattern**: Agent/Skill metadata in PostgreSQL + AGENTS.md/config.yaml on filesystem
- **Agent status model**: `dev` (internal) → `prod` (published, accessible via Open API)
- **Unified env var**: `OPENAGENTS_HOME` controls base data directory for both Go and Python

## Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** with hot-reload enabled

3. **Test your changes** thoroughly

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: description of your changes"
   ```

5. **Push and create a Pull Request**:
   ```bash
   git push origin feature/your-feature-name
   ```

## Testing

```bash
# Backend tests
cd backend/agents
make test

# Go Gateway build
make gateway-build

# Go Gateway tests
cd backend/gateway
go test ./...

# Frontend app type check
cd frontend/app
pnpm typecheck

# Frontend admin build
cd frontend/admin
pnpm build
```

### PR Regression Checks

Every pull request runs the backend regression workflow at [.github/workflows/backend-unit-tests.yml](.github/workflows/backend-unit-tests.yml), including:

- `tests/test_provisioner_kubeconfig.py`
- `tests/test_docker_sandbox_mode_detection.py`

## Code Style

- **Backend (Python)**: We use `ruff` for linting and formatting
- **Frontend (TypeScript)**: We use ESLint and Prettier

## Documentation

- [Configuration Guide](backend/agents/docs/CONFIGURATION.md) - Setup and configuration
- [Architecture Overview](backend/agents/CLAUDE.md) - Technical architecture
- [Gateway](backend/gateway/README.md) - Gateway setup, API routes, and authentication
- [Gateway Contributing](backend/gateway/CONTRIBUTING.md) - Gateway development guide
- [MCP Setup Guide](backend/agents/docs/MCP_SERVER.md) - Model Context Protocol configuration

## Need Help?

- Check existing [Issues](https://github.com/bytedance/openagents/issues)
- Read the [Documentation](backend/agents/docs/)
- Ask questions in [Discussions](https://github.com/bytedance/openagents/discussions)

## License

By contributing to OpenAgents, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
