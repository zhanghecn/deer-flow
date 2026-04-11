# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenAgents is a LangGraph-based AI super agent system with a full-stack architecture. The backend provides a "super agent" with sandbox execution, persistent memory, subagent delegation, and extensible tool integration - all operating in per-thread isolated environments.

**Architecture**:
- **LangGraph Server** (port 2024): Agent runtime and workflow execution (deepagents engine)
- **Go Gateway** (port 8001): JWT/API Token auth, Agent/Skill CRUD, LangGraph reverse proxy with user_id injection
- **Python Gateway** (port 8001, legacy): FastAPI REST API, being replaced by Go Gateway
- **Frontend** (port 3000): Vite + React Router web interface with JWT authentication
- **Nginx** (port 2026): Unified reverse proxy entry point
- **Provisioner** (port 8002, optional in Docker dev): Started only when sandbox is configured for provisioner/Kubernetes mode

**Note**: The system is transitioning from Python Gateway to Go Gateway. Both implement the same API surface. The Go Gateway additionally provides multi-user JWT auth, API Token auth, PostgreSQL storage, and Open API endpoints.

Authoritative architecture docs live under `docs/`. Before changing agent
runtime, skills loading, backend selection, or path handling, read:

- `docs/ARCHITECTURE.md`
- `docs/AGENT_PROTOCOL.md`
- `docs/CONFIGURATION.md`

**Project Structure**:
```
openagents/
├── Makefile                    # Root commands (check, install, dev, stop)
├── config.yaml                 # Main application configuration
├── extensions_config.json      # MCP servers and skills configuration
├── backend/                    # Backend application (this directory)
│   ├── Makefile               # Backend-only commands (dev, gateway, lint)
│   ├── langgraph.json         # LangGraph server configuration
│   ├── src/
│   │   ├── agents/            # LangGraph agent system (deepagents engine)
│   │   │   ├── lead_agent/    # Main agent (create_deep_agent + system prompt)
│   │   │   ├── middlewares/   # OpenAgents-specific middleware components
│   │   │   ├── memory/        # Memory extraction, queue, prompts
│   │   │   └── thread_state.py # ThreadState schema
│   │   ├── gateway/           # FastAPI Gateway API (legacy, being replaced by Go)
│   │   │   ├── app.py         # FastAPI application
│   │   │   └── routers/       # 6 route modules (agents, skills, models, etc.)
│   │   ├── sandbox/           # Sandbox execution system (legacy, replaced by deepagents backends)
│   │   ├── subagents/         # Subagent delegation system (legacy, replaced by deepagents SubAgentMiddleware)
│   │   ├── tools/builtins/    # Built-in tools (present_files, question, view_image, setup_agent)
│   │   ├── mcp/               # MCP integration (tools, cache, client)
│   │   ├── models/            # Model factory with thinking/vision support
│   │   ├── skills/            # Skills discovery, loading, parsing
│   │   ├── config/            # Configuration system (app, model, paths, tool, etc.)
│   │   ├── community/         # Community tools (tavily, jina_ai, firecrawl, image_search, aio_sandbox)
│   │   ├── reflection/        # Dynamic module loading (resolve_variable, resolve_class)
│   │   ├── utils/             # Utilities (network, readability)
│   │   └── client.py          # Embedded Python client (OpenAgentsClient)
│   ├── scripts/
│   │   └── migrate_agents.py  # SOUL.md → AGENTS.md + directory layout migration
│   ├── tests/                 # Test suite
│   └── docs/                  # Documentation
├── backend/gateway/                 # Go Gateway (replacing Python Gateway)
│   ├── cmd/server/main.go     # Entry point
│   ├── internal/              # Handlers, middleware, repository, service, proxy
│   ├── pkg/                   # JWT, filesystem storage
│   └── gateway.yaml           # Gateway configuration
├── migrations/                 # PostgreSQL schema + seed SQL
├── frontend/                   # Frontend applications
└── .openagents/skills/         # Archived skill library
    └── store/                 # Dev/prod archived skills
```

## Important Development Guidelines

