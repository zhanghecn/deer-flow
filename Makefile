# OpenAgents - Unified Development Environment

.PHONY: help config check install dev stop clean docker-init docker-start docker-infra-start docker-stop docker-infra-stop docker-status docker-verify docker-logs docker-logs-nginx docker-logs-gateway docker-prod-config docker-prod-build docker-prod-start docker-prod-stop docker-prod-restart docker-prod-status docker-prod-verify docker-prod-logs docker-model-gateway-attach gateway-build docker-prod-preflight demo-start demo-stop demo-status

GO_TOOLCHAIN ?= auto
HOST_LOG_DIR := $(CURDIR)/.openagents/host-logs
# OpenPencil now lives inside this repository so local dev and Docker builds
# use the same source tree instead of drifting from a sibling checkout.
OPENPENCIL_DIR := $(abspath $(CURDIR)/openpencil)
# External model gateways live outside the OpenAgents compose file. Operators
# can attach one existing container to the shared bridge network and keep a
# stable in-cluster DNS name for model records such as `http://model-gateway:3000`.
MODEL_GATEWAY_CONTAINER ?=
MODEL_GATEWAY_NETWORK ?= openagents-prod_openagents
MODEL_GATEWAY_ALIAS ?= model-gateway

help:
	@echo "OpenAgents Development Commands:"
	@echo "  make config          - Generate local config files (aborts if config already exists)"
	@echo "  make check           - Check if all required tools are installed"
	@echo "  make install         - Install all dependencies (frontend app + frontend admin + agents + gateway)"
	@echo "  make gateway-build   - Build Go gateway binary"
	@echo "  make setup-sandbox   - Pre-pull sandbox container image (recommended)"
	@echo "  make dev             - Start all services (frontend + backend + gateway + nginx + optional OpenPencil)"
	@echo "  make stop            - Stop all running services"
	@echo "  make clean           - Clean up processes and temporary files"
	@echo ""
	@echo "Docker Development Commands:"
	@echo "  make docker-init     - Pull the shared sandbox image"
	@echo "  make docker-start    - Start the unified Docker compose stack (app on localhost:8083)"
	@echo "  make docker-infra-start - Start local debug infra only (sandbox-aio + onlyoffice)"
	@echo "  make docker-stop     - Stop Docker services"
	@echo "  make docker-infra-stop - Stop local debug infra only"
	@echo "  make docker-status   - Show Docker compose status"
	@echo "  make docker-verify   - Wait for services and verify HTTP entrypoints"
	@echo "  make docker-logs     - View Docker logs"
	@echo "  make docker-logs-nginx - View Docker nginx logs"
	@echo "  make docker-logs-gateway - View Docker gateway logs"
	@echo "  make docker-model-gateway-attach MODEL_GATEWAY_CONTAINER=<container> - Attach an external model gateway container to the shared Docker network"
	@echo ""
	@echo "Demo Commands:"
	@echo "  make demo-start     - Start the demo stack with one command"
	@echo "  make demo-stop      - Stop the demo stack"
	@echo "  make demo-status    - Show demo stack status"
	@echo ""
	@echo "Docker Production Commands:"
	@echo "  make docker-prod-build   - Direct docker compose build for production"
	@echo "  make docker-prod-start   - Build, start, and verify the production-style stack"
	@echo "  make docker-prod-stop    - Direct docker compose down for production"
	@echo "  make docker-prod-status  - Show production-style stack status"
	@echo "  make docker-prod-verify  - Verify production-style stack readiness"
	@echo "  make docker-prod-logs    - Direct docker compose logs for production"

config:
	@if [ -f config.yaml ] || [ -f config.yml ] || [ -f configure.yml ]; then \
		echo "Error: configuration file already exists (config.yaml/config.yml/configure.yml). Aborting."; \
		exit 1; \
	fi
	@cp config.example.yaml config.yaml
	@test -f .env || printf "# Secrets only.\nDATABASE_URI=\nJWT_SECRET=\n" > .env

