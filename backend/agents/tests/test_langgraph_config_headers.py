import json
from pathlib import Path


def test_langgraph_config_includes_runtime_identity_headers():
    repo_root = Path(__file__).resolve().parents[2]
    config_path = repo_root / "backend" / "langgraph.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))

    includes = (
        config.get("http", {})
        .get("configurable_headers", {})
        .get("includes", [])
    )
    assert "x-user-id" in includes
    assert "x-thread-id" in includes
