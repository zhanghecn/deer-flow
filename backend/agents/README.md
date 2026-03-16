# OpenAgents Agents Runtime

OpenAgents is a LangGraph-based AI super agent runtime with unified execution
backends, persistent memory, and extensible tool integration. The backend lets
agents execute code, manage files, delegate tasks, and keep context across
conversations while preserving one runtime contract under `/mnt/user-data/...`.

---

## Architecture

```
                        ┌──────────────────────────────────────┐
                        │          Nginx (Port 2026)           │
                        │      Unified reverse proxy           │
                        └───────┬──────────────────┬───────────┘
                                │                  │
              /api/langgraph/*  │                  │  /api/* (other)
                                ▼                  ▼
               ┌────────────────────┐  ┌────────────────────────┐
               │ LangGraph Server   │  │    Go Gateway (8001)   │
               │    (Port 2024)     │  │      API Layer         │
               │                    │  │                        │
               │ ┌────────────────┐ │  │ Models, MCP, Skills,   │
               │ │  Lead Agent    │ │  │ Memory, Uploads,       │
               │ │  ┌──────────┐  │ │  │ Artifacts              │
               │ │  │Middleware│  │ │  └────────────────────────┘
               │ │  │  Chain   │  │ │
               │ │  └──────────┘  │ │
               │ │  ┌──────────┐  │ │
               │ │  │  Tools   │  │ │
               │ │  └──────────┘  │ │
               │ │  ┌──────────┐  │ │
               │ │  │Subagents │  │ │
               │ │  └──────────┘  │ │
               │ └────────────────┘ │
               └────────────────────┘
```

**Request Routing** (via Nginx):
- `/api/langgraph/*` → LangGraph Server - agent interactions, threads, streaming
- `/api/*` (other) → Go Gateway API - auth, models, agents, skills, uploads, artifacts
- `/` (non-API) → Frontend - Next.js web interface

---

## Core Components

### Lead Agent

The single LangGraph agent (`lead_agent`) is the runtime entry point, created via `make_lead_agent(config)`. It combines:

- **Dynamic model selection** with thinking and vision support
- **Middleware chain** for cross-cutting concerns (OpenAgents extras + deepagents built-ins)
- **Tool system** with sandbox, MCP, community, and built-in tools
- **Subagent delegation** for parallel task execution
- **System prompt** with skills injection, memory context, and working directory guidance
- **Structured observability** that records LLM request messages, registered tool schemas,
  and per-run payloads for the admin console

### Agent Definition Protocol

Custom agents now follow one filesystem protocol:

- Shared skills live only in `.openagents/skills/{shared,store/dev,store/prod}/`
- Each agent owns its own archive under `.openagents/agents/{status}/{name}/`
- Vertical or domain prompts belong in `.openagents/agents/{status}/{name}/AGENTS.md`
- Selected skills are copied into `.openagents/agents/{status}/{name}/skills/`
- `config.yaml` is the local manifest and records `agents_md_path` and `skill_refs`
- `dev` and `prod` are archive versions only; they are not runtime mode switches
- Runtime backend choice belongs to Python startup/config or per-run remote params
- At runtime, Python seeds a thread-local copy into `/mnt/user-data/...`
- All agents, including `lead_agent`, use `/mnt/user-data/agents/{status}/{name}/skills/` and `/mnt/user-data/agents/{status}/{name}/AGENTS.md`

See [docs/AGENT_PROTOCOL.md](docs/AGENT_PROTOCOL.md) for the full contract and ASCII flow diagram.

### Runtime Backend Selection

All filesystem and shell tools flow through one backend factory.

- `local`
  - selected when sandbox config resolves to `src.sandbox.local:LocalSandboxProvider`
  - intended for local debugging on one machine
- `sandbox`
  - selected when Python config resolves to a managed sandbox provider
  - currently backed by `src.community.aio_sandbox:AioSandboxProvider`
  - works for single-machine sandbox and provisioner/k8s autoscaling modes
- `remote`
  - selected per run with `configurable.execution_backend="remote"`
  - requires `configurable.remote_session_id`
  - uses the same backend protocol through a relay sidecar and `openagents-cli`

The agent-visible path contract does not change across these modes.

### Middleware Chain

OpenAgents-specific middlewares are combined with deepagents built-ins such as `FilesystemMiddleware`, `SkillsMiddleware`, `MemoryMiddleware`, and `SummarizationMiddleware`.

