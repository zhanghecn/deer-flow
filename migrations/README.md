# Migration Baseline

The active baseline is split into schema + data migrations:

- `001_init.up.sql`
- `002_seed_data.up.sql`

Compatibility cleanup retained for older environments:

- `003_drop_legacy_agent_tables.up.sql`

`001_init.up.sql` contains the full schema baseline:

- `users`
- `api_tokens`
- `models`
- `thread_bindings` (includes `title` and persisted thread runtime binding fields)
- `agent_traces`
- `agent_trace_events`

Notably absent by design:

- no `agents` table
- no `skills` table
- no `agent_skills` join table

Agent and skill definitions are filesystem archives under `.openagents/`, not
database rows.

`002_seed_data.up.sql` contains runtime seed data:

- seeded `models` rows
- baseline `max_input_tokens` metadata for seeded models
- default admin user:
  - account: `admin`
  - password: `admin123`
  - email: `admin@163.com`

`003_drop_legacy_agent_tables.up.sql` is a cleanup migration for environments
that were created before agent/skill definitions became filesystem-only. It
removes legacy `agents`, `skills`, and `agent_skills` tables if they still
exist.

If your environment was migrated with older numbered files, reset or rebuild the
database before re-running migrations so `schema_migrations` matches this
three-file history.
