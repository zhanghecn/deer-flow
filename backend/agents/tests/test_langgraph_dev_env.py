import json

from src import langgraph_dev


def test_load_env_from_config_keeps_existing_environment_over_env_file(tmp_path, monkeypatch):
    env_path = tmp_path / "runtime.env"
    env_path.write_text(
        "OPENAGENTS_SANDBOX_BASE_URL=http://127.0.0.1:8083\nOPENAGENTS_SANDBOX_SHARED_DATA_MOUNT_PATH=/openagents\n",
        encoding="utf-8",
    )
    config_path = tmp_path / "langgraph.json"
    config_path.write_text(json.dumps({"env": str(env_path)}), encoding="utf-8")

    monkeypatch.setenv("OPENAGENTS_SANDBOX_BASE_URL", "http://sandbox-aio:8080")

    runtime_env = langgraph_dev._load_env_from_config(config_path, {"env": str(env_path)})

    assert runtime_env == {
        "OPENAGENTS_SANDBOX_BASE_URL": "http://sandbox-aio:8080",
        "OPENAGENTS_SANDBOX_SHARED_DATA_MOUNT_PATH": "/openagents",
    }


def test_main_passes_merged_runtime_env_to_run_server(tmp_path, monkeypatch):
    env_path = tmp_path / "runtime.env"
    env_path.write_text(
        "OPENAGENTS_SANDBOX_BASE_URL=http://127.0.0.1:8083\nOPENAGENTS_SANDBOX_SHARED_DATA_MOUNT_PATH=/openagents\nDATABASE_URI=postgresql://from-env-file\n",
        encoding="utf-8",
    )
    config_path = tmp_path / "langgraph.json"
    config_path.write_text(json.dumps({"env": str(env_path), "graphs": {}}), encoding="utf-8")
    project_config = tmp_path / "config.yaml"
    project_config.write_text("runtime:\n  jobs_per_worker: 3\n", encoding="utf-8")

    monkeypatch.setenv("LANGGRAPH_CONFIG", str(config_path))
    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(project_config))
    monkeypatch.setenv("OPENAGENTS_SANDBOX_BASE_URL", "http://sandbox-aio:8080")
    monkeypatch.setenv("DATABASE_URI", "postgresql://from-container-env")

    captured: dict[str, object] = {}

    def fake_run_server(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(langgraph_dev, "run_server", fake_run_server)
    monkeypatch.setattr(langgraph_dev, "ensure_builtin_agent_archive", lambda *args, **kwargs: None)
    monkeypatch.setattr(langgraph_dev, "start_remote_relay_sidecar", lambda: None)
    monkeypatch.setattr(langgraph_dev, "start_knowledge_worker_thread", lambda: None)

    langgraph_dev.main()

    assert captured["env"] == {
        "OPENAGENTS_SANDBOX_BASE_URL": "http://sandbox-aio:8080",
        "OPENAGENTS_SANDBOX_SHARED_DATA_MOUNT_PATH": "/openagents",
        "DATABASE_URI": "postgresql://from-container-env",
    }
    assert captured["n_jobs_per_worker"] == 3


def test_runtime_edition_can_be_loaded_from_project_config(tmp_path, monkeypatch):
    project_config = tmp_path / "config.yaml"
    project_config.write_text("runtime:\n  edition: postgres\n", encoding="utf-8")

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(project_config))
    monkeypatch.delenv("LANGGRAPH_RUNTIME_EDITION", raising=False)

    assert langgraph_dev._resolve_runtime_edition() == "postgres"


def test_jobs_per_worker_can_be_loaded_from_project_config(tmp_path, monkeypatch):
    project_config = tmp_path / "config.yaml"
    project_config.write_text("runtime:\n  jobs_per_worker: 6\n", encoding="utf-8")

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(project_config))
    monkeypatch.delenv("OPENAGENTS_LANGGRAPH_JOBS_PER_WORKER", raising=False)
    monkeypatch.delenv("N_JOBS_PER_WORKER", raising=False)

    assert langgraph_dev._resolve_jobs_per_worker() == 6


def test_jobs_per_worker_prefers_environment_override(tmp_path, monkeypatch):
    project_config = tmp_path / "config.yaml"
    project_config.write_text("runtime:\n  jobs_per_worker: 6\n", encoding="utf-8")

    monkeypatch.setenv("OPENAGENTS_CONFIG_PATH", str(project_config))
    monkeypatch.setenv("OPENAGENTS_LANGGRAPH_JOBS_PER_WORKER", "8")
    monkeypatch.setenv("N_JOBS_PER_WORKER", "2")

    assert langgraph_dev._resolve_jobs_per_worker() == 8
