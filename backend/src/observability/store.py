from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TraceContext:
    trace_id: str
    root_run_id: str | None
    user_id: UUID | None
    thread_id: str | None
    agent_name: str | None
    model_name: str | None
    metadata: dict[str, Any]


class TraceStore:
    def __init__(self, dsn: str):
        self._dsn = dsn

    def _connect(self):
        import psycopg

        return psycopg.connect(self._dsn)

    def upsert_trace(self, context: TraceContext) -> None:
        query = """
            INSERT INTO agent_traces (
                trace_id,
                root_run_id,
                user_id,
                thread_id,
                agent_name,
                model_name,
                metadata,
                status,
                started_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, 'running', NOW())
            ON CONFLICT (trace_id)
            DO UPDATE SET
                root_run_id = COALESCE(agent_traces.root_run_id, EXCLUDED.root_run_id),
                user_id = COALESCE(agent_traces.user_id, EXCLUDED.user_id),
                thread_id = COALESCE(agent_traces.thread_id, EXCLUDED.thread_id),
                agent_name = COALESCE(agent_traces.agent_name, EXCLUDED.agent_name),
                model_name = COALESCE(agent_traces.model_name, EXCLUDED.model_name),
                metadata = agent_traces.metadata || EXCLUDED.metadata
        """
        payload = (
            context.trace_id,
            context.root_run_id,
            context.user_id,
            context.thread_id,
            context.agent_name,
            context.model_name,
            json.dumps(context.metadata or {}, ensure_ascii=True),
        )
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, payload)
            conn.commit()

    def append_event(
        self,
        *,
        trace_id: str,
        event_index: int,
        run_id: str,
        parent_run_id: str | None,
        run_type: str,
        event_type: str,
        node_name: str | None,
        tool_name: str | None,
        task_run_id: str | None,
        started_at: datetime | None,
        finished_at: datetime | None,
        duration_ms: int | None,
        input_tokens: int | None,
        output_tokens: int | None,
        total_tokens: int | None,
        status: str,
        error: str | None,
        payload: dict[str, Any] | None,
    ) -> None:
        query = """
            INSERT INTO agent_trace_events (
                trace_id,
                event_index,
                run_id,
                parent_run_id,
                run_type,
                event_type,
                node_name,
                tool_name,
                task_run_id,
                started_at,
                finished_at,
                duration_ms,
                input_tokens,
                output_tokens,
                total_tokens,
                status,
                error,
                payload,
                created_at
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s::jsonb, NOW()
            )
            ON CONFLICT (trace_id, event_index)
            DO NOTHING
        """
        args = (
            trace_id,
            event_index,
            run_id,
            parent_run_id,
            run_type,
            event_type,
            node_name,
            tool_name,
            task_run_id,
            started_at,
            finished_at,
            duration_ms,
            input_tokens,
            output_tokens,
            total_tokens,
            status,
            error,
            json.dumps(payload or {}, ensure_ascii=True),
        )
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, args)
            conn.commit()

    def add_trace_tokens(self, trace_id: str, input_tokens: int, output_tokens: int, total_tokens: int) -> None:
        query = """
            UPDATE agent_traces
            SET input_tokens = input_tokens + %s,
                output_tokens = output_tokens + %s,
                total_tokens = total_tokens + %s
            WHERE trace_id = %s
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (input_tokens, output_tokens, total_tokens, trace_id))
            conn.commit()

    def finish_trace(self, trace_id: str, *, status: str, error: str | None = None) -> None:
        query = """
            UPDATE agent_traces
            SET status = %s,
                error = %s,
                finished_at = COALESCE(finished_at, NOW())
            WHERE trace_id = %s
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (status, error, trace_id))
            conn.commit()


_store: TraceStore | None = None
_store_lock = threading.Lock()


def get_trace_store() -> TraceStore | None:
    global _store
    if _store is not None:
        return _store

    with _store_lock:
        if _store is not None:
            return _store
        dsn = _resolve_trace_dsn()
        if not dsn:
            logger.warning("Trace store disabled: DATABASE_URI is missing or in-memory")
            return None
        _store = TraceStore(dsn)
        return _store


def now_utc() -> datetime:
    return datetime.now(UTC)


def _resolve_trace_dsn() -> str:
    database_uri = os.getenv("DATABASE_URI", "").strip()
    if database_uri and database_uri != ":memory:":
        return database_uri

    root_env = Path(__file__).resolve().parents[3] / ".env"
    if root_env.exists():
        try:
            from dotenv import dotenv_values
        except ImportError:  # pragma: no cover - optional dependency guard
            dotenv_values = None
        if dotenv_values is not None:
            env_database_uri = str(dotenv_values(str(root_env)).get("DATABASE_URI", "")).strip()
            if env_database_uri and env_database_uri != ":memory:":
                return env_database_uri

    return ""