### Documentation Update Policy
**CRITICAL: Always update README.md and CLAUDE.md after every code change**

When making code changes, you MUST update the relevant documentation:
- Update `README.md` for user-facing changes (features, setup, usage instructions)
- Update `CLAUDE.md` for development changes (architecture, commands, workflows, internal systems)
- Keep documentation synchronized with the codebase at all times
- Ensure accuracy and timeliness of all documentation

## Commands

**Root directory** (for full application):
```bash
make check      # Check system requirements
make install    # Install all dependencies (frontend + backend)
make dev        # Start all services (LangGraph + Gateway + Frontend + Nginx)
make stop       # Stop all services
```

**Backend directory** (for backend development only):
```bash
make install    # Install backend dependencies
make dev        # Run LangGraph server only (port 2024)
make gateway    # Run Gateway API only (port 8001)
uv run python debug.py  # Edit Quick Edit variables at top of debug.py, then run
make test       # Run all backend tests
make lint       # Lint with ruff
make format     # Format code with ruff
```

Regression tests related to Docker/provisioner behavior:
- `tests/test_docker_sandbox_mode_detection.py` (mode detection from `config.yaml`)
- `tests/test_provisioner_kubeconfig.py` (kubeconfig file/directory handling)

CI runs these regression tests for every pull request via [.github/workflows/backend-unit-tests.yml](../.github/workflows/backend-unit-tests.yml).

## Architecture

### Agent System

**Lead Agent** (`src/agents/lead_agent/agent.py`):
- Entry point: `make_lead_agent(config: RunnableConfig)` registered in `langgraph.json`
- `debug.py` is the supported no-frontend debug entry and calls `make_lead_agent()` directly.
- Uses `create_deep_agent()` from deepagents framework (replaced legacy `create_agent()`)
- `build_backend()` creates the per-thread runtime backend and seeds archived files into `/mnt/user-data/...`
- `dev/prod` only decide which archived agent definition is loaded at runtime
- Sandbox is chosen by Python startup/config (`OPENAGENTS_SANDBOX_PROVIDER` / `config.yaml`), not by Go or agent metadata
- `_build_openagents_middlewares()` returns OpenAgents-specific extra middleware
- `OPENAGENTS_SUBAGENTS` defines subagent configs for deepagents `SubAgentMiddleware`
- Tools loaded via `get_available_tools(exclude_groups=["file:read", "file:write", "bash"])` — sandbox tools provided by deepagents `FilesystemMiddleware`
- System prompt generated by `apply_prompt_template()` with AGENTS.md, copied skills, memory, and subagent instructions
- `AgentTraceCallbackHandler` persists structured observability payloads for admin UI, including
  LLM request messages, request settings, registered tools, and field-level truncation markers
- Registered tools for observability must come from callback-captured model request payloads,
  not from precomputed lead-agent metadata assembled before `create_deep_agent()`

**Agent Definition Protocol**:
- Archived reusable skills live in `.openagents/skills/store/{dev,prod}/`
- Each agent owns its own `AGENTS.md`
- Selected skills are copied into `agents/{status}/{name}/skills/`
- `agents/{status}/{name}/config.yaml` is the manifest and records `agents_md_path` and `skill_refs`
- Prompt and per-agent memory both resolve by `agent_name + agent_status`, so `prod` no longer reads `dev` state by accident
- Create/update/publish all write local archived files first; runtime then seeds those files into the chosen backend
- See `docs/AGENT_PROTOCOL.md` for the full contract and ASCII flow

**ThreadState** (`src/agents/thread_state.py`):
- Extends `AgentState` with: `sandbox`, `thread_data`, `title`, `artifacts`, `todos`, `uploaded_files`, `viewed_images`
- Uses custom reducers: `merge_artifacts` (deduplicate), `merge_viewed_images` (merge/clear)