# Check required tools
check:
	@echo "=========================================="
	@echo "  Checking Required Dependencies"
	@echo "=========================================="
	@echo ""
	@FAILED=0; \
	echo "Checking Node.js..."; \
	if command -v node >/dev/null 2>&1; then \
		NODE_VERSION=$$(node -v | sed 's/v//'); \
		NODE_MAJOR=$$(echo $$NODE_VERSION | cut -d. -f1); \
		if [ $$NODE_MAJOR -ge 22 ]; then \
			echo "  ✓ Node.js $$NODE_VERSION (>= 22 required)"; \
		else \
			echo "  ✗ Node.js $$NODE_VERSION found, but version 22+ is required"; \
			echo "    Install from: https://nodejs.org/"; \
			FAILED=1; \
		fi; \
	else \
		echo "  ✗ Node.js not found (version 22+ required)"; \
		echo "    Install from: https://nodejs.org/"; \
		FAILED=1; \
	fi; \
	echo ""; \
	echo "Checking pnpm..."; \
	if command -v pnpm >/dev/null 2>&1; then \
		PNPM_VERSION=$$(pnpm -v); \
		echo "  ✓ pnpm $$PNPM_VERSION"; \
	else \
		echo "  ✗ pnpm not found"; \
		echo "    Install: npm install -g pnpm"; \
		echo "    Or visit: https://pnpm.io/installation"; \
		FAILED=1; \
	fi; \
	echo ""; \
	echo "Checking uv..."; \
	if command -v uv >/dev/null 2>&1; then \
		UV_VERSION=$$(uv --version | awk '{print $$2}'); \
		echo "  ✓ uv $$UV_VERSION"; \
	else \
		echo "  ✗ uv not found"; \
		echo "    Install: curl -LsSf https://astral.sh/uv/install.sh | sh"; \
		echo "    Or visit: https://docs.astral.sh/uv/getting-started/installation/"; \
		FAILED=1; \
	fi; \
	echo ""; \
	echo "Checking Go..."; \
	if command -v go >/dev/null 2>&1; then \
		GO_VERSION=$$(go version | awk '{print $$3}' | sed 's/go//'); \
		echo "  ✓ Go $$GO_VERSION"; \
	else \
		echo "  ✗ Go not found (version 1.23+ required)"; \
		echo "    Install from: https://go.dev/dl/"; \
		FAILED=1; \
	fi; \
	echo ""; \
	echo "Checking nginx..."; \
	if command -v nginx >/dev/null 2>&1; then \
		NGINX_VERSION=$$(nginx -v 2>&1 | awk -F'/' '{print $$2}'); \
		echo "  ✓ nginx $$NGINX_VERSION"; \
	else \
		echo "  ✗ nginx not found"; \
		echo "    macOS:   brew install nginx"; \
		echo "    Ubuntu:  sudo apt install nginx"; \
		echo "    Or visit: https://nginx.org/en/download.html"; \
		FAILED=1; \
	fi; \
	echo ""; \
	if [ $$FAILED -eq 0 ]; then \
		echo "=========================================="; \
		echo "  ✓ All dependencies are installed!"; \
		echo "=========================================="; \
		echo ""; \
		echo "You can now run:"; \
		echo "  make install  - Install project dependencies"; \
		echo "  make dev      - Start development server"; \
	else \
		echo "=========================================="; \
		echo "  ✗ Some dependencies are missing"; \
		echo "=========================================="; \
		echo ""; \
		echo "Please install the missing tools and run 'make check' again."; \
		exit 1; \
	fi

# Build Go gateway
gateway-build:
	@echo "Building Go gateway..."
	@cd backend/gateway && GOTOOLCHAIN=$(GO_TOOLCHAIN) go build -o bin/gateway ./cmd/server
	@echo "✓ Go gateway built"

