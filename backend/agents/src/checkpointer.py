from __future__ import annotations

import asyncio
from collections.abc import Coroutine, Sequence
from contextlib import asynccontextmanager
from typing import Any

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from src.config.runtime_db import _build_runtime_db_dsn

_SELECT_THREADS_FOR_RUNS_SQL = """
SELECT DISTINCT thread_id
FROM checkpoints
WHERE metadata ->> 'run_id' = ANY(%s)
"""

_DELETE_WRITES_FOR_RUNS_SQL = """
WITH doomed AS (
    SELECT thread_id, checkpoint_ns, checkpoint_id
    FROM checkpoints
    WHERE metadata ->> 'run_id' = ANY(%s)
)
DELETE FROM checkpoint_writes AS writes
USING doomed
WHERE writes.thread_id = doomed.thread_id
  AND writes.checkpoint_ns = doomed.checkpoint_ns
  AND writes.checkpoint_id = doomed.checkpoint_id
"""

_DELETE_CHECKPOINTS_FOR_RUNS_SQL = """
DELETE FROM checkpoints
WHERE metadata ->> 'run_id' = ANY(%s)
"""

_DELETE_ORPHANED_BLOBS_SQL = """
DELETE FROM checkpoint_blobs AS blobs
WHERE blobs.thread_id = ANY(%s)
  AND NOT EXISTS (
    SELECT 1
    FROM checkpoints AS checkpoints
    WHERE checkpoints.thread_id = blobs.thread_id
      AND checkpoints.checkpoint_ns = blobs.checkpoint_ns
      AND checkpoints.checkpoint -> 'channel_versions' ->> blobs.channel = blobs.version
  )
"""

_DELETE_STALE_WRITES_SQL = """
WITH latest AS (
    SELECT DISTINCT ON (thread_id, checkpoint_ns)
        thread_id, checkpoint_ns, checkpoint_id
    FROM checkpoints
    WHERE thread_id = ANY(%s)
    ORDER BY thread_id, checkpoint_ns, checkpoint_id DESC
),
doomed AS (
    SELECT checkpoints.thread_id, checkpoints.checkpoint_ns, checkpoints.checkpoint_id
    FROM checkpoints
    WHERE checkpoints.thread_id = ANY(%s)
      AND NOT EXISTS (
          SELECT 1
          FROM latest
          WHERE latest.thread_id = checkpoints.thread_id
            AND latest.checkpoint_ns = checkpoints.checkpoint_ns
            AND latest.checkpoint_id = checkpoints.checkpoint_id
      )
)
DELETE FROM checkpoint_writes AS writes
USING doomed
WHERE writes.thread_id = doomed.thread_id
  AND writes.checkpoint_ns = doomed.checkpoint_ns
  AND writes.checkpoint_id = doomed.checkpoint_id
"""

_DELETE_STALE_CHECKPOINTS_SQL = """
WITH latest AS (
    SELECT DISTINCT ON (thread_id, checkpoint_ns)
        thread_id, checkpoint_ns, checkpoint_id
    FROM checkpoints
    WHERE thread_id = ANY(%s)
    ORDER BY thread_id, checkpoint_ns, checkpoint_id DESC
)
DELETE FROM checkpoints
WHERE thread_id = ANY(%s)
  AND NOT EXISTS (
      SELECT 1
      FROM latest
      WHERE latest.thread_id = checkpoints.thread_id
        AND latest.checkpoint_ns = checkpoints.checkpoint_ns
        AND latest.checkpoint_id = checkpoints.checkpoint_id
  )
"""

_CLEAR_PARENT_CHECKPOINTS_SQL = """
UPDATE checkpoints
SET parent_checkpoint_id = NULL
WHERE thread_id = ANY(%s)
"""


