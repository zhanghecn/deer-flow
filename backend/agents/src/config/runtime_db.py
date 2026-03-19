import json
import logging
import os
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from dotenv import dotenv_values

from src.config.model_config import ModelConfig

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ThreadBinding:
    thread_id: str
    user_id: str
    agent_name: str | None
    agent_status: str
    assistant_id: str | None
    model_name: str | None
    execution_backend: str | None
    remote_session_id: str | None
    title: str | None


def _root_env_path() -> Path:
    return Path(__file__).resolve().parents[4] / ".env"


def _database_uri_from_root_env() -> str | None:
    env_path = _root_env_path()
    if not env_path.exists():
        return None

    value = dotenv_values(env_path).get("DATABASE_URI")
    if value is None:
        return None

    uri = str(value).strip()
    if not uri or uri == ":memory:":
        return None
    return uri


class RuntimeDBStore:
    def __init__(self, dsn: str):
        self._dsn = dsn
        self._pool = None
        self._pool_lock = Lock()

    def _connect(self):
        try:
            import psycopg
        except ImportError as e:  # pragma: no cover - environment dependency
            raise RuntimeError("psycopg is required for runtime database access. Install `psycopg[binary]`.") from e
        return psycopg.connect(self._dsn)

    def _get_pool(self):
        if self._pool is not None:
            return self._pool

        with self._pool_lock:
            if self._pool is not None:
                return self._pool

            try:
                from psycopg_pool import ConnectionPool
            except ImportError:
                return None

            self._pool = ConnectionPool(
                conninfo=self._dsn,
                kwargs={"autocommit": True},
                min_size=1,
                max_size=8,
                open=True,
                name="runtime-db",
            )
            return self._pool

    @contextmanager
    def _connection(self):
        pool = self._get_pool()
        if pool is not None:
            with pool.connection() as conn:
                yield conn
            return

        with self._connect() as conn:
            conn.autocommit = True
            yield conn

    def get_model(self, name: str) -> ModelConfig | None:
        query = """
            SELECT name, display_name, config_json
            FROM models
            WHERE name = %s AND enabled = TRUE
            LIMIT 1
        """
        with self._connection() as conn, conn.cursor() as cur:
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

    def get_any_enabled_model(self) -> ModelConfig | None:
        query = """
            SELECT name, display_name, config_json
            FROM models
            WHERE enabled = TRUE
            ORDER BY created_at ASC, name ASC
            LIMIT 1
        """
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()
            if row is None:
                return None

            model_name, display_name, config_json = row
            payload = self._coerce_json_object(config_json)
            payload["name"] = model_name
            if display_name is not None and str(display_name).strip() != "":
                payload.setdefault("display_name", display_name)
            return ModelConfig.model_validate(payload)

    def list_enabled_model_names(self) -> list[str]:
        query = """
            SELECT name
            FROM models
            WHERE enabled = TRUE
            ORDER BY created_at ASC, name ASC
        """
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()

        return [
            str(row[0]).strip()
            for row in rows
            if row and row[0] is not None and str(row[0]).strip()
        ]

    def get_user_id_by_name(self, name: str) -> str | None:
        normalized_name = str(name).strip()
        if not normalized_name:
            return None

        query = """
            SELECT id::text
            FROM users
            WHERE LOWER(name) = LOWER(%s)
            LIMIT 1
        """
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query, (normalized_name,))
            row = cur.fetchone()
            if row is None:
                return None
            user_id = row[0]
            if user_id is None:
                return None
            user_id = str(user_id).strip()
            return user_id or None

    def get_any_user_id(self) -> str | None:
        query = """
            SELECT id::text
            FROM users
            ORDER BY created_at ASC
            LIMIT 1
        """
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()
            if row is None:
                return None
            user_id = row[0]
            if user_id is None:
                return None
            user_id = str(user_id).strip()
            return user_id or None

    def get_thread_runtime_model(self, thread_id: str, user_id: str) -> str | None:
        binding = self.get_thread_binding(thread_id)
        if binding is None or binding.user_id != user_id:
            return None
        return binding.model_name

    def get_thread_owner(self, thread_id: str) -> str | None:
        binding = self.get_thread_binding(thread_id)
        if binding is None:
            return None
        return binding.user_id

    def get_thread_binding(self, thread_id: str) -> ThreadBinding | None:
        query = """
            SELECT
                thread_id,
                user_id::text,
                agent_name,
                agent_status,
                assistant_id,
                model_name,
                execution_backend,
                remote_session_id,
                title
            FROM thread_bindings
            WHERE thread_id = %s
            LIMIT 1
        """
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query, (thread_id,))
            row = cur.fetchone()
            if row is None:
                return None

            (
                bound_thread_id,
                bound_user_id,
                agent_name,
                agent_status,
                assistant_id,
                model_name,
                execution_backend,
                remote_session_id,
                title,
            ) = row
            if bound_user_id is None:
                return None

            user_id = str(bound_user_id).strip()
            if not user_id:
                return None

            return ThreadBinding(
                thread_id=str(bound_thread_id).strip() or thread_id,
                user_id=user_id,
                agent_name=self._normalize_optional_text(agent_name),
                agent_status=self._normalize_agent_status(agent_status),
                assistant_id=self._normalize_optional_text(assistant_id),
                model_name=self._normalize_optional_text(model_name),
                execution_backend=self._normalize_execution_backend(execution_backend),
                remote_session_id=self._normalize_optional_text(remote_session_id),
                title=self._normalize_optional_text(title),
            )

    def claim_thread_ownership(
        self,
        *,
        thread_id: str,
        user_id: str,
        assistant_id: str | None,
    ) -> None:
        upsert_query = """
            INSERT INTO thread_bindings (thread_id, user_id, assistant_id, created_at, updated_at)
            VALUES (%s, %s::uuid, %s, NOW(), NOW())
            ON CONFLICT (thread_id)
            DO UPDATE SET
                assistant_id = COALESCE(EXCLUDED.assistant_id, thread_bindings.assistant_id),
                updated_at = NOW()
            WHERE thread_bindings.user_id = EXCLUDED.user_id
            RETURNING user_id::text
        """
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(upsert_query, (thread_id, user_id, assistant_id))
            row = cur.fetchone()
            if row is not None:
                return
            owner = self.get_thread_owner(thread_id)
            raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({owner}).")

    def assert_thread_access(self, *, thread_id: str, user_id: str) -> None:
        owner = self.get_thread_owner(thread_id)
        if owner is not None and owner != user_id:
            raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({owner}).")

    def save_thread_runtime(
        self,
        *,
        thread_id: str,
        user_id: str,
        model_name: str,
        agent_name: str | None,
        agent_status: str,
        execution_backend: str | None,
        remote_session_id: str | None,
    ) -> None:
        normalized_agent_status = self._normalize_agent_status(agent_status)
        normalized_execution_backend = self._normalize_execution_backend(
            execution_backend,
        )
        query = """
            INSERT INTO thread_bindings (
                thread_id,
                user_id,
                agent_name,
                agent_status,
                assistant_id,
                model_name,
                execution_backend,
                remote_session_id,
                created_at,
                updated_at
            )
            VALUES (%s, %s::uuid, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (thread_id)
            DO UPDATE SET
                agent_name = EXCLUDED.agent_name,
                agent_status = EXCLUDED.agent_status,
                assistant_id = COALESCE(EXCLUDED.assistant_id, thread_bindings.assistant_id),
                model_name = EXCLUDED.model_name,
                execution_backend = EXCLUDED.execution_backend,
                remote_session_id = EXCLUDED.remote_session_id,
                updated_at = NOW()
            WHERE thread_bindings.user_id = EXCLUDED.user_id
            RETURNING user_id::text
        """
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(
                query,
                (
                    thread_id,
                    user_id,
                    agent_name,
                    normalized_agent_status,
                    agent_name,
                    model_name,
                    normalized_execution_backend or "default",
                    self._normalize_optional_text(remote_session_id),
                ),
            )
            row = cur.fetchone()
            if row is None:
                owner = self.get_thread_owner(thread_id)
                raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({owner}).")

    def save_thread_runtime_if_needed(
        self,
        *,
        thread_id: str,
        user_id: str,
        model_name: str,
        agent_name: str | None,
        agent_status: str,
        execution_backend: str | None,
        remote_session_id: str | None,
    ) -> bool:
        binding = self.get_thread_binding(thread_id)
        if binding is not None:
            if binding.user_id != user_id:
                raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({binding.user_id}).")

            expected_assistant_id = agent_name or binding.assistant_id
            if (
                binding.model_name == model_name
                and binding.agent_name == agent_name
                and binding.agent_status
                == self._normalize_agent_status(agent_status)
                and binding.execution_backend
                == self._normalize_execution_backend(execution_backend)
                and binding.remote_session_id
                == self._normalize_optional_text(remote_session_id)
                and binding.assistant_id == expected_assistant_id
            ):
                return False

        self.save_thread_runtime(
            thread_id=thread_id,
            user_id=user_id,
            model_name=model_name,
            agent_name=agent_name,
            agent_status=agent_status,
            execution_backend=execution_backend,
            remote_session_id=remote_session_id,
        )
        return True

    def save_thread_title(
        self,
        *,
        thread_id: str,
        user_id: str,
        title: str,
    ) -> None:
        normalized_title = str(title).strip()
        if not normalized_title:
            return

        query = """
            UPDATE thread_bindings
            SET title = %s, updated_at = NOW()
            WHERE thread_id = %s AND user_id = %s::uuid
        """
        with self._connection() as conn, conn.cursor() as cur:
            cur.execute(query, (normalized_title, thread_id, user_id))
            if cur.rowcount and cur.rowcount > 0:
                return
            owner = self.get_thread_owner(thread_id)
            raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({owner}).")

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

    @staticmethod
    def _normalize_optional_text(value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _normalize_agent_status(value: object) -> str:
        text = str(value or "").strip().lower()
        return "prod" if text == "prod" else "dev"

    @staticmethod
    def _normalize_execution_backend(value: object) -> str | None:
        text = str(value or "").strip().lower()
        return "remote" if text == "remote" else None


def _build_runtime_db_dsn() -> str:
    database_uri = os.getenv("DATABASE_URI", "").strip()
    if database_uri and database_uri != ":memory:":
        return database_uri

    fallback_uri = _database_uri_from_root_env()
    if fallback_uri:
        return fallback_uri

    if database_uri == ":memory:":
        raise RuntimeError("DATABASE_URI is ':memory:' and no root .env DATABASE_URI fallback was found.")

    raise RuntimeError("Missing required PostgreSQL DATABASE_URI for runtime DB access.")


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
