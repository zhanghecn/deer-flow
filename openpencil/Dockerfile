# ── Stage 1: Build web app ──
FROM oven/bun:1 AS builder

WORKDIR /app
ENV OPENPENCIL_BASE_PATH=/openpencil
# Keep the builder input simple: copy the vendored repo tree once and rely on
# `.dockerignore` to strip build outputs and local caches. This avoids brittle
# per-file COPY failures when operators sync the repository onto different
# filesystems or BuildKit computes checksums for nested package manifests.
COPY . .
# Docker currently resolves this workspace with the image's Bun version, so do
# not freeze the lockfile inside the container build.
RUN bun install
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN bun --bun run build

# ── Stage 2: Base (web only, no CLI) ──
FROM oven/bun:1-slim AS base

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

FROM oven/bun:1 AS with-claude
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @anthropic-ai/claude-code
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

FROM oven/bun:1 AS with-codex
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @openai/codex
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

FROM oven/bun:1 AS with-opencode
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g opencode-ai
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

FROM oven/bun:1 AS with-copilot
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @github/copilot
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

FROM oven/bun:1 AS with-gemini
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @google/gemini-cli
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]

# ── Full: all CLI tools ──
FROM oven/bun:1 AS full
WORKDIR /app
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/package.json ./
RUN bun install -g @anthropic-ai/claude-code @openai/codex opencode-ai @github/copilot @google/gemini-cli
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000 OPENPENCIL_BASE_PATH=/openpencil
EXPOSE 3000
CMD ["bun", "run", "./out/web/server/index.mjs"]
