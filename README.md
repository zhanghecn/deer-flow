# OpenAgents 2.0

OpenAgents is an open-source agent runtime built around:

- LangGraph-based agent orchestration
- sandboxed and remote execution backends
- thread-scoped runtime files under `/mnt/user-data/...`
- agent-owned prompts and copied skills under `.openagents/...`
- a Go Gateway plus Python agent runtime

> [!NOTE]
> OpenAgents 2.0 is a ground-up rewrite. The original Deep Research framework remains on the [`1.x` branch](https://github.com/bytedance/openagents/tree/main-1.x).

## Official Website

- Website and live demos: [openagents.dev](https://openagents.dev/)
- This repository does not ship committed frontend demo thread snapshots.
- Local frontend `?mock=true` mode is only for a small in-code test fixture set.

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/bytedance/openagents.git
cd openagents
make config
```

Edit `config.yaml` and define at least one model:

```yaml
models:
  - name: gpt-4
    display_name: GPT-4
    use: langchain_openai:ChatOpenAI
    model: gpt-4
    api_key: $OPENAI_API_KEY
    max_tokens: 4096
    temperature: 0.7
```

Set provider keys in `.env` or your shell:

```bash
OPENAI_API_KEY=your-openai-api-key
TAVILY_API_KEY=your-tavily-api-key
```

### 2. Run with Docker

```bash
make docker-init
make docker-start
```

Open: `http://localhost:2026`

### 3. Run locally

```bash
make check
make install
make docker-infra-start
make dev
```

Open: `http://localhost:2026`

## Runtime Overview

OpenAgents uses one agent-visible filesystem contract across all runtime backends:

```text
/mnt/user-data/
├── uploads/
├── workspace/
├── outputs/
└── agents/
```

Supported execution targets:

- `local`: host execution for debugging, still exposed as `/mnt/user-data/...`
- `sandbox`: managed sandbox execution via provider/provisioner
- `remote`: per-run relay to a connected remote worker

Current backend architecture docs:

- [Runtime Architecture](docs/architecture/runtime-architecture.md)
- [Remote Backend](docs/architecture/remote-backend.md)
- [Knowledge Base Architecture](docs/architecture/knowledge-base.md)

## Embedded Python Client

You can use OpenAgents without starting the full HTTP stack:

```python
from src.client import OpenAgentsClient

client = OpenAgentsClient()

response = client.chat("Analyze this paper", thread_id="my-thread")

for event in client.stream("hello"):
    if event.type == "messages-tuple" and event.data.get("type") == "ai":
        print(event.data["content"])
```

For direct lead-agent debugging:

```bash
cd backend/agents
uv run python debug.py
```

See [`backend/agents/src/client.py`](backend/agents/src/client.py) and [`backend/agents/debug.py`](backend/agents/debug.py).

## Documentation

- [Docs Index](docs/README.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Testing Guide](docs/testing/README.md)
- [Agents Architecture](backend/agents/README.md)
- [Gateway README](backend/gateway/README.md)
- [Backend Configuration](backend/agents/docs/CONFIGURATION.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, and development commands.

## License

[MIT](LICENSE)
