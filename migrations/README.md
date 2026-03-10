# Migration Baseline

This directory is split into schema + data migrations:

- `001_init.up.sql`
- `002_seed_data.up.sql`
- `003_drop_llm_provider_keys.up.sql`

`001_init.up.sql` contains the full schema baseline:

- `users`
- `api_tokens`
- `agents` (includes `mcp_servers` and `UNIQUE (name, status)`)
- `skills`
- `agent_skills`
- `models`
- `thread_bindings` (includes `title`)
- `agent_traces`
- `agent_trace_events`

`002_seed_data.up.sql` contains runtime seed data:

- seeded `models` rows
- default admin user:
  - account: `admin`
  - password: `admin123`
  - email: `admin@163.com`

`003_drop_llm_provider_keys.up.sql` removes the deprecated `llm_provider_keys`
table so `models` remains the single source of truth for runtime model config.

If your environment was migrated with older numbered files, reset or rebuild the
database before re-running migrations so `schema_migrations` matches this
three-file baseline.