**Runtime Configuration** (via `config.configurable`):
- `thinking_enabled` - Enable model's extended thinking
- `model_name` - Select specific LLM model
- `model_config` - Inject full runtime model config for this run (DB-driven mode)
- `is_plan_mode` - Legacy compatibility flag only; current question/execute behavior does not depend on it
- `subagent_enabled` - Enable task delegation tool
- **No implicit model fallback in agent runtime**: each run must resolve model from one of:
  - `configurable.model_name` / `configurable.model`
  - `configurable.model_config`
  - `agent.model` in agent definition
- **No implicit capability downgrade**: if `thinking_enabled=true` but model does not support thinking, runtime raises error.

### Middleware Architecture

The agent uses **deepagents built-in middleware** plus **OpenAgents-specific extra middleware**.

**deepagents built-in** (provided automatically by `create_deep_agent()`):
- `PatchToolCallsMiddleware` — Fixes dangling tool calls (replaces `DanglingToolCallMiddleware`)
- `SummarizationMiddleware` — Context reduction when approaching token limits
- `TodoListMiddleware` — Task tracking (when plan_mode enabled)
- `MemoryMiddleware` — Memory injection and update
- `SubAgentMiddleware` — Subagent delegation (when subagents provided)
- `SkillsMiddleware` — Skills loading and injection
- `FilesystemMiddleware` — Provides sandbox tools (ls, read_file, write_file, edit_file, execute, glob, grep)
- `HumanInTheLoopMiddleware` — Reserved for approval-style interrupts, not question turns

**OpenAgents-specific extra middleware** (`_build_openagents_middlewares()`):
1. **ArtifactsMiddleware** — Tracks presented/generated artifacts
2. **QuestionDisciplineMiddleware** — Keeps clarifications on the structured `question` tool path, bundles blocker questions up front, and resumes execution after answers instead of serial follow-up intake
3. **UploadsMiddleware** — Tracks and injects uploaded files
4. **KnowledgeContextMiddleware** — Injects attached KB metadata into the prompt and reinforces the KB retrieval protocol
5. **TitleMiddleware** — Auto-generates thread title
6. **Retry / recovery middlewares** — Normalize provider/tool failures and short-circuit bad visible responses
7. **ContextWindowMiddleware** — Persists prompt occupancy telemetry
8. **ViewImageMiddleware** — Injects base64 image data (conditional on vision support)

Prompt-level completion discipline:
- DeepAgents base prompt plus `lead_agent` prompt are responsible for the "keep going until done" contract.
- If the agent creates todos, it should not end the turn while required items remain `pending` or `in_progress`.
- After a `question` answer, the next step is continued execution, not an interim research/proposal summary, unless the user explicitly asked for analysis only.

### Configuration System

**Main Configuration** (`config.yaml`, optional in cloud mode):

Setup for local/dev: copy `config.example.yaml` to `config.yaml` in the **project root** directory.
In cloud/database mode, runtime can start without `config.yaml` and load model config from:
- `configurable.model_config` injected per request (preferred for Open API)
- `OPENAGENTS_MODELS_JSON`

No implicit model fallback is allowed in cloud mode.

Configuration priority:
1. Explicit `config_path` argument
2. `OPENAGENTS_CONFIG_PATH` environment variable
3. `config.yaml` in current directory (backend/)
4. `config.yaml` in parent directory (project root - **recommended location**)
5. If not found: no-file runtime mode (expects per-request model injection or explicit `OPENAGENTS_MODELS_JSON`)

Config values starting with `$` are resolved as environment variables (e.g., `$OPENAI_API_KEY`).

**Extensions Configuration** (`extensions_config.json`):

MCP servers and skills are configured together in `extensions_config.json` in project root:

Configuration priority:
1. Explicit `config_path` argument
2. `OPENAGENTS_EXTENSIONS_CONFIG_PATH` environment variable
3. `extensions_config.json` in current directory (backend/)
4. `extensions_config.json` in parent directory (project root - **recommended location**)

### Gateway API

**Go Gateway** (`backend/gateway/`, replacing Python Gateway):
- See `backend/gateway/CLAUDE.md` for full documentation
- JWT + API Token auth, PostgreSQL, Agent/Skill CRUD with filesystem sync
- LangGraph reverse proxy with user_id injection
- Open API: `GET /v1/models`, `POST /v1/responses`, `POST /v1/chat/completions`, `GET /v1/files/:id/content`

