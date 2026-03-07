install:
	uv sync

dev:
	uv run langgraph dev --no-browser --allow-blocking --host 0.0.0.0 --no-reload

test:
	PYTHONPATH=. uv run pytest tests/ -v

lint:
	uvx ruff check .

format:
	uvx ruff check . --fix && uvx ruff format .
