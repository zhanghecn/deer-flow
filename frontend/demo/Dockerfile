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

COPY package.json pnpm-lock.yaml ./
# Keep runtime dependencies baked into the image; the cache mount only reuses
# the package store across local rebuilds.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

EXPOSE 8084

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "8084", "--strictPort"]
