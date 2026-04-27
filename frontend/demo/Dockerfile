# syntax=docker/dockerfile:1.7
FROM node:22-alpine

ARG PNPM_STORE_PATH=/root/.local/share/pnpm/store
ARG NPM_REGISTRY=https://registry.npmmirror.com

# Keep demo image builds fast on clean release machines while still allowing
# builders to override the registry with --build-arg NPM_REGISTRY=...
ENV npm_config_registry=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}

RUN corepack enable && corepack install -g pnpm@10.26.2
RUN pnpm config set store-dir ${PNPM_STORE_PATH} \
    && pnpm config set registry ${NPM_REGISTRY}

WORKDIR /app

COPY frontend/demo/package.json frontend/demo/pnpm-lock.yaml /app/frontend/demo/
# Like the Python service, keep runtime dependencies baked into the image. The
# cache mount only reuses the package store across local rebuilds.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    /bin/sh -lc "cd /app/frontend/demo && pnpm install --frozen-lockfile"

COPY frontend/demo /app/frontend/demo
# The demo chat page reuses the shared public-api/thread error client from the
# main frontend. Keep that source inside the image so Docker dev serves the same
# module graph that host-side `tsc` checks through the `@` alias.
COPY frontend/app/src /app/frontend/app/src

WORKDIR /app/frontend/demo

EXPOSE 8084

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "8084", "--strictPort"]
