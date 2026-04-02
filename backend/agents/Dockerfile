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
    PIP_INDEX_URL="${UV_PACKAGE_INDEX}" \
    PATH="/opt/venv/bin:/root/.local/bin:$PATH" \
    PYTHONUNBUFFERED="1"

RUN python -m pip install --no-cache-dir uv

# Set working directory
WORKDIR /app

# Copy runtime sources. `deepagents` is a local editable dependency declared
# from `backend/agents/pyproject.toml`.
COPY backend/deepagents ./backend/deepagents
COPY backend/agents ./backend/agents

# Install dependencies outside the source tree so bind mounts do not mask the
# environment at runtime.
RUN --mount=type=cache,target=/root/.cache/uv \
    sh -c "cd backend/agents && uv sync --frozen --no-dev"

EXPOSE 2024

# Default command keeps Docker aligned with the supported local dev entrypoint.
CMD ["sh", "-c", "cd backend/agents && uv run python -m src.langgraph_dev"]
