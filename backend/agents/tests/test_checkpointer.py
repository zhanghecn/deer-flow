from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

from src.checkpointer import _DELETE_ORPHANED_BLOBS_SQL, CompatibleAsyncPostgresSaver, _normalize_identifiers


def _normalize_sql(sql: str) -> str:
    return " ".join(sql.split())


class FakeCursor:
    def __init__(self, *, fetchall_results: list[list[dict[str, str]]] | None = None):
        self.executions: list[tuple[str, tuple[object, ...] | None, bool]] = []
        self.fetchall_results = list(fetchall_results or [])

    async def execute(
        self,
        sql: str,
        params: tuple[object, ...] | None = None,
        *,
        binary: bool = False,
    ) -> FakeCursor:
        self.executions.append((_normalize_sql(sql), params, binary))
        return self

    async def fetchall(self) -> list[dict[str, str]]:
        if not self.fetchall_results:
            return []
        return self.fetchall_results.pop(0)


def test_normalize_identifiers_deduplicates_and_strips_values():
    assert _normalize_identifiers([" run-1 ", "", "run-1", "run-2", "   "]) == [
        "run-1",
        "run-2",
    ]


def test_adelete_for_runs_deletes_matching_rows_and_cleans_orphans():
    async def scenario():
        saver = CompatibleAsyncPostgresSaver(conn=object())
        cursor = FakeCursor(
            fetchall_results=[
                [{"thread_id": "thread-1"}, {"thread_id": "thread-2"}],
            ]
        )

        @asynccontextmanager
        async def fake_cursor(*, pipeline: bool = False):
            assert pipeline is True
            yield cursor

        saver._cursor = fake_cursor  # type: ignore[method-assign]
        await saver.adelete_for_runs(["run-1", "run-1", "run-2"])
        return cursor.executions

    executions = asyncio.run(scenario())

    assert len(executions) == 4
    assert "SELECT DISTINCT thread_id FROM checkpoints" in executions[0][0]
    assert executions[0][1] == (["run-1", "run-2"],)
    assert "DELETE FROM checkpoint_writes AS writes" in executions[1][0]
    assert "DELETE FROM checkpoints WHERE metadata ->> 'run_id' = ANY(%s)" in executions[2][0]
    assert executions[3][0] == _normalize_sql(_DELETE_ORPHANED_BLOBS_SQL)
    assert executions[3][1] == (["thread-1", "thread-2"],)


def test_acopy_thread_replays_checkpoints_and_updates_thread_metadata():
    async def scenario():
        saver = CompatibleAsyncPostgresSaver(conn=object())
        checkpoints = [
            SimpleNamespace(
                config={
                    "configurable": {
                        "thread_id": "source-thread",
                        "checkpoint_ns": "",
                        "checkpoint_id": "cp-b",
                    }
                },
                parent_config={
                    "configurable": {
                        "thread_id": "source-thread",
                        "checkpoint_ns": "",
                        "checkpoint_id": "cp-a",
                    }
                },
                checkpoint={"id": "cp-b", "channel_versions": {"messages": "2"}},
                metadata={"thread_id": "source-thread", "x-thread-id": "source-thread"},
                pending_writes=[("task-1", "messages", "chunk"), ("task-1", "title", "copied")],
            ),
            SimpleNamespace(
                config={
                    "configurable": {
                        "thread_id": "source-thread",
                        "checkpoint_ns": "",
                        "checkpoint_id": "cp-a",
                    }
                },
                parent_config=None,
                checkpoint={"id": "cp-a", "channel_versions": {"messages": "1"}},
                metadata={"thread_id": "source-thread"},
                pending_writes=[],
            ),
        ]
        put_calls: list[tuple[dict[str, object], dict[str, object], dict[str, object]]] = []
        write_calls: list[tuple[dict[str, object], list[tuple[str, object]], str]] = []

        async def fake_alist(config, **_: object):
            assert config == {"configurable": {"thread_id": "source-thread"}}
            for checkpoint in checkpoints:
                yield checkpoint

        async def fake_aput(config, checkpoint, metadata, new_versions):
            put_calls.append((config, metadata, new_versions))
            return {
                "configurable": {
                    "thread_id": config["configurable"]["thread_id"],
                    "checkpoint_ns": config["configurable"]["checkpoint_ns"],
                    "checkpoint_id": checkpoint["id"],
                }
            }

        async def fake_aput_writes(config, writes, task_id, task_path: str = ""):
            assert task_path == ""
            write_calls.append((config, list(writes), task_id))

        saver.alist = fake_alist  # type: ignore[method-assign]
        saver.aput = fake_aput  # type: ignore[method-assign]
        saver.aput_writes = fake_aput_writes  # type: ignore[method-assign]

        await saver.acopy_thread("source-thread", "target-thread")
        return put_calls, write_calls

    put_calls, write_calls = asyncio.run(scenario())

    assert [call[0]["configurable"]["checkpoint_id"] for call in put_calls[1:]] == ["cp-a"]
    assert put_calls[0][0]["configurable"] == {
        "thread_id": "target-thread",
        "checkpoint_ns": "",
    }
    assert put_calls[0][1]["thread_id"] == "target-thread"
    assert put_calls[1][1]["thread_id"] == "target-thread"
    assert put_calls[1][1]["x-thread-id"] == "target-thread"
    assert write_calls == [
        (
            {
                "configurable": {
                    "thread_id": "target-thread",
                    "checkpoint_ns": "",
                    "checkpoint_id": "cp-b",
                }
            },
            [("messages", "chunk"), ("title", "copied")],
            "task-1",
        )
    ]


def test_aprune_keep_latest_deletes_old_checkpoints_and_nulls_parents():
    async def scenario():
        saver = CompatibleAsyncPostgresSaver(conn=object())
        cursor = FakeCursor()

        @asynccontextmanager
        async def fake_cursor(*, pipeline: bool = False):
            assert pipeline is True
            yield cursor

        saver._cursor = fake_cursor  # type: ignore[method-assign]
        await saver.aprune(["thread-1", "thread-2"], strategy="keep_latest")
        return cursor.executions

    executions = asyncio.run(scenario())

    assert len(executions) == 4
    assert "DELETE FROM checkpoint_writes AS writes" in executions[0][0]
    assert executions[0][1] == (["thread-1", "thread-2"], ["thread-1", "thread-2"])
    assert "DELETE FROM checkpoints" in executions[1][0]
    assert executions[2][0] == _normalize_sql(
        """
        UPDATE checkpoints
        SET parent_checkpoint_id = NULL
        WHERE thread_id = ANY(%s)
        """
    )
    assert executions[3][0] == _normalize_sql(_DELETE_ORPHANED_BLOBS_SQL)


def test_aprune_delete_all_delegates_to_thread_deletion():
    async def scenario():
        saver = CompatibleAsyncPostgresSaver(conn=object())
        deleted_thread_ids: list[str] = []

        async def fake_adelete_thread(thread_id: str) -> None:
            deleted_thread_ids.append(thread_id)

        saver.adelete_thread = fake_adelete_thread  # type: ignore[method-assign]
        await saver.aprune(["thread-1", "thread-2"], strategy="delete_all")
        return deleted_thread_ids

    assert asyncio.run(scenario()) == ["thread-1", "thread-2"]
