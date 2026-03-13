# Configuration Guide

This guide explains how to configure OpenAgents for your environment.

## Configuration Sections

### Models

Configure the LLM models available to the agent:

```yaml
models:
  - name: gpt-4                    # Internal identifier
    display_name: GPT-4            # Human-readable name
    use: langchain_openai:ChatOpenAI  # LangChain class path
    model: gpt-4                   # Model identifier for API
    api_key: $OPENAI_API_KEY       # API key (use env var)
    max_tokens: 4096               # Max tokens per request
    temperature: 0.7               # Sampling temperature
```

**Supported Providers**:
- OpenAI (`langchain_openai:ChatOpenAI`)
- Anthropic (`langchain_anthropic:ChatAnthropic`)
- DeepSeek (`langchain_deepseek:ChatDeepSeek`)
- Any LangChain-compatible provider

For OpenAI-compatible gateways (for example Novita), keep using `langchain_openai:ChatOpenAI` and set `base_url`:

```yaml
models:
  - name: novita-deepseek-v3.2
    display_name: Novita DeepSeek V3.2
    use: langchain_openai:ChatOpenAI
    model: deepseek/deepseek-v3.2
    api_key: $NOVITA_API_KEY
    base_url: https://api.novita.ai/openai
    supports_thinking: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled
```

**Thinking Models**:
Some models support "thinking" mode for complex reasoning:

```yaml
models:
  - name: deepseek-v3
    supports_thinking: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled
```

### Tool Groups

Organize tools into logical groups:

```yaml
tool_groups:
  - name: web          # Web browsing and search
  - name: file:read    # Read-only file operations
  - name: file:write   # Write file operations
  - name: bash         # Shell command execution
```

### Tools

Configure specific tools available to the agent:

```yaml
tools:
  - name: web_search
    group: web
    use: src.community.tavily.tools:web_search_tool
    max_results: 5
    # api_key: $TAVILY_API_KEY  # Optional
```

**Built-in Tools**:
- `web_search` - Search the web (Tavily)
- `web_fetch` - Fetch web pages (Jina AI)
- `ls` - List directory contents
- `read_file` - Read file contents
- `write_file` - Write file contents
- `str_replace` - String replacement in files
- `bash` - Execute bash commands

### Sandbox

OpenAgents supports multiple sandbox execution modes. Configure your preferred mode in `config.yaml`:

**Local Execution** (runs sandbox code directly on the host machine):
```yaml
sandbox:
   use: src.sandbox.local:LocalSandboxProvider # Local execution
```

**Docker Execution** (runs sandbox code in isolated Docker containers):
```yaml
sandbox:
   use: src.community.aio_sandbox:AioSandboxProvider # Docker-based sandbox
```

**Docker Execution with Kubernetes** (runs sandbox code in Kubernetes pods via provisioner service):

This mode runs each sandbox in an isolated Kubernetes Pod on your **host machine's cluster**. Requires Docker Desktop K8s, OrbStack, or similar local K8s setup.

```yaml
sandbox:
   use: src.community.aio_sandbox:AioSandboxProvider
   provisioner_url: http://provisioner:8002
```

When using Docker development (`make docker-start`), OpenAgents starts the `provisioner` service only if this provisioner mode is configured. In local or plain Docker sandbox modes, `provisioner` is skipped.

See [Provisioner Setup Guide](docker/provisioner/README.md) for detailed configuration, prerequisites, and troubleshooting.

Choose between local execution or Docker-based isolation:

**Option 1: Local Sandbox** (default, simpler setup):
```yaml
sandbox:
  use: src.sandbox.local:LocalSandboxProvider
```

**Option 2: Docker Sandbox** (isolated, more secure):
```yaml
sandbox:
  use: src.community.aio_sandbox:AioSandboxProvider
  port: 8080
  auto_start: true
  container_prefix: openagents-sandbox

  # Optional: Additional mounts
  mounts:
    - host_path: /path/on/host
      container_path: /path/in/container
      read_only: false
```

