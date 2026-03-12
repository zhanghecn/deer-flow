import json
import logging
import os
from pathlib import Path
from threading import Lock

from dotenv import dotenv_values

from src.config.model_config import ModelConfig

logger = logging.getLogger(__name__)


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

    def _connect(self):
        try:
            import psycopg
        except ImportError as e:  # pragma: no cover - environment dependency
            raise RuntimeError("psycopg is required for runtime database access. Install `psycopg[binary]`.") from e
        return psycopg.connect(self._dsn)

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

    def get_any_enabled_model(self) -> ModelConfig | None:
        query = """
            SELECT name, display_name, config_json
            FROM models
            WHERE enabled = TRUE
            ORDER BY created_at ASC, name ASC
            LIMIT 1
        """
        with self._connect() as conn, conn.cursor() as cur:
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
        with self._connect() as conn, conn.cursor() as cur:
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
        with self._connect() as conn, conn.cursor() as cur:
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
        query = """
            SELECT model_name
            FROM thread_bindings
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

    def get_thread_owner(self, thread_id: str) -> str | None:
        query = """
            SELECT user_id::text
            FROM thread_bindings
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
            INSERT INTO thread_bindings (thread_id, user_id, assistant_id, created_at, updated_at)
            VALUES (%s, %s::uuid, %s, NOW(), NOW())
            ON CONFLICT (thread_id)
            DO UPDATE SET
                assistant_id = COALESCE(EXCLUDED.assistant_id, thread_bindings.assistant_id),
                updated_at = NOW()
            WHERE thread_bindings.user_id = EXCLUDED.user_id
            RETURNING user_id::text
        """
        with self._connect() as conn, conn.cursor() as cur:
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
    ) -> None:
        self.claim_thread_ownership(thread_id=thread_id, user_id=user_id, assistant_id=agent_name)
        query = """
            INSERT INTO thread_bindings (
                thread_id,
                user_id,
                agent_name,
                assistant_id,
                model_name,
                created_at,
                updated_at
            )
            VALUES (%s, %s::uuid, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (thread_id)
            DO UPDATE SET
                agent_name = EXCLUDED.agent_name,
                assistant_id = COALESCE(EXCLUDED.assistant_id, thread_bindings.assistant_id),
                model_name = EXCLUDED.model_name,
                updated_at = NOW()
            WHERE thread_bindings.user_id = EXCLUDED.user_id
            RETURNING user_id::text
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(query, (thread_id, user_id, agent_name, agent_name, model_name))
            row = cur.fetchone()
            if row is None:
                owner = self.get_thread_owner(thread_id)
                raise ValueError(f"Thread access denied for thread '{thread_id}': owned by another user ({owner}).")

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
        with self._connect() as conn, conn.cursor() as cur:
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