| # | Middleware | Purpose |
|---|-----------|---------|
| 1 | **ArtifactsMiddleware** | Tracks tool-produced artifacts for frontend presentation |
| 2 | **ThreadDataMiddleware** | Creates per-thread isolated directories (workspace, uploads, outputs) |
| 3 | **UploadsMiddleware** | Injects newly uploaded files into conversation context |
| 4 | **FilesystemMiddleware** | Exposes file and execution tools over the configured backend |
| 5 | **SummarizationMiddleware** | Reduces context when approaching token limits (optional) |
| 6 | **TodoListMiddleware** | Tracks multi-step tasks in plan mode (optional) |
| 7 | **TitleMiddleware** | Auto-generates conversation titles after first exchange |
| 8 | **MaxTokensRecoveryMiddleware** | Retries after provider-side max-token/context-overflow failures |
| 9 | **ContextWindowMiddleware** | Persists current prompt occupancy snapshots into LangGraph state |
| 10 | **MemoryMiddleware** | Queues conversations for async memory extraction |
| 11 | **ViewImageMiddleware** | Injects image data for vision-capable models (conditional) |
| 12 | **ClarificationMiddleware** | Intercepts clarification requests and interrupts execution (must be last) |

Important distinction:

- `SummarizationMiddleware` handles normal proactive compaction.
- `MaxTokensRecoveryMiddleware` is only a recovery path when the provider already rejected the request for context/max-token reasons.
- User/admin UI should read current occupancy from persisted `context_window`, not from aggregate trace token totals.

See [../../docs/CONTEXT_WINDOW_AND_SUMMARIZATION_NOTES.md](../../docs/CONTEXT_WINDOW_AND_SUMMARIZATION_NOTES.md) for the concrete runtime notes and validation data.

### Sandbox System

Per-thread isolated execution with a definition/runtime split:

- **Thread workspace**: `/mnt/user-data/{workspace,uploads,outputs}` → thread-specific physical directories
- **Runtime modes**:
  - sandbox disabled in Python config: use `LocalShellBackend` rooted at the thread `user-data` directory
  - sandbox enabled in Python config: resolve the configured provider in Python and acquire a sandbox implementing deepagents `BaseSandbox`
  - remote requested per run: relay the same backend protocol to a connected `openagents-cli` worker
- **Runtime seeding**:
  - every agent, including `lead_agent`: copy `agents/{status}/{name}/**` into `/mnt/user-data/agents/{status}/{name}/**`
  - deepagents reads skills and `AGENTS.md` only from that runtime copy
- `dev/prod` only decide which archived version is loaded; open API always resolves `prod`

### Remote Backend

The remote backend is the cloud-agent path that lets a server-side agent operate
a connected client machine.

- Relay store: `.openagents/remote/sessions/<session_id>/...`
- Relay HTTP sidecar: started by `src/langgraph_dev.py`
- Worker CLI: `clients/openagents-cli`
- Selection:
  - `configurable.execution_backend = "remote"`
  - `configurable.remote_session_id = "<session-id>"`

See [../../docs/remote-backend.md](../../docs/remote-backend.md) for the
session flow and CLI usage.

### Subagent System

Async task delegation with concurrent execution:

- **Built-in agents**: `general-purpose` (full toolset) and `bash` (command specialist)
- **Concurrency**: Max 3 subagents per turn, 15-minute timeout
- **Execution**: Background thread pools with status tracking and SSE events
- **Flow**: Agent calls `task()` tool → executor runs subagent in background → polls for completion → returns result

### Memory System

LLM-powered persistent context retention across conversations:

- **Single scope**: Memory is always isolated by `user_id + agent_name + agent_status`
- **Per-agent policy**: Enablement and extraction/injection limits live in each agent's archived `config.yaml`
- **Automatic extraction**: Analyzes conversations for user context, facts, and preferences
- **Structured storage**: User context (work, personal, top-of-mind), history, and confidence-scored facts
- **Debounced updates**: Batches updates to minimize LLM calls (configurable wait time)
- **System prompt injection**: Top facts + context injected into agent prompts
- **Storage**: JSON file with mtime-based cache invalidation at `{OPENAGENTS_HOME}/users/{user_id}/agents/{status}/{agent_name}/memory.json`

### Tool Ecosystem

