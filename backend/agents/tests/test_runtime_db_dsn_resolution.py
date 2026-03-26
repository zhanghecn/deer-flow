import pytest

from src.config import runtime_db


def test_build_runtime_db_dsn_prefers_process_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URI", "postgresql://env-user:env-pass@127.0.0.1:5432/envdb")
    assert runtime_db._build_runtime_db_dsn() == "postgresql://env-user:env-pass@127.0.0.1:5432/envdb"


def test_build_runtime_db_dsn_reads_root_env_when_langgraph_inmem(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URI=postgresql://file-user:file-pass@127.0.0.1:5432/filedb\n", encoding="utf-8")

    monkeypatch.setenv("DATABASE_URI", ":memory:")
    monkeypatch.setattr(runtime_db, "_root_env_path", lambda: env_file)

    assert runtime_db._build_runtime_db_dsn() == "postgresql://file-user:file-pass@127.0.0.1:5432/filedb"


def test_build_runtime_db_dsn_rejects_memory_uri_without_root_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URI", ":memory:")
    monkeypatch.setattr(runtime_db, "_root_env_path", lambda: tmp_path / ".env")

    with pytest.raises(RuntimeError, match=":memory:"):
        runtime_db._build_runtime_db_dsn()


def test_runtime_db_store_exposes_public_connection_helper(monkeypatch):
    store = runtime_db.RuntimeDBStore("postgresql://user:pass@127.0.0.1:5432/app")
    calls: list[str] = []

    @runtime_db.contextmanager
    def fake_connection():
        calls.append("enter")
        yield "conn"
        calls.append("exit")

    monkeypatch.setattr(store, "_connection", fake_connection)

    with store.connection() as conn:
        assert conn == "conn"

    assert calls == ["enter", "exit"]
