# Gateway Development Dockerfile
FROM golang:1.23-bookworm

WORKDIR /app

# 国内环境里 Debian 官方源经常是构建最慢的一段，这里只改 apt 镜像源，
# 不改 Gateway 现有依赖集合，避免影响 Office 预览能力。
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
