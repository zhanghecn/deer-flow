# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ARG APT_DEBIAN_MIRROR=http://mirrors.aliyun.com/debian
ARG APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Demo rebuilds pull from public PyPI during local debugging. Longer pip
# network tolerances prevent transient metadata timeouts from surfacing as
# misleading dependency-resolution failures.
ENV PIP_DEFAULT_TIMEOUT=120
ENV PIP_RETRIES=10
ENV PIP_CACHE_DIR=/root/.cache/pip
ENV PIP_INDEX_URL=${PIP_INDEX_URL}

WORKDIR /app

COPY frontend/demo/mcp-file-service/requirements.txt /app/requirements.txt
# Demo release builds often run on fresh hosts. Configure apt before update so
# the OCR system packages use the same mirror policy as Python packages.
RUN sed -i \
        -e "s|http://deb.debian.org/debian|${APT_DEBIAN_MIRROR}|g" \
        -e "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
        -e "s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-dejavu-core \
        tesseract-ocr \
        tesseract-ocr-chi-sim \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
# Keep Python dependencies inside the image. The cache mount only accelerates
# repeated local rebuilds; production should still pull a prebuilt image rather
# than bind-mount host site-packages into the container.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r /app/requirements.txt

COPY frontend/demo/mcp-file-service /app

EXPOSE 8090

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
