# Standalone customer-support demo container.
#
# This image intentionally stays separate from the main app image so real-user
# SDK testing can run on :8084 without being coupled to the workspace/frontend
# deploy path.
FROM node:22-alpine

ARG PNPM_STORE_PATH=/root/.local/share/pnpm/store

RUN corepack enable && corepack install -g pnpm@10.26.2
RUN pnpm config set store-dir ${PNPM_STORE_PATH}

WORKDIR /app

# Install only the demo package dependencies first so rebuilds reuse the layer
# while the shared app source continues to be copied in the next step.
COPY frontend/demo/package.json frontend/demo/pnpm-lock.yaml /app/frontend/demo/
RUN /bin/sh -lc "cd /app/frontend/demo && pnpm install --frozen-lockfile"

# The demo resolves shared runtime helpers through ../app/src aliases.
COPY frontend/demo /app/frontend/demo
COPY frontend/app/src /app/frontend/app/src

# The standalone demo intentionally reuses slices of `frontend/app/src`.
# Node resolution for files under `/app/frontend/app/src` walks upward through
# `/app/frontend/app/node_modules`, not `/app/frontend/demo/node_modules`, so
# we provide the shared source tree a stable module path instead of duplicating
# a second install just for the borrowed helpers.
RUN mkdir -p /app/frontend/app \
 && ln -s /app/frontend/demo/node_modules /app/frontend/app/node_modules

WORKDIR /app/frontend/demo

EXPOSE 8084

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "8084", "--strictPort"]
