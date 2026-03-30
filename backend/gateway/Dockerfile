# syntax=docker/dockerfile:1.7

# Gateway image is used by both docker dev and production compose.
# Keep the Go build and the runtime dependencies in separate stages so code
# changes do not force Docker to rebuild the Office conversion layer.
FROM golang:1.23-bookworm AS gateway-builder

WORKDIR /app/backend/gateway

# The build runs in CN-hosted environments often enough that the default Debian
# mirror becomes the main source of Docker build stalls. Repoint apt to TUNA so
# the image keeps the same packages while downloading them from a closer mirror.
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i \
        -e 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
        -e 's|http://deb.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        -e 's|http://security.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
        sed -i \
        -e 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
        -e 's|http://deb.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        -e 's|http://security.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        /etc/apt/sources.list; \
    fi

# Go modules may still need git when the proxy falls back to direct VCS access.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Honor the Go toolchain declared in go.mod and keep the China-friendly proxy.
ENV GOTOOLCHAIN=auto
ENV GOPROXY=https://goproxy.cn,direct

# Copy module metadata first so `go mod download` keeps its cache when only
# application code changes.
COPY backend/gateway/go.mod backend/gateway/go.sum ./

RUN --mount=type=cache,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,target=/root/.cache/go-build,sharing=locked \
    go mod download

COPY backend/gateway ./

# Build the gateway binary during image creation so container startup does not
# depend on `go run` recompilation.
RUN --mount=type=cache,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,target=/root/.cache/go-build,sharing=locked \
    go build -o /usr/local/bin/openagents-gateway ./cmd/server

FROM debian:bookworm-slim AS gateway-runtime

WORKDIR /app

# Keep runtime package installation on the same mirror as the build stage so
# the large LibreOffice/font layer does not bottleneck on overseas apt traffic.
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i \
        -e 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
        -e 's|http://deb.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        -e 's|http://security.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
        sed -i \
        -e 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' \
        -e 's|http://deb.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        -e 's|http://security.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
        /etc/apt/sources.list; \
    fi

# Gateway still needs `soffice` for Office -> PDF preview generation, but the
# headless `-nogui` packages are enough and install much less than full GUI LO.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libreoffice-common \
    libreoffice-core-nogui \
    libreoffice-writer-nogui \
    libreoffice-calc-nogui \
    libreoffice-impress-nogui \
    fonts-dejavu \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY --from=gateway-builder /usr/local/bin/openagents-gateway /usr/local/bin/openagents-gateway

# Keep a minimal default config path inside the image so `docker run` works
# even without the compose bind mount used by this repository.
COPY backend/gateway/gateway.yaml /app/backend/gateway/gateway.yaml

EXPOSE 8001

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "cd /app/backend/gateway && GATEWAY_CONFIG_PATH=gateway.yaml /usr/local/bin/openagents-gateway"]
