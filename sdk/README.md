# OpenAgents SDK Docs

Downloadable bilingual API docs for external users:

- Chinese: [docs/openagents-sdk-api-reference.zh-CN.md](./docs/openagents-sdk-api-reference.zh-CN.md)
- English: [docs/openagents-sdk-api-reference.en.md](./docs/openagents-sdk-api-reference.en.md)

Recommended integration order:

1. Use `GET /v1/models` to list published agents available to the API token.
2. Use native `POST /v1/turns` for new integrations.
3. Use `GET /v1/turns/{id}` to recover or reopen a completed turn.
4. Use `POST /v1/files` before a turn if you need to attach uploaded files.
5. Use compatibility surfaces only when needed:
   - `POST /v1/responses`
   - `POST /v1/chat/completions`

Notes:

- The public `model` field on compatibility surfaces maps to a published `prod` agent name, not to a provider model id.
- The native SDK surface is message-first and turn-based. Clients should not resend the full transcript every turn.