**Python Gateway** (`src/gateway/`, legacy):
- FastAPI application with health check at `GET /health`

| Router | Endpoints |
|--------|-----------|
| **Agents** (`/api/agents`) | `GET /` - list (optional `status` filter); `POST /` - create dev agent from `AGENTS.md` + selected skills; `GET /{name}` - details (`status=dev|prod`); `PUT /{name}` - update selected status; `DELETE /{name}` - delete one status or all; `POST /{name}/publish` - publish dev→prod |
| **Models** (`/api/models`) | `GET /` - list models; `GET /{name}` - model details |
| **MCP** (`/api/mcp`) | `GET /config` - get config; `PUT /config` - update config (saves to extensions_config.json) |
| **Skills** (`/api/skills`) | `GET /` - list skills; `GET /{name}` - details; `PUT /{name}` - update enabled; `POST /install` - install from .skill archive |
| **Memory** (`/api/memory`) | `GET /?user_id&agent_name&agent_status` - memory data; `POST /reload?user_id&agent_name&agent_status` - reload; `GET /config?agent_name&agent_status` - per-agent policy; `GET /status?user_id&agent_name&agent_status` - policy + data |
| **Uploads** (`/api/threads/{id}/uploads`) | `POST /` - upload files (auto-converts PDF/PPT/Excel/Word); `GET /list` - list; `DELETE /{filename}` - delete |
| **Artifacts** (`/api/threads/{id}/artifacts`) | `GET /{path}` - serve artifacts; `?download=true` for file download |

Proxied through nginx: all `/api/*` → Gateway (Go or Python).

### Backend System (deepagents)

The lead agent uses `deepagents.create_deep_agent()` which provides:
- **CompositeBackend** — Exposes one default backend rooted in the thread runtime view:
  - thread workspace → `/mnt/user-data/{workspace,uploads,outputs}`
  - every agent runtime copy → `/mnt/user-data/agents/{status}/{name}/...`
- **FilesystemMiddleware** — Built-in sandbox tools (ls, read_file, write_file, edit_file, execute, glob, grep)
- **SubAgentMiddleware** — Subagent delegation with `OPENAGENTS_SUBAGENTS` config

**Legacy Sandbox** (`src/sandbox/`) and **Legacy Subagents** (`src/subagents/`) are retained for backward compatibility but replaced by deepagents backends.

### Subagent System

**Built-in Agents**: `general-purpose` (all tools except `task`) and `bash` (command specialist)
**Execution**: Dual thread pool - `_scheduler_pool` (3 workers) + `_execution_pool` (3 workers)
**Concurrency**: `MAX_CONCURRENT_SUBAGENTS = 3` enforced by `SubagentLimitMiddleware` (truncates excess tool calls in `after_model`), 15-minute timeout
**Flow**: `task()` tool → `SubagentExecutor` → background thread → poll 5s → SSE events → result
**Events**: `task_started`, `task_running`, `task_completed`/`task_failed`/`task_timed_out`

### Tool System (`src/tools/`)

`get_available_tools(groups, exclude_groups, include_mcp, model_name, subagent_enabled)` assembles:

**Note**: When called from `make_lead_agent()` or `OpenAgentsClient`, `exclude_groups=["file:read", "file:write", "bash"]` is passed to avoid duplicating tools already provided by deepagents `FilesystemMiddleware`.
1. **Config-defined tools** - Resolved from `config.yaml` via `resolve_variable()`
2. **MCP tools** - From enabled MCP servers (lazy initialized, cached with mtime invalidation)
3. **Built-in tools**:
   - `present_files` - Make output files visible to user (only `/mnt/user-data/outputs`)
   - `question` - Request structured user answers via LangGraph interrupt/resume
   - `view_image` - Read image as base64 (added only if model supports vision)
4. **Subagent tool** (if enabled):
   - `task` - Delegate to subagent (description, prompt, subagent_type, max_turns)