| Category | Tools |
|----------|-------|
| **Sandbox** | `bash`, `ls`, `read_file`, `write_file`, `str_replace` |
| **Built-in** | `present_files`, `ask_clarification`, `view_image`, `task` (subagent) |
| **Community** | Tavily (web search), Jina AI (web fetch), Firecrawl (scraping), DuckDuckGo (image search) |
| **MCP** | Any Model Context Protocol server (stdio, SSE, HTTP transports) |
| **Skills** | Domain-specific workflows injected via system prompt |

### Gateway Integration

The HTTP API layer is provided by `backend/gateway` (Go).  
This `backend/agents` project focuses on LangGraph runtime execution, tool orchestration, and checkpoint/history integration.

---

## Quick Start

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) package manager
- API keys for your chosen LLM provider

### Installation

```bash
cd openagents

# Copy configuration files
cp config.example.yaml config.yaml

# Install agents dependencies
cd backend/agents
make install
```

### Configuration

Edit `config.yaml` in the project root:

```yaml
models:
  - name: gpt-4o
    display_name: GPT-4o
    use: langchain_openai:ChatOpenAI
    model: gpt-4o
    api_key: $OPENAI_API_KEY
    supports_thinking: false
    supports_vision: true
```

Set your API keys:

```bash
export OPENAI_API_KEY="your-api-key-here"
```

For host-run development, create project root `.env` manually and keep only
secrets in it, such as database DSNs and API keys.

`backend/agents/langgraph.json` reads `../../.env` for secrets.

Docker development uses the same root `.env`.
Containerized LangGraph still uses `backend/agents/langgraph.json`; Docker-only
URL differences are injected inline by `docker/docker-compose-dev.yaml`.

Important variables:

- `DATABASE_URI`:
  shared PostgreSQL DSN for Python runtime DB queries (`models`, `thread_bindings`)
  and LangGraph checkpointer persistence backend
- `REDIS_URI`:
  optional secret; only needed when `config.yaml` sets `runtime.edition=postgres`
- `config.yaml`:
  non-secret runtime config such as `runtime.edition`, `sandbox`, `storage`,
  shared skills path, and tool registration
- Header pass-through (`x-user-id`, `x-thread-id`) is configured in
  `backend/agents/langgraph.json`:
  `http.configurable_headers.includes`

Note:
- Checkpoints are persisted via custom PostgreSQL checkpointer
  (`backend/agents/langgraph.json` → `checkpointer.path=src.checkpointer.checkpointer`).
- Runtime backend defaults to `inmem`; this does not disable checkpoint persistence.

### Running

**Full Application** (from project root):

```bash
make dev  # Starts LangGraph + Gateway + Frontend + Nginx
```

If your host-run flow needs the shared AIO sandbox or ONLYOFFICE preview, start
them separately first from the project root:

```bash
make docker-infra-start
```

Access at: http://localhost:2026

**Backend Only** (from `backend/agents` directory):

```bash
# Terminal 1: LangGraph server
make dev

# Terminal 2: Gateway API
cd ../gateway
make run
```

Direct access: LangGraph at http://localhost:2024, Gateway at http://localhost:8001

### Direct lead_agent debugging

For backend-only debugging without the frontend, use the built-in runner:

```bash
cd backend/agents
uv run python debug.py
```

Notes:
- Edit the `Quick Edit` variables at the top of `debug.py` directly before running.
- `debug.py` always runs the real `lead_agent` via `make_lead_agent()`.
- `runtime` mode requires a valid UUID `--user-id`; if `DEBUG_USER_ID = None`, the script auto-selects `admin` or the first available user when the DB is reachable.
- `DEBUG_THREAD_ID` is generated automatically on each process start to avoid accidental cross-run reuse.
- Omit `--message` to enter an interactive REPL.

---

## Project Structure

```
backend/agents/
├── src/
│   ├── agents/                  # Agent system
│   │   ├── lead_agent/         # Main agent (factory, prompts)
│   │   ├── middlewares/        # 9 middleware components
│   │   ├── memory/             # Memory extraction & storage
│   │   └── thread_state.py    # ThreadState schema
│   ├── sandbox/                # Sandbox execution
│   │   ├── local/             # Local filesystem provider
│   │   ├── sandbox.py         # Abstract interface
│   │   ├── tools.py           # bash, ls, read/write/str_replace
│   │   └── middleware.py      # Sandbox lifecycle
│   ├── subagents/              # Subagent delegation
│   │   ├── builtins/          # general-purpose, bash agents
│   │   ├── executor.py        # Background execution engine
│   │   └── registry.py        # Agent registry
│   ├── tools/builtins/         # Built-in tools
│   ├── mcp/                    # MCP protocol integration
│   ├── models/                 # Model factory
│   ├── skills/                 # Skill discovery & loading
│   ├── config/                 # Configuration system
│   ├── community/              # Community tools & providers
│   ├── reflection/             # Dynamic module loading
│   └── utils/                  # Utilities
├── docs/                       # Documentation
├── tests/                      # Test suite
├── langgraph.json              # LangGraph server configuration
├── pyproject.toml              # Python dependencies
├── Makefile                    # Development commands
└── Dockerfile                  # Container build
```

