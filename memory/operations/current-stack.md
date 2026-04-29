# Current Stack Memory

## Public Entrypoints

- `8081`: admin console and observability
- `8083`: product app and workspace flows
- `8084`: demo surface for MCP and external integration work

## Test Accounts

- Product-side historical test account:
  - username: `supportdemo_1776361880`
  - password: `admin12345`
  - user id: `57e4667d-77e7-43f0-af38-6bb673079f35`
- Admin console:
  - username: `admin`
  - password: `admin123`
- Source: migrated from `.omx/project-memory.json`.

## Model Gateway

- External model gateway container used in recent Docker verification:
  `1Panel-new-api-6d1F`.
- It has been attached as `model-gateway` for Docker-stack model calls.
- Before assuming model calls work inside Docker, verify network attachment and
  DNS resolution from the LangGraph/container network.
- Source: migrated from `.omx/project-memory.json` and `.omx/notepad.md`.

## Historical Host-Run Dev Stack

- `.omx/notepad.md` recorded a host-run dev stack:
  - `make dev` on `localhost:3000`
  - gateway `8001`
  - LangGraph `2024`
  - OpenPencil `3001`
- Treat this as historical context. When the task asks for current-code
  container verification, prefer the canonical Docker guidance in
  [memory/directives/testing-and-verification.md](/root/project/ai/deer-flow/memory/directives/testing-and-verification.md).
