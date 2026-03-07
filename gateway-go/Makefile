# 声明伪目标（不生成实际文件的目标）
.PHONY: build run restart test clean migrate

# 构建：编译 Go 项目，输出到 bin/gateway
build:
	go build -o bin/gateway ./cmd/server

# 运行：直接运行 Go 程序（不生成可执行文件）
run:
	go run ./cmd/server

# 重启：先构建再运行
restart: build run

# 测试：运行所有测试用例
test:
	go test ./...

# 清理：删除编译生成的 bin/ 目录
clean:
	rm -rf bin/

# 数据库迁移：使用 golang-migrate 执行 migrations/ 目录下的 .up.sql 文件
migrate:
	@echo "Running migrations..."
	@go run ./cmd/migrate
	@echo "Migrations complete."