def _normalize_identifiers(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def _normalize_prune_strategy(strategy: str) -> str:
    normalized = (strategy or "keep_latest").strip().lower()
    if normalized == "delete":
        return "delete_all"
    if normalized in {"keep_latest", "delete_all"}:
        return normalized
    raise ValueError(
        f"Unsupported prune strategy: {strategy}. Expected keep_latest or delete_all."
    )


def _group_pending_writes_by_task(
    pending_writes: Sequence[tuple[str, str, Any]],
) -> dict[str, list[tuple[str, Any]]]:
    writes_by_task: dict[str, list[tuple[str, Any]]] = {}
    for task_id, channel, value in pending_writes:
        writes_by_task.setdefault(task_id, []).append((channel, value))
    return writes_by_task


class CompatibleAsyncPostgresSaver(AsyncPostgresSaver):
    """Backfills LangGraph's newer optional checkpoint APIs for current PG saver."""

    def _run_on_loop(self, coro: Coroutine[Any, Any, object]) -> object:
        try:
            if asyncio.get_running_loop() is self.loop:
                raise asyncio.InvalidStateError(
                    "Synchronous calls to CompatibleAsyncPostgresSaver are only allowed "
                    "from a different thread. Use the async interface from the main thread."
                )
        except RuntimeError:
            pass
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result()

    async def adelete_for_runs(self, run_ids: Sequence[str]) -> None:
        unique_run_ids = _normalize_identifiers(run_ids)
        if not unique_run_ids:
            return

        async with self._cursor(pipeline=True) as cur:
            affected_thread_ids = await self._select_thread_ids_for_runs(
                cur,
                unique_run_ids,
            )
            await self._delete_writes_for_runs(cur, unique_run_ids)
            await self._delete_checkpoints_for_runs(cur, unique_run_ids)
            await self._delete_orphaned_blobs(cur, affected_thread_ids)

    async def acopy_thread(self, source_thread_id: str, target_thread_id: str) -> None:
        source_thread = str(source_thread_id).strip()
        target_thread = str(target_thread_id).strip()
        if not source_thread or not target_thread or source_thread == target_thread:
            return

        for checkpoint_tuple in await self._list_checkpoints_for_thread(source_thread):
            stored_config = await self.aput(
                self._build_copy_config(checkpoint_tuple, target_thread),
                checkpoint_tuple.checkpoint,
                self._rewrite_thread_metadata(checkpoint_tuple.metadata, target_thread),
                checkpoint_tuple.checkpoint.get("channel_versions", {}),
            )
            await self._copy_pending_writes(
                stored_config,
                checkpoint_tuple.pending_writes,
            )

    async def aprune(
        self,
        thread_ids: Sequence[str],
        *,
        strategy: str = "keep_latest",
    ) -> None:
        unique_thread_ids = _normalize_identifiers(thread_ids)
        if not unique_thread_ids:
            return

        prune_strategy = _normalize_prune_strategy(strategy)
        if prune_strategy == "delete_all":
            for thread_id in unique_thread_ids:
                await self.adelete_thread(thread_id)
            return

        async with self._cursor(pipeline=True) as cur:
            await self._delete_stale_writes(cur, unique_thread_ids)
            await self._delete_stale_checkpoints(cur, unique_thread_ids)
            await self._clear_parent_checkpoints(cur, unique_thread_ids)
            await self._delete_orphaned_blobs(cur, unique_thread_ids)

    def delete_for_runs(self, run_ids: Sequence[str]) -> None:
        self._run_on_loop(self.adelete_for_runs(run_ids))

    def copy_thread(self, source_thread_id: str, target_thread_id: str) -> None:
        self._run_on_loop(self.acopy_thread(source_thread_id, target_thread_id))

    def prune(
        self,
        thread_ids: Sequence[str],
        *,
        strategy: str = "keep_latest",
    ) -> None:
        self._run_on_loop(self.aprune(thread_ids, strategy=strategy))

    async def _select_thread_ids_for_runs(
        self,
        cur: Any,
        run_ids: Sequence[str],
    ) -> list[str]:
        await cur.execute(_SELECT_THREADS_FOR_RUNS_SQL, (run_ids,))
        rows = await cur.fetchall()
        return [str(row["thread_id"]) for row in rows if row.get("thread_id")]

    async def _delete_writes_for_runs(
        self,
        cur: Any,
        run_ids: Sequence[str],
    ) -> None:
        await cur.execute(_DELETE_WRITES_FOR_RUNS_SQL, (run_ids,))

    async def _delete_checkpoints_for_runs(
        self,
        cur: Any,
        run_ids: Sequence[str],
    ) -> None:
        await cur.execute(_DELETE_CHECKPOINTS_FOR_RUNS_SQL, (run_ids,))

    async def _delete_orphaned_blobs(
        self,
        cur: Any,
        thread_ids: Sequence[str],
    ) -> None:
        if not thread_ids:
            return
        await cur.execute(_DELETE_ORPHANED_BLOBS_SQL, (thread_ids,))

    async def _list_checkpoints_for_thread(self, thread_id: str) -> list[Any]:
        source_config = {"configurable": {"thread_id": thread_id}}
        checkpoints = [checkpoint async for checkpoint in self.alist(source_config)]
        return sorted(
            checkpoints,
            key=lambda checkpoint: checkpoint.config["configurable"]["checkpoint_id"],
        )

    def _build_copy_config(
        self,
        checkpoint_tuple: Any,
        target_thread_id: str,
    ) -> dict[str, dict[str, str]]:
        target_config: dict[str, dict[str, str]] = {
            "configurable": {
                "thread_id": target_thread_id,
                "checkpoint_ns": checkpoint_tuple.config["configurable"].get(
                    "checkpoint_ns",
                    "",
                ),
            }
        }
        parent_config = checkpoint_tuple.parent_config
        if not parent_config or not parent_config.get("configurable"):
            return target_config

        parent_checkpoint_id = parent_config["configurable"].get("checkpoint_id")
        if parent_checkpoint_id is None:
            return target_config

        target_config["configurable"]["checkpoint_id"] = parent_checkpoint_id
        return target_config

    def _rewrite_thread_metadata(
        self,
        metadata: dict[str, Any],
        target_thread_id: str,
    ) -> dict[str, Any]:
        rewritten = dict(metadata)
        if "thread_id" in rewritten:
            rewritten["thread_id"] = target_thread_id
        if "x-thread-id" in rewritten:
            rewritten["x-thread-id"] = target_thread_id
        return rewritten

    async def _copy_pending_writes(
        self,
        stored_config: dict[str, Any],
        pending_writes: Sequence[tuple[str, str, Any]],
    ) -> None:
        for task_id, writes in _group_pending_writes_by_task(pending_writes).items():
            await self.aput_writes(stored_config, writes, task_id)

    async def _delete_stale_writes(
        self,
        cur: Any,
        thread_ids: Sequence[str],
    ) -> None:
        await cur.execute(_DELETE_STALE_WRITES_SQL, (thread_ids, thread_ids))

    async def _delete_stale_checkpoints(
        self,
        cur: Any,
        thread_ids: Sequence[str],
    ) -> None:
        await cur.execute(_DELETE_STALE_CHECKPOINTS_SQL, (thread_ids, thread_ids))

    async def _clear_parent_checkpoints(
        self,
        cur: Any,
        thread_ids: Sequence[str],
    ) -> None:
        await cur.execute(_CLEAR_PARENT_CHECKPOINTS_SQL, (thread_ids,))


@asynccontextmanager
async def checkpointer():
    database_uri = _build_runtime_db_dsn()
    async with CompatibleAsyncPostgresSaver.from_conn_string(database_uri) as saver:
        await saver.setup()
        yield saver
