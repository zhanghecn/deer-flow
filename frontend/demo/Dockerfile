# syntax=docker/dockerfile:1.7
FROM node:22-alpine

ARG PNPM_STORE_PATH=/root/.local/share/pnpm/store

RUN corepack enable && corepack install -g pnpm@10.26.2
RUN pnpm config set store-dir ${PNPM_STORE_PATH}

WORKDIR /app

COPY frontend/demo/package.json frontend/demo/pnpm-lock.yaml /app/frontend/demo/
# Like the Python service, keep runtime dependencies baked into the image. The
# cache mount only reuses the package store across local rebuilds.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    /bin/sh -lc "cd /app/frontend/demo && pnpm install --frozen-lockfile"

COPY frontend/demo /app/frontend/demo

WORKDIR /app/frontend/demo

EXPOSE 8084

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "8084", "--strictPort"]
