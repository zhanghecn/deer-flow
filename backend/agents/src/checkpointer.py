from __future__ import annotations

from contextlib import asynccontextmanager

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from src.config.runtime_db import _build_runtime_db_dsn


@asynccontextmanager
async def checkpointer():
    database_uri = _build_runtime_db_dsn()
    async with AsyncPostgresSaver.from_conn_string(database_uri) as saver:
        await saver.setup()
        yield saver
