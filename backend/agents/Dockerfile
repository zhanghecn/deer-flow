# Backend Development Dockerfile
FROM python:3.12-slim-bookworm

ARG UV_PACKAGE_INDEX="https://mirrors.ustc.edu.cn/pypi/simple"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv from the package index instead of the standalone installer so the
# build stays on a single mirror-backed path and does not depend on GitHub
# Releases being reachable from the Docker builder.
ENV VIRTUAL_ENV="/opt/venv" \
    UV_PROJECT_ENVIRONMENT="/opt/venv" \
    UV_DEFAULT_INDEX="${UV_PACKAGE_INDEX}" \
    UV_LINK_MODE="copy" \
    PIP_INDEX_URL="${UV_PACKAGE_INDEX}" \
    PATH="/opt/venv/bin:/root/.local/bin:$PATH" \
    PYTHONUNBUFFERED="1"

RUN python -m pip install --no-cache-dir uv

# Set working directory
WORKDIR /app

# Install third-party dependencies in a cache-friendly layer first. The local
# `deepagents` path dependency and the OpenAgents project itself are synced only
# after source code is copied so normal code edits do not invalidate the whole
# dependency layer.
COPY backend/agents/pyproject.toml ./backend/agents/pyproject.toml
COPY backend/agents/uv.lock ./backend/agents/uv.lock
COPY backend/agents/README.md ./backend/agents/README.md
COPY backend/deepagents/libs/deepagents/pyproject.toml ./backend/deepagents/libs/deepagents/pyproject.toml
COPY backend/deepagents/libs/deepagents/README.md ./backend/deepagents/libs/deepagents/README.md
RUN --mount=type=cache,target=/root/.cache/uv \
    sh -c "cd backend/agents && uv sync --frozen --no-dev --no-install-project --no-install-package deepagents"

# Copy runtime sources. `deepagents` is a local editable dependency declared
# from `backend/agents/pyproject.toml`.
COPY backend/deepagents ./backend/deepagents
COPY backend/agents ./backend/agents

# Install the project and local editable dependency outside the source tree so
# bind-mounted source updates can reuse the prebuilt environment.
RUN --mount=type=cache,target=/root/.cache/uv \
    sh -c "cd backend/agents && uv sync --frozen --no-dev"

EXPOSE 2024

# Default command keeps the image usable outside compose without re-syncing the
# environment at container startup.
CMD ["sh", "-c", "cd backend/agents && python -m src.langgraph_dev"]
