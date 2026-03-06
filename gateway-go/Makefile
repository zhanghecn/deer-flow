# 声明伪目标（不生成实际文件的目标）
.PHONY: build run test clean migrate

# 构建：编译 Go 项目，输出到 bin/gateway
build:
	go build -o bin/gateway ./cmd/server

# 运行：直接运行 Go 程序（不生成可执行文件）
run:
	go run ./cmd/server

# 测试：运行所有测试用例
test:
	go test ./...

# 清理：删除编译生成的 bin/ 目录
clean:
	rm -rf bin/

# 数据库迁移：遍历 migrations/ 目录下的所有 .sql 文件，使用 psql 依次执行
migrate:
	@echo "Running migrations..."
	@for f in migrations/*.sql; do \
		echo "Applying $$f..."; \
		psql "$(DATABASE_URL)" -f "$$f"; \
	done
	@echo "Migrations complete."
