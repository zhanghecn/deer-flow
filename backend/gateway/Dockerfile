# Gateway Development Dockerfile
FROM golang:1.23-alpine

WORKDIR /app

# Copy gateway source code
COPY backend/gateway ./backend/gateway

# Download dependencies
RUN sh -c "cd /app/backend/gateway && go mod download"

EXPOSE 8001

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "cd /app/backend/gateway && GATEWAY_CONFIG_PATH=gateway.yaml go run ./cmd/server"]
