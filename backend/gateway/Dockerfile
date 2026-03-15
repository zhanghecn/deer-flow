# Gateway Development Dockerfile
FROM golang:1.23-bookworm

WORKDIR /app

# LibreOffice powers `/artifacts/*?preview=pdf` for Office documents.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    libreoffice-core \
    libreoffice-common \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-dejavu \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Allow the builder to honor the Go toolchain version declared in go.mod.
ENV GOTOOLCHAIN=auto
ENV GOPROXY=https://goproxy.cn,direct

# Copy gateway source code
COPY backend/gateway ./backend/gateway

# Download dependencies
RUN sh -c "cd /app/backend/gateway && go mod download"

# Build the gateway binary during image creation so container startup does not
# depend on `go run` recompilation.
RUN sh -c "cd /app/backend/gateway && go build -o /usr/local/bin/openagents-gateway ./cmd/server"

EXPOSE 8001

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "cd /app/backend/gateway && GATEWAY_CONFIG_PATH=gateway.yaml /usr/local/bin/openagents-gateway"]
