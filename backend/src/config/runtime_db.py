import json
import logging
import os
from dataclasses import dataclass
from threading import Lock

from src.config.model_config import ModelConfig

logger = logging.getLogger(__name__)


@dataclass
class DBAgentConfig:
    name: str
    status: str
    model: str | None
    tool_groups: list[str] | None
    mcp_servers: list[str] | None


class RuntimeDBStore:
    def __init__(self, dsn: str):
        self._dsn = dsn

    def _connect(self):
        try:
            import psycopg
        except ImportError as e:  # pragma: no cover - environment dependency
            raise RuntimeError(
                "psycopg is required for runtime database access. Install `psycopg[binary]`."
            ) from e
        return psycopg.connect(self._dsn)

    def get_agent(self, name: str, status: str) -> DBAgentConfig | None:
        query = """
            SELECT name, status, model, tool_groups, mcp_servers
            FROM agents
            WHERE name = %s AND status = %s
            LIMIT 1
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (name, status))
            row = cur.fetchone()
            if row is None:
                return None
            return DBAgentConfig(
                name=row[0],
                status=row[1],
                model=row[2],
                tool_groups=list(row[3]) if row[3] is not None else None,
                mcp_servers=list(row[4]) if row[4] is not None else None,
            )

    def get_model(self, name: str) -> ModelConfig | None:
        query = """
            SELECT name, display_name, config_json
            FROM models
            WHERE name = %s AND enabled = TRUE
            LIMIT 1
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (name,))
            row = cur.fetchone()
            if row is None:
                return None

            model_name, display_name, config_json = row
            payload = self._coerce_json_object(config_json)
            payload["name"] = model_name
            if display_name is not None and str(display_name).strip() != "":
                payload.setdefault("display_name", display_name)
            return ModelConfig.model_validate(payload)

    def get_thread_runtime_model(self, thread_id: str, user_id: str) -> str | None:
        query = """
            SELECT model_name
            FROM thread_runtime_configs
            WHERE thread_id = %s AND user_id::text = %s
            LIMIT 1
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (thread_id, user_id))
            row = cur.fetchone()
            if row is None:
                return None
            model_name = row[0]
            if model_name is None:
                return None
            model_name = str(model_name).strip()
            return model_name or None

    def get_thread_runtime_owner(self, thread_id: str) -> str | None:
        query = """
            SELECT user_id::text
            FROM thread_runtime_configs
            WHERE thread_id = %s
            LIMIT 1
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (thread_id,))
            row = cur.fetchone()
            if row is None:
                return None
            owner = row[0]
            if owner is None:
                return None
            owner = str(owner).strip()
            return owner or None

    def get_thread_owner(self, thread_id: str) -> str | None:
        query = """
            SELECT user_id::text
            FROM thread_ownerships
            WHERE thread_id = %s
            LIMIT 1
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (thread_id,))
            row = cur.fetchone()
            if row is None:
                return None
            owner = row[0]
            if owner is None:
                return None
            owner = str(owner).strip()
            return owner or None

    def claim_thread_ownership(
        self,
        *,
        thread_id: str,
        user_id: str,
        assistant_id: str | None,
    ) -> None:
        upsert_query = """
            INSERT INTO thread_ownerships (thread_id, user_id, assistant_id, created_at, updated_at)
            VALUES (%s, %s::uuid, %s, NOW(), NOW())
            ON CONFLICT (thread_id)
            DO UPDATE SET
                assistant_id = COALESCE(EXCLUDED.assistant_id, thread_ownerships.assistant_id),
                updated_at = NOW()
            WHERE thread_ownerships.user_id = EXCLUDED.user_id
            RETURNING user_id::text
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(upsert_query, (thread_id, user_id, assistant_id))
            row = cur.fetchone()
            if row is not None:
                return
            owner = self.get_thread_owner(thread_id)
            raise ValueError(
                f"Thread access denied for thread '{thread_id}': owned by another user ({owner})."
            )

    def assert_thread_access(self, *, thread_id: str, user_id: str) -> None:
        owner = self.get_thread_owner(thread_id)
        if owner is not None and owner != user_id:
            raise ValueError(
                f"Thread access denied for thread '{thread_id}': owned by another user ({owner})."
            )
        if owner is not None:
            return

        runtime_owner = self.get_thread_runtime_owner(thread_id)
        if runtime_owner is None:
            return
        if runtime_owner != user_id:
            raise ValueError(
                f"Thread access denied for thread '{thread_id}': owned by another user ({runtime_owner})."
            )
        # Backfill ownership table from legacy runtime rows.
        self.claim_thread_ownership(thread_id=thread_id, user_id=user_id, assistant_id=None)

    def save_thread_runtime(
        self,
        *,
        thread_id: str,
        user_id: str,
        model_name: str,
        agent_name: str | None,
    ) -> None:
        self.claim_thread_ownership(thread_id=thread_id, user_id=user_id, assistant_id=agent_name)
        query = """
            INSERT INTO thread_runtime_configs (thread_id, user_id, agent_name, model_name, updated_at)
            VALUES (%s, %s::uuid, %s, %s, NOW())
            ON CONFLICT (thread_id)
            DO UPDATE SET
                agent_name = EXCLUDED.agent_name,
                model_name = EXCLUDED.model_name,
                updated_at = NOW()
            WHERE thread_runtime_configs.user_id = EXCLUDED.user_id
            RETURNING user_id::text
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (thread_id, user_id, agent_name, model_name))
            row = cur.fetchone()
            if row is None:
                owner = self.get_thread_runtime_owner(thread_id) or self.get_thread_owner(thread_id)
                raise ValueError(
                    f"Thread access denied for thread '{thread_id}': owned by another user ({owner})."
                )

    @staticmethod
    def _coerce_json_object(value: object) -> dict:
        if value is None:
            return {}
        if isinstance(value, dict):
            return dict(value)
        if isinstance(value, str):
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
            raise ValueError("models.config_json must be an object")
        # psycopg may return Json wrapper with .obj
        obj = getattr(value, "obj", None)
        if isinstance(obj, dict):
            return dict(obj)
        raise ValueError(f"Unsupported models.config_json type: {type(value).__name__}")


def _build_runtime_db_dsn() -> str:
    host = os.getenv("DB_HOST", "").strip()
    port = os.getenv("DB_PORT", "").strip()
    user = os.getenv("DB_USER", "").strip()
    password = os.getenv("DB_PASSWORD", "").strip()
    db_name = os.getenv("DB_NAME", "").strip()
    sslmode = os.getenv("DB_SSLMODE", "disable").strip() or "disable"

    missing = [
        name
        for name, value in (
            ("DB_HOST", host),
            ("DB_PORT", port),
            ("DB_USER", user),
            ("DB_PASSWORD", password),
            ("DB_NAME", db_name),
        )
        if not value
    ]
    if missing:
        joined = ", ".join(missing)
        raise RuntimeError(f"Missing database environment variables: {joined}")

    return f"host={host} port={port} dbname={db_name} user={user} password={password} sslmode={sslmode}"


_db_store: RuntimeDBStore | None = None
_db_store_lock = Lock()


def get_runtime_db_store() -> RuntimeDBStore:
    global _db_store
    if _db_store is not None:
        return _db_store

    with _db_store_lock:
        if _db_store is not None:
            return _db_store
        dsn = _build_runtime_db_dsn()
        _db_store = RuntimeDBStore(dsn)
        logger.info("Runtime DB store initialized")
        return _db_store
