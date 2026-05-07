# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS frontend-builder

ARG PNPM_STORE_PATH=/root/.local/share/pnpm/store
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG VITE_DEMO_PUBLIC_API_BASE_URL=
ARG VITE_DEMO_PUBLIC_API_KEY=
ARG VITE_DEMO_DEFAULT_AGENT_NAME=
ARG VITE_DEMO_HTTP_AGENT_NAME=
ARG VITE_DEMO_HTTP_API_KEY=
ARG VITE_DEMO_WORKBENCH_BASE_URL=http://127.0.0.1:8084
ARG VITE_DEMO_MESSAGE_TRACE_DISPLAY_MODE=debug

# Vite bakes public configuration at build time, so compose forwards the demo
# env file as build args instead of relying on container runtime env injection.
ENV npm_config_registry=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
ENV VITE_DEMO_PUBLIC_API_BASE_URL=${VITE_DEMO_PUBLIC_API_BASE_URL}
ENV VITE_DEMO_PUBLIC_API_KEY=${VITE_DEMO_PUBLIC_API_KEY}
ENV VITE_DEMO_DEFAULT_AGENT_NAME=${VITE_DEMO_DEFAULT_AGENT_NAME}
ENV VITE_DEMO_HTTP_AGENT_NAME=${VITE_DEMO_HTTP_AGENT_NAME}
ENV VITE_DEMO_HTTP_API_KEY=${VITE_DEMO_HTTP_API_KEY}
ENV VITE_DEMO_WORKBENCH_BASE_URL=${VITE_DEMO_WORKBENCH_BASE_URL}
ENV VITE_DEMO_MESSAGE_TRACE_DISPLAY_MODE=${VITE_DEMO_MESSAGE_TRACE_DISPLAY_MODE}

RUN corepack enable && corepack install -g pnpm@10.26.2
RUN pnpm config set store-dir ${PNPM_STORE_PATH} \
    && pnpm config set registry ${NPM_REGISTRY}

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

EXPOSE 8084
