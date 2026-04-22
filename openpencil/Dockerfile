# ── Stage 1: Build web app ──
ARG BUN_VERSION=1.3.10

FROM oven/bun:${BUN_VERSION} AS builder

WORKDIR /app
ENV OPENPENCIL_BASE_PATH=/openpencil
# Keep the builder input simple: copy the vendored repo tree once and rely on
# `.dockerignore` to strip build outputs and local caches. This avoids brittle
# per-file COPY failures when operators sync the repository onto different
# filesystems or BuildKit computes checksums for nested package manifests.
COPY . .
# Fail with a direct repository-shape error before spending minutes on package
# resolution when the vendored OpenPencil tree is incomplete on the operator's
# machine.
RUN test -d apps/web && test -f apps/web/package.json
# Docker currently resolves this workspace with the image's Bun version, so do
# not freeze the lockfile inside the container build.
RUN bun install
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN bun --bun run build

# ── Stage 2: Base (web only, no CLI) ──
FROM oven/bun:${BUN_VERSION}-slim AS base

WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
ENV OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

# ── CLI variants ──

FROM oven/bun:${BUN_VERSION} AS with-claude
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @anthropic-ai/claude-code
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

FROM oven/bun:${BUN_VERSION} AS with-codex
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @openai/codex
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

FROM oven/bun:${BUN_VERSION} AS with-opencode
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g opencode-ai
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

FROM oven/bun:${BUN_VERSION} AS with-copilot
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @github/copilot
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

FROM oven/bun:${BUN_VERSION} AS with-gemini
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @google/gemini-cli
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

# ── Full: all CLI tools ──
FROM oven/bun:${BUN_VERSION} AS full
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @anthropic-ai/claude-code @openai/codex opencode-ai @github/copilot @google/gemini-cli
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]