---

## Configuration

### Main Configuration (`config.yaml`)

Place in project root. Config values starting with `$` resolve as environment variables.

Key sections:
- `models` - LLM configurations with class paths, API keys, thinking/vision flags
- `storage` - Archived agent data and thread runtime root directory
- `tools` - Tool definitions with module paths and groups
- `tool_groups` - Logical tool groupings
- `sandbox` - Execution environment provider
- `skills` - Skills directory paths
- `title` - Auto-title generation settings
- `summarization` - Context summarization settings
- `subagents` - Subagent system (enabled/disabled)

Memory note:
- Long-term memory is configured per agent in each archived agent `config.yaml`, not in the root `config.yaml`
- Runtime memory storage is user-agent scoped: `{OPENAGENTS_HOME}/users/{user_id}/agents/{status}/{agent_name}/memory.json`

Path note:
- `storage.base_dir` and `skills.path` are explicit project-level settings.
- Relative paths are resolved from the directory containing `config.yaml`.

Provider note:
- `models[*].use` references provider classes by module path (for example `langchain_openai:ChatOpenAI`).
- If a provider module is missing, OpenAgents now returns an actionable error with install guidance (for example `uv add langchain-google-genai`).

### Extensions Configuration (`extensions_config.json`)

MCP servers and skill states in a single file:

```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"}
    },
    "secure-http": {
      "enabled": true,
      "type": "http",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "enabled": true,
        "token_url": "https://auth.example.com/oauth/token",
        "grant_type": "client_credentials",
        "client_id": "$MCP_OAUTH_CLIENT_ID",
        "client_secret": "$MCP_OAUTH_CLIENT_SECRET"
      }
    }
  },
  "skills": {
    "pdf-processing": {"enabled": true}
  }
}
```

### Environment Variables

- `OPENAGENTS_CONFIG_PATH` - Override config.yaml location
- `OPENAGENTS_EXTENSIONS_CONFIG_PATH` - Override extensions_config.json location
- Model API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, etc.
- Tool API keys: `EXA_API_KEY`, `GITHUB_TOKEN`, etc.

---

## Development

### Commands

```bash
make install    # Install dependencies
make dev        # Run LangGraph server (port 2024)
make lint       # Run linter (ruff)
make format     # Format code (ruff)

# Run Go Gateway from sibling project
cd ../gateway && make run
```

### Code Style

- **Linter/Formatter**: `ruff`
- **Line length**: 240 characters
- **Python**: 3.12+ with type hints
- **Quotes**: Double quotes
- **Indentation**: 4 spaces

### Testing

```bash
uv run pytest
```

---

## Technology Stack

- **LangGraph** (1.0.6+) - Agent framework and multi-agent orchestration
- **LangChain** (1.2.3+) - LLM abstractions and tool system
- **Go Gateway** (`backend/gateway`) - Auth, admin APIs, LangGraph proxy
- **langchain-mcp-adapters** - Model Context Protocol support
- **agent-sandbox** - Sandboxed code execution
- **markitdown** - Multi-format document conversion
- **tavily-python** / **firecrawl-py** - Web search and scraping

---

## Documentation

- [Configuration Guide](docs/CONFIGURATION.md)
- [Architecture Details](docs/ARCHITECTURE.md)
- [Agent Protocol](docs/AGENT_PROTOCOL.md)
- [Agent Protocol](docs/AGENT_PROTOCOL.md)
- [API Reference](docs/API.md)
- [File Upload](docs/FILE_UPLOAD.md)
- [Context Summarization](docs/summarization.md)
- [Plan Mode](docs/plan_mode_usage.md)
- [Setup Guide](docs/SETUP.md)

---

## License

See the [LICENSE](../LICENSE) file in the project root.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
