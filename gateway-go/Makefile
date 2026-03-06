.PHONY: build run test clean migrate

build:
	go build -o bin/gateway ./cmd/server

run:
	go run ./cmd/server

test:
	go test ./...

clean:
	rm -rf bin/

migrate:
	@echo "Running migrations..."
	@for f in migrations/*.sql; do \
		echo "Applying $$f..."; \
		psql "$(DATABASE_URL)" -f "$$f"; \
	done
	@echo "Migrations complete."
