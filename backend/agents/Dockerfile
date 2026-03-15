# Backend Development Dockerfile
FROM python:3.12-slim-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV VIRTUAL_ENV="/opt/venv"
ENV UV_PROJECT_ENVIRONMENT="/opt/venv"
ENV PATH="/opt/venv/bin:/root/.local/bin:$PATH"
ENV PYTHONUNBUFFERED="1"

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
