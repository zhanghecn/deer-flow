# Contributing to OpenAgents

Thank you for your interest in contributing to OpenAgents! This guide will help you set up your development environment and understand our development workflow.

## Development Environment Setup

We offer two development environments. **Docker is recommended** for the most consistent and hassle-free experience.

### Option 1: Docker Development (Recommended)

Docker provides a consistent, isolated environment with all dependencies pre-configured. No need to install Node.js, Python, or nginx on your local machine.

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

   All services will start with hot-reload enabled:
   - Frontend changes are automatically reloaded
   - Backend changes trigger automatic restart
   - LangGraph server supports hot-reload

4. **Access the application**:
   - Web Interface: http://localhost:2026
   - API Gateway: http://localhost:2026/api/*
   - LangGraph: http://localhost:2026/api/langgraph/*

#### Docker Commands

```bash
# Build the custom k3s image (with pre-cached sandbox image)
make docker-init
# Start Docker services (mode-aware, localhost:2026)
make docker-start
# Stop Docker development services
make docker-stop
# View Docker development logs
make docker-logs
# View Docker frontend logs
make docker-logs-frontend
# View Docker gateway logs
make docker-logs-gateway
```

#### Docker Architecture

```
Host Machine
  ↓
Docker Compose (openagents-dev)
  ├→ nginx (port 2026) ← Reverse proxy
  ├→ frontend (port 3000) ← Next.js with hot-reload
  ├→ gateway (port 8001) ← Go Gateway (JWT auth, Agent/Skill CRUD, LangGraph proxy)
  ├→ langgraph (port 2024) ← LangGraph server (deepagents engine)
  └→ provisioner (optional, port 8002) ← Started only in provisioner/K8s sandbox mode
```

**Benefits of Docker Development**:
- ✅ Consistent environment across different machines
- ✅ No need to install Node.js, Python, or nginx locally
- ✅ Isolated dependencies and services
- ✅ Easy cleanup and reset
- ✅ Hot-reload for all services
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
│   ├── docker-compose-dev.yaml   # Docker Compose configuration
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
│       ├── migrations/           # PostgreSQL schema
│       └── gateway.yaml          # Gateway configuration
├── frontend/
│   ├── app/                      # Next.js user frontend
│   └── admin/                    # Vite admin console
└── skills/                       # Agent skills
    ├── public/                   # Public skills
    └── custom/                   # Custom skills (gitignored)
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
  │   ├→ Open API: /open/v1/agents/:name/* (external API Token auth)
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