# Install all dependencies
install:
	@echo "Installing agents dependencies..."
	@cd backend/agents && uv sync
	@echo "Installing Go gateway dependencies..."
	@cd backend/gateway && go mod download
	@echo "Installing frontend app dependencies..."
	@cd frontend/app && pnpm install
	@echo "Installing frontend admin dependencies..."
	@cd frontend/admin && pnpm install
	@echo "✓ All dependencies installed"
	@echo ""
	@echo "=========================================="
	@echo "  Optional: Pre-pull Sandbox Image"
	@echo "=========================================="
	@echo ""
	@echo "If you plan to use Docker/Container-based sandbox, you can pre-pull the image:"
	@echo "  make setup-sandbox"
	@echo ""

# Pre-pull sandbox Docker image (optional but recommended)
setup-sandbox:
	@echo "=========================================="
	@echo "  Pre-pulling Sandbox Container Image"
	@echo "=========================================="
	@echo ""
	@IMAGE=$$(grep -A 20 "# sandbox:" config.yaml 2>/dev/null | grep "image:" | awk '{print $$2}' | head -1); \
	if [ -z "$$IMAGE" ]; then \
		IMAGE="enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest"; \
		echo "Using default image: $$IMAGE"; \
	else \
		echo "Using configured image: $$IMAGE"; \
	fi; \
	echo ""; \
	if command -v container >/dev/null 2>&1 && [ "$$(uname)" = "Darwin" ]; then \
		echo "Detected Apple Container on macOS, pulling image..."; \
		container pull "$$IMAGE" || echo "⚠ Apple Container pull failed, will try Docker"; \
	fi; \
	if command -v docker >/dev/null 2>&1; then \
		echo "Pulling image using Docker..."; \
		docker pull "$$IMAGE"; \
		echo ""; \
		echo "✓ Sandbox image pulled successfully"; \
	else \
		echo "✗ Neither Docker nor Apple Container is available"; \
		echo "  Please install Docker: https://docs.docker.com/get-docker/"; \
		exit 1; \
	fi

