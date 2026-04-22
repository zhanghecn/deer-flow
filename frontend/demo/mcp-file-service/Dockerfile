# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Demo rebuilds pull from public PyPI during local debugging. Longer pip
# network tolerances prevent transient metadata timeouts from surfacing as
# misleading dependency-resolution failures.
ENV PIP_DEFAULT_TIMEOUT=120
ENV PIP_RETRIES=10
ENV PIP_CACHE_DIR=/root/.cache/pip

WORKDIR /app

COPY frontend/demo/mcp-file-service/requirements.txt /app/requirements.txt
# Keep Python dependencies inside the image. The cache mount only accelerates
# repeated local rebuilds; production should still pull a prebuilt image rather
# than bind-mount host site-packages into the container.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r /app/requirements.txt

COPY frontend/demo/mcp-file-service /app

EXPOSE 8090

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