**Community tools** (`src/community/`):
- `tavily/` - Web search (5 results default) and web fetch (4KB limit)
- `jina_ai/` - Web fetch via Jina reader API with readability extraction
- `firecrawl/` - Web scraping via Firecrawl API
- `image_search/` - Image search via DuckDuckGo

### MCP System (`src/mcp/`)

- Uses `langchain-mcp-adapters` `MultiServerMCPClient` for multi-server management
- **Lazy initialization**: Tools loaded on first use via `get_cached_mcp_tools()`
- **Cache invalidation**: Detects config file changes via mtime comparison
- **Transports**: stdio (command-based), SSE, HTTP
- **OAuth (HTTP/SSE)**: Supports token endpoint flows (`client_credentials`, `refresh_token`) with automatic token refresh + Authorization header injection
- **Runtime updates**: Gateway API saves to extensions_config.json; LangGraph detects via mtime

### Skills System (`src/skills/`)

- **Location**: `.openagents/skills/store/{dev,prod}/`
- **Format**: Directory with `SKILL.md` (YAML frontmatter: name, description, license, allowed-tools)
- **Loading**: `load_skills()` scans `.openagents/skills/store/{dev,prod}` for `SKILL.md`, parses metadata, and reads enabled state from extensions_config.json
- **Materialization**: custom agents do not mutate archived skills in place; they copy selected skills into `agents/{status}/{name}/skills/`
- **Injection**: all agents, including `lead_agent`, read skills from their thread-local copied runtime path under `/mnt/user-data/agents/{status}/{name}/skills/`
- **Installation**: `POST /api/skills/install` extracts `.skill` archives to `.openagents/skills/store/dev/`

### Model Factory (`src/models/factory.py`)

- `create_chat_model(name, thinking_enabled)` instantiates LLM from config via reflection
- Supports `thinking_enabled` flag with per-model `when_thinking_enabled` overrides
- Supports `supports_vision` flag for image understanding models
- Config values starting with `$` resolved as environment variables
- Missing provider modules surface actionable install hints from reflection resolvers (for example `uv add langchain-google-genai`)

### Memory System (`src/agents/memory/`)

**Components**:
- `updater.py` - LLM-based memory updates with fact extraction and atomic file I/O
- `queue.py` - Debounced update queue (per-thread deduplication, configurable wait time)
- `prompt.py` - Prompt templates for memory updates

**Scope and Storage**:
- Single supported scope: `user_id + agent_name + agent_status`
- Stored at `{OPENAGENTS_HOME}/users/{user_id}/agents/{status}/{agent_name}/memory.json`

**Data Structure**:
- **User Context**: `workContext`, `personalContext`, `topOfMind` (1-3 sentence summaries)
- **History**: `recentMonths`, `earlierContext`, `longTermBackground`
- **Facts**: Discrete facts with `id`, `content`, `category` (preference/knowledge/context/behavior/goal), `confidence` (0-1), `createdAt`, `source`

**Workflow**:
1. `MemoryMiddleware` filters messages (user inputs + final AI responses) and queues conversation
2. Queue debounces (30s default), batches updates, deduplicates per-thread
3. Background thread invokes LLM to extract context updates and facts
4. Applies updates atomically (temp file + rename) with cache invalidation
5. Next interaction injects top 15 facts + context into `<memory>` tags in system prompt

**Configuration** (per-agent `agents/{status}/{name}/config.yaml` → `memory`):
- `enabled` / `injection_enabled` - Master switches
- `debounce_seconds` - Wait time before processing (default: 30)
- `model_name` - Required when memory is enabled
- `max_facts` / `fact_confidence_threshold` - Fact storage limits (100 / 0.7)
- `max_injection_tokens` - Token limit for prompt injection (2000)

### Reflection System (`src/reflection/`)

- `resolve_variable(path)` - Import module and return variable (e.g., `module.path:variable_name`)
- `resolve_class(path, base_class)` - Import and validate class against base class

### Config Schema