### Skills

Configure the skills directory for specialized workflows:

```yaml
storage:
  # Required. Archived agents, users, and thread runtime data.
  base_dir: .openagents

skills:
  # Required host path to the shared skills archive.
  path: skills

  # Container mount path (default: /mnt/skills)
  container_path: /mnt/skills
```

Relative `storage.base_dir` and `skills.path` values are resolved from the directory containing `config.yaml`.

**How Skills Work**:
- Skills are stored in `openagents/skills/{public,custom}/`
- Each skill has a `SKILL.md` file with metadata
- Skills are automatically discovered and loaded
- Available in both local and Docker sandbox via path mapping

### MCP And Extensions

MCP servers and skill enablement are loaded from `extensions_config.json` in the
project root.

Basic flow:

1. Copy `extensions_config.example.json` to `extensions_config.json`
2. Enable the desired MCP servers or skills with `"enabled": true`
3. Configure command/args/env or HTTP/SSE settings per server
4. Restart the application so tools are reloaded

Example:

```json
{
  "mcpServers": {
    "secure-http-server": {
      "enabled": true,
      "type": "http",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "enabled": true,
        "token_url": "https://auth.example.com/oauth/token",
        "grant_type": "client_credentials",
        "client_id": "$MCP_OAUTH_CLIENT_ID",
        "client_secret": "$MCP_OAUTH_CLIENT_SECRET",
        "scope": "mcp.read",
        "refresh_skew_seconds": 60
      }
    }
  }
}
```

Supported MCP transports and features:

- `stdio`
- `http`
- `sse`
- OAuth token acquisition and refresh for `http`/`sse` servers

Secrets should be provided through environment variables rather than committed
into `extensions_config.json`.

### Title Generation

Automatic conversation title generation:

```yaml
title:
  enabled: true
  max_words: 6
  max_chars: 60
  model_name: null  # Use first model in list
```

## Environment Variables

OpenAgents supports environment variable substitution using the `$` prefix:

```yaml
models:
  - api_key: $OPENAI_API_KEY  # Reads from environment
```

**Common Environment Variables**:
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `NOVITA_API_KEY` - Novita API key (OpenAI-compatible endpoint)
- `TAVILY_API_KEY` - Tavily search API key
- `OPENAGENTS_CONFIG_PATH` - Custom config file path

## Configuration Location

The configuration file should be placed in the **project root directory** (`openagents/config.yaml`), not in the backend directory.

## Configuration Priority

OpenAgents searches for configuration in this order:

1. Path specified in code via `config_path` argument
2. Path from `OPENAGENTS_CONFIG_PATH` environment variable
3. `config.yaml` in current working directory (typically `backend/` when running)
4. `config.yaml` in parent directory (project root: `openagents/`)

## Best Practices

1. **Place `config.yaml` in project root** - Not in `backend/` directory
2. **Never commit `config.yaml`** - It's already in `.gitignore`
3. **Use environment variables for secrets** - Don't hardcode API keys
4. **Keep `config.example.yaml` updated** - Document all new options
5. **Test configuration changes locally** - Before deploying
6. **Use Docker sandbox for production** - Better isolation and security

See [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) for the runtime-visible path
contract and backend mapping rules.

## Troubleshooting

### "Config file not found"
- Ensure `config.yaml` exists in the **project root** directory (`openagents/config.yaml`)
- The backend searches parent directory by default, so root location is preferred
- Alternatively, set `OPENAGENTS_CONFIG_PATH` environment variable to custom location

### "Invalid API key"
- Verify environment variables are set correctly
- Check that `$` prefix is used for env var references

### "Skills not loading"
- Check that `openagents/skills/` directory exists
- Verify skills have valid `SKILL.md` files
- Check `skills.path` configuration if using custom path

### "Docker sandbox fails to start"
- Ensure Docker is running
- Check port 8080 (or configured port) is available
- Verify Docker image is accessible

## Examples

See `config.example.yaml` for complete examples of all configuration options.