# Start all services.
# OpenPencil is vendored into this repository and must bind 3001 in host-run
# development so nginx preserves the same-origin `/openpencil` bridge contract.
dev:
	@echo "Stopping existing services if any..."
	@-pkill -f "langgraph dev" 2>/dev/null || true
	@-pkill -f "langgraph_api.cli" 2>/dev/null || true
	@-pkill -f "backend/gateway/bin/gateway" 2>/dev/null || true
	@-pkill -f "uvicorn src.gateway.app:app" 2>/dev/null || true
	@-sh -c 'frontend_pids=$$(lsof -ti :3000 2>/dev/null); [ -z "$$frontend_pids" ] || kill $$frontend_pids 2>/dev/null || true'
	@-sh -c 'openpencil_pids=$$(lsof -ti :3001 2>/dev/null); [ -z "$$openpencil_pids" ] || kill $$openpencil_pids 2>/dev/null || true'
	@-nginx -c $(PWD)/docker/nginx/nginx.local.conf -p $(PWD) -s quit 2>/dev/null || true
	@sleep 1
	@-pkill -9 nginx 2>/dev/null || true
	@-./scripts/cleanup-containers.sh openagents-sandbox 2>/dev/null || true
	@sleep 1
	@echo ""
	@echo "=========================================="
	@echo "  Starting OpenAgents Development Server"
	@echo "=========================================="
	@echo ""
	@echo "Services starting up..."
	@echo "  → Backend: LangGraph Server"
	@echo "  → Gateway: Go Gateway"
	@echo "  → Frontend: Vite"
	@echo "  → OpenPencil: Vite (vendored project)"
	@echo "  → Nginx: Reverse Proxy"
	@echo ""
	@cleanup() { \
		trap - INT TERM; \
		echo ""; \
		echo "Shutting down services..."; \
		pkill -f "langgraph dev" 2>/dev/null || true; \
		pkill -f "langgraph_api.cli" 2>/dev/null || true; \
		pkill -f "backend/gateway/bin/gateway" 2>/dev/null || true; \
		pkill -f "uvicorn src.gateway.app:app" 2>/dev/null || true; \
		frontend_pids=$$(lsof -ti :3000 2>/dev/null); [ -z "$$frontend_pids" ] || kill $$frontend_pids 2>/dev/null || true; \
		openpencil_pids=$$(lsof -ti :3001 2>/dev/null); [ -z "$$openpencil_pids" ] || kill $$openpencil_pids 2>/dev/null || true; \
		nginx -c $(PWD)/docker/nginx/nginx.local.conf -p $(PWD) -s quit 2>/dev/null || true; \
		sleep 1; \
		pkill -9 nginx 2>/dev/null || true; \
		echo "Cleaning up sandbox containers..."; \
		./scripts/cleanup-containers.sh openagents-sandbox 2>/dev/null || true; \
		echo "✓ All services stopped"; \
		exit 0; \
	}; \
	trap cleanup INT TERM; \
	mkdir -p $(HOST_LOG_DIR); \
	echo "Starting LangGraph server..."; \
	cd $(PWD)/backend/agents && NO_COLOR=1 uv run python -m src.langgraph_dev > $(HOST_LOG_DIR)/langgraph.log 2>&1 & \
	sleep 3; \
	echo "✓ LangGraph server started on localhost:2024"; \
	echo "Building Go Gateway..."; \
	cd $(PWD)/backend/gateway && GOTOOLCHAIN=$(GO_TOOLCHAIN) go build -o bin/gateway ./cmd/server 2> $(HOST_LOG_DIR)/gateway-build.log; \
	if [ $$? -ne 0 ]; then \
		echo "✗ Go Gateway build failed. See $(HOST_LOG_DIR)/gateway-build.log"; \
		tail -30 $(HOST_LOG_DIR)/gateway-build.log; \
		cleanup; \
	fi; \
	echo "Starting Go Gateway..."; \
	cd $(PWD)/backend/gateway && GATEWAY_CONFIG_PATH=gateway.yaml ./bin/gateway > $(HOST_LOG_DIR)/gateway.log 2>&1 & \
	sleep 2; \
	if ! lsof -i :8001 -sTCP:LISTEN -t >/dev/null 2>&1; then \
		echo "✗ Go Gateway failed to start. Last log output:"; \
		tail -30 $(HOST_LOG_DIR)/gateway.log; \
		cleanup; \
	fi; \
	echo "✓ Go Gateway started on localhost:8001"; \
	echo "Starting Frontend..."; \
	cd $(PWD)/frontend/app && pnpm run dev > $(HOST_LOG_DIR)/frontend.log 2>&1 & \
	sleep 3; \
	echo "✓ Frontend started on localhost:3000"; \
	if [ -d "$(OPENPENCIL_DIR)" ]; then \
		if command -v bun >/dev/null 2>&1; then \
			echo "Starting OpenPencil..."; \
			cd $(OPENPENCIL_DIR) && bun run dev > $(HOST_LOG_DIR)/openpencil.log 2>&1 & \
			openpencil_started=0; \
			for _ in 1 2 3 4 5 6; do \
				sleep 2; \
				if lsof -i :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then \
					openpencil_started=1; \
					break; \
				fi; \
			done; \
			if [ $$openpencil_started -eq 1 ]; then \
				echo "✓ OpenPencil started on localhost:3001"; \
			else \
				echo "! OpenPencil did not start on localhost:3001. See $(HOST_LOG_DIR)/openpencil.log"; \
				tail -30 $(HOST_LOG_DIR)/openpencil.log 2>/dev/null || true; \
			fi; \
		else \
			echo "! bun not found, skipping vendored OpenPencil dev server"; \
		fi; \
	else \
		echo "! $(OPENPENCIL_DIR) not found, vendored OpenPencil copy is missing"; \
	fi; \
	if command -v nginx >/dev/null 2>&1; then \
		echo "Starting Nginx reverse proxy..."; \
		mkdir -p $(HOST_LOG_DIR) && nginx -g 'daemon off;' -c $(PWD)/docker/nginx/nginx.local.conf -p $(PWD) > $(HOST_LOG_DIR)/nginx.log 2>&1 & \
		sleep 2; \
		echo "✓ Nginx started on localhost:2026"; \
	else \
		echo "! nginx not found, skipping reverse proxy"; \
	fi; \
	echo ""; \
	echo "=========================================="; \
	echo "  OpenAgents is ready!"; \
	echo "=========================================="; \
	echo ""; \
	if command -v nginx >/dev/null 2>&1; then \
		echo "  🌐 Application: http://localhost:2026"; \
		echo "  📡 Go Gateway:  http://localhost:2026/api/*"; \
		echo "  🤖 LangGraph:   http://localhost:2026/api/langgraph/*"; \
	else \
		echo "  🌐 Application: http://localhost:3000"; \
		echo "  📡 Go Gateway:  http://localhost:8001"; \
		echo "  🤖 LangGraph:   http://localhost:2024"; \
	fi; \
	echo ""; \
	echo "  📋 Logs:"; \
	echo "     - LangGraph: $(HOST_LOG_DIR)/langgraph.log"; \
	echo "     - Gateway:   $(HOST_LOG_DIR)/gateway.log"; \
	echo "     - Frontend:  $(HOST_LOG_DIR)/frontend.log"; \
	if [ -f "$(HOST_LOG_DIR)/openpencil.log" ]; then \
		echo "     - OpenPencil: $(HOST_LOG_DIR)/openpencil.log"; \
	fi; \
	if command -v nginx >/dev/null 2>&1; then \
		echo "     - Nginx:     $(HOST_LOG_DIR)/nginx.log"; \
	fi; \
	echo ""; \
	echo "Press Ctrl+C to stop all services"; \
	echo ""; \
	wait