**`config.yaml`** key sections:
- `models[]` - LLM configs with `use` class path, `supports_thinking`, `supports_vision`, provider-specific fields
- `tools[]` - Tool configs with `use` variable path and `group`
- `tool_groups[]` - Logical groupings for tools
- `sandbox.use` - Sandbox provider class path
- `skills.path` / `skills.container_path` - Host and container paths to skills directory
- `title` - Auto-title generation (enabled, max_words, max_chars, prompt_template)
- `summarization` - Context summarization (enabled, trigger conditions, keep policy)
- `subagents.enabled` - Master switch for subagent delegation
- agent-local `memory` - Memory system policy (enabled, model_name, debounce_seconds, max_facts, fact_confidence_threshold, injection_enabled, max_injection_tokens)

**`extensions_config.json`**:
- `mcpServers` - Map of server name → config (enabled, type, command, args, env, url, headers, oauth, description)
- `skills` - Map of skill name → state (enabled)

Both can be modified at runtime via Gateway API endpoints or `OpenAgentsClient` methods.

### Embedded Client (`src/client.py`)

`OpenAgentsClient` provides direct in-process access to all OpenAgents capabilities without HTTP services. All return types align with the Gateway API response schemas, so consumer code works identically in HTTP and embedded modes.

**Architecture**: Imports the same `src/` modules that LangGraph Server and Gateway API use. Shares the same config files and data directories. No FastAPI dependency.

**Agent Conversation** (replaces LangGraph Server):
- `chat(message, thread_id)` — synchronous, returns final text
- `stream(message, thread_id)` — yields `StreamEvent` aligned with LangGraph SSE protocol:
  - `"values"` — full state snapshot (title, messages, artifacts)
  - `"messages-tuple"` — per-message update (AI text, tool calls, tool results)
  - `"end"` — stream finished
- Agent created lazily via `create_deep_agent()` + `_build_openagents_middlewares()` + `build_backend()`, same as `make_lead_agent`
- Supports `checkpointer` parameter for state persistence across turns
- `reset_agent()` forces agent recreation (e.g. after memory or skill changes)

**Gateway Equivalent Methods** (replaces Gateway API):

| Category | Methods | Return format |
|----------|---------|---------------|
| Models | `list_models()`, `get_model(name)` | `{"models": [...]}`, `{name, display_name, ...}` |
| MCP | `get_mcp_config()`, `update_mcp_config(servers)` | `{"mcp_servers": {...}}` |
| Skills | `list_skills()`, `get_skill(name)`, `update_skill(name, enabled)`, `install_skill(path)` | `{"skills": [...]}` |
| Memory | `get_memory(user_id, agent_name, agent_status="dev")`, `reload_memory(user_id, agent_name, agent_status="dev")`, `get_memory_config(agent_name, agent_status="dev")`, `get_memory_status(user_id, agent_name, agent_status="dev")` | dict |
| Uploads | `upload_files(thread_id, files)`, `list_uploads(thread_id)`, `delete_upload(thread_id, filename)` | `{"success": true, "files": [...]}`, `{"files": [...], "count": N}` |
| Artifacts | `get_artifact(thread_id, path)` → `(bytes, mime_type)` | tuple |

**Key difference from Gateway**: Upload accepts local `Path` objects instead of HTTP `UploadFile`. Artifact returns `(bytes, mime_type)` instead of HTTP Response. `update_mcp_config()` and `update_skill()` automatically invalidate the cached agent.

**Tests**: `tests/test_client.py` (77 unit tests including `TestGatewayConformance`), `tests/test_client_live.py` (live integration tests, requires config.yaml)

**Gateway Conformance Tests** (`TestGatewayConformance`): Validate that every dict-returning client method conforms to the corresponding Gateway Pydantic response model. Each test parses the client output through the Gateway model — if Gateway adds a required field that the client doesn't provide, Pydantic raises `ValidationError` and CI catches the drift. Covers: `ModelsListResponse`, `ModelResponse`, `SkillsListResponse`, `SkillResponse`, `SkillInstallResponse`, `McpConfigResponse`, `UploadResponse`, `MemoryConfigResponse`, `MemoryStatusResponse`.

