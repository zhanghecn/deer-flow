install:
	uv sync

dev:
	uv run python -m src.langgraph_dev

test:
	PYTHONPATH=. uv run pytest tests/ -v

lint:
	uvx ruff check .

format:
	uvx ruff check . --fix && uvx ruff format .