# Stop all services
stop:
	@echo "Stopping all services..."
	@-pkill -f "langgraph dev" 2>/dev/null || true
	@-pkill -f "backend/gateway/bin/gateway" 2>/dev/null || true
	@-pkill -f "uvicorn src.gateway.app:app" 2>/dev/null || true
	@-sh -c 'frontend_pids=$$(lsof -ti :3000 2>/dev/null); [ -z "$$frontend_pids" ] || kill $$frontend_pids 2>/dev/null || true'
	@-sh -c 'openpencil_pids=$$(lsof -ti :3001 2>/dev/null); [ -z "$$openpencil_pids" ] || kill $$openpencil_pids 2>/dev/null || true'
	@-nginx -c $(PWD)/docker/nginx/nginx.local.conf -p $(PWD) -s quit 2>/dev/null || true
	@sleep 1
	@-pkill -9 nginx 2>/dev/null || true
	@echo "Cleaning up sandbox containers..."
	@-./scripts/cleanup-containers.sh openagents-sandbox 2>/dev/null || true
	@echo "✓ All services stopped"

# Clean up
clean: stop
	@echo "Cleaning up..."
	@-rm -rf $(HOST_LOG_DIR)/*.log 2>/dev/null || true
	@-rm -rf logs/*.log 2>/dev/null || true
	@echo "✓ Cleanup complete"

# ==========================================
# Docker Development Commands
# ==========================================

# Initialize Docker containers and install dependencies
docker-init:
	@./scripts/docker.sh init

# Start Docker development environment
docker-start:
	@./scripts/docker.sh start

# Start Docker local debug infrastructure only
docker-infra-start:
	@./scripts/docker.sh infra-start

# Stop Docker development environment
docker-stop:
	@./scripts/docker.sh stop

# Stop Docker local debug infrastructure only
docker-infra-stop:
	@./scripts/docker.sh infra-stop

# Show Docker compose status
docker-status:
	@./scripts/docker.sh status

# Verify Docker compose readiness and public entrypoints
docker-verify:
	@./scripts/docker.sh verify

# View Docker logs
docker-logs:
	@./scripts/docker.sh logs

# View Docker nginx logs
docker-logs-nginx:
	@./scripts/docker.sh logs --nginx
docker-logs-gateway:
	@./scripts/docker.sh logs --gateway

# External model gateways are managed outside this repo, so the attach step
# stays explicit instead of hiding docker-socket mutations inside compose.
docker-model-gateway-attach:
	@if [ -z "$(MODEL_GATEWAY_CONTAINER)" ]; then \
		echo "MODEL_GATEWAY_CONTAINER is required, e.g. make docker-model-gateway-attach MODEL_GATEWAY_CONTAINER=1Panel-new-api-6d1F"; \
		exit 1; \
	fi
	@if ! docker inspect "$(MODEL_GATEWAY_CONTAINER)" >/dev/null 2>&1; then \
		echo "Container not found: $(MODEL_GATEWAY_CONTAINER)"; \
		exit 1; \
	fi
	@if ! docker network inspect "$(MODEL_GATEWAY_NETWORK)" >/dev/null 2>&1; then \
		echo "Docker network not found: $(MODEL_GATEWAY_NETWORK)"; \
		exit 1; \
	fi
	@if docker inspect "$(MODEL_GATEWAY_CONTAINER)" --format '{{json .NetworkSettings.Networks}}' | grep -q '"$(MODEL_GATEWAY_NETWORK)"'; then \
		echo "Container $(MODEL_GATEWAY_CONTAINER) is already attached to $(MODEL_GATEWAY_NETWORK)."; \
	else \
		docker network connect --alias "$(MODEL_GATEWAY_ALIAS)" "$(MODEL_GATEWAY_NETWORK)" "$(MODEL_GATEWAY_CONTAINER)"; \
		echo "Attached $(MODEL_GATEWAY_CONTAINER) to $(MODEL_GATEWAY_NETWORK) with alias $(MODEL_GATEWAY_ALIAS)."; \
	fi
	@echo "Model records should use base_url=http://$(MODEL_GATEWAY_ALIAS):3000"

docker-prod-config:
	@cd docker && docker compose --env-file ../.env -p openagents-prod -f docker-compose-prod.yaml config

docker-prod-preflight:
	@# The vendored OpenPencil tree is now part of the default prod stack, so
	@# fail early with a concrete message instead of letting Docker error out on
	@# a missing COPY source deep inside the image build.
	@test -f openpencil/Dockerfile || (echo "Missing vendored OpenPencil Dockerfile: openpencil/Dockerfile"; exit 1)
	@test -f openpencil/apps/web/package.json || (echo "Missing vendored OpenPencil web app entry: openpencil/apps/web/package.json"; exit 1)

docker-prod-build:
	@$(MAKE) docker-prod-preflight
	@cd docker && docker compose --env-file ../.env -p openagents-prod -f docker-compose-prod.yaml build nginx openpencil gateway langgraph sandbox-aio onlyoffice

docker-prod-start:
	@./scripts/docker.sh start

docker-prod-stop:
	@cd docker && docker compose --env-file ../.env -p openagents-prod -f docker-compose-prod.yaml down

docker-prod-restart:
	@./scripts/docker.sh restart

docker-prod-status:
	@./scripts/docker.sh status

docker-prod-verify:
	@./scripts/docker.sh verify

docker-prod-logs:
	@cd docker && docker compose --env-file ../.env -p openagents-prod -f docker-compose-prod.yaml logs -f

demo-start:
	@./scripts/demo.sh start

demo-stop:
	@./scripts/demo.sh stop

demo-status:
	@./scripts/demo.sh status