## Development Workflow

### Test-Driven Development (TDD) — MANDATORY

**Every new feature or bug fix MUST be accompanied by unit tests. No exceptions.**

- Write tests in `backend/agents/tests/` following the existing naming convention `test_<feature>.py`
- Run the full suite before and after your change: `make test`
- Tests must pass before a feature is considered complete
- For lightweight config/utility modules, prefer pure unit tests with no external dependencies
- If a module causes circular import issues in tests, add a `sys.modules` mock in `tests/conftest.py` (see existing example for `src.subagents.executor`)

```bash
# Run all tests
make test

# Run a specific test file
PYTHONPATH=. uv run pytest tests/test_<feature>.py -v
```

### Running the Full Application

From the **project root** directory:
```bash
make dev
```

This starts all services and makes the application available at `http://localhost:2026`.

**Nginx routing**:
- `/api/langgraph/*` → LangGraph Server (2024)
- `/api/*` (other) → Gateway API (8001)
- `/` (non-API) → Frontend (3000)

### Running Backend Services Separately

From the **backend** directory:

```bash
# Terminal 1: LangGraph server
make dev

# Terminal 2: Gateway API
make gateway
```

Direct access (without nginx):
- LangGraph: `http://localhost:2024`
- Gateway: `http://localhost:8001`

### Frontend Configuration

The frontend uses environment variables to connect to backend services:
- `VITE_BACKEND_BASE_URL` - Optional gateway base URL override outside Vite dev; Vite dev itself keeps browser requests on same-origin `/api/*` and proxies them to the gateway

When using `make dev` from root, the frontend automatically connects through nginx.

## Key Features

### File Upload

Multi-file upload with automatic document conversion:
- Endpoint: `POST /api/threads/{thread_id}/uploads`
- Supports: PDF, PPT, Excel, Word documents (converted via `markitdown`)
- Files stored in thread-isolated directories
- Agent receives uploaded file list via `UploadsMiddleware`
- When a converted Markdown companion exists, `UploadsMiddleware` exposes that `.md` path as the preferred `Path` and keeps the original document as `Original Path`

See [docs/FILE_UPLOAD.md](docs/FILE_UPLOAD.md) for details.

### Plan Mode

TodoList middleware for complex multi-step tasks:
- Controlled via runtime config: `config.configurable.is_plan_mode = True`
- Provides `write_todos` tool for task tracking
- One task in_progress at a time, real-time updates

See [docs/plan_mode_usage.md](docs/plan_mode_usage.md) for details.

### Context Summarization

Automatic conversation summarization when approaching token limits:
- Configured in `config.yaml` under `summarization` key
- Trigger types: tokens, messages, or fraction of max input
- Keeps recent messages while summarizing older ones

See [docs/summarization.md](docs/summarization.md) for details.

### Vision Support

For models with `supports_vision: true`:
- `ViewImageMiddleware` processes images in conversation
- `view_image_tool` added to agent's toolset
- Images automatically converted to base64 and injected into state

## Code Style

- Uses `ruff` for linting and formatting
- Line length: 240 characters
- Python 3.12+ with type hints
- Double quotes, space indentation

## Documentation

See `docs/` directory for detailed documentation:
- [CONFIGURATION.md](docs/CONFIGURATION.md) - Configuration options
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - Architecture details
- [AGENT_PROTOCOL.md](docs/AGENT_PROTOCOL.md) - Agent definition/materialization/runtime contract
- [AGENT_PROTOCOL.md](docs/AGENT_PROTOCOL.md) - Agent definition, runtime seeding, backend/path contract
- [API.md](docs/API.md) - API reference
- [SETUP.md](docs/SETUP.md) - Setup guide
- [FILE_UPLOAD.md](docs/FILE_UPLOAD.md) - File upload feature
- [summarization.md](docs/summarization.md) - Context summarization
- [plan_mode_usage.md](docs/plan_mode_usage.md) - Plan mode with TodoList
