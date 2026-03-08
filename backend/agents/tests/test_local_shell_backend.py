import uuid
from pathlib import Path

from deepagents.backends.local_shell import LocalShellBackend


def test_execute_creates_missing_cwd_and_retries(tmp_path):
    missing_root = tmp_path / "threads" / "thread-1" / "user-data"
    backend = LocalShellBackend(
        root_dir=missing_root,
        virtual_mode=True,
        inherit_env=True,
        timeout=30,
    )

    result = backend.execute("pwd")

    assert result.exit_code == 0
    assert missing_root.exists()


def test_virtual_mode_maps_mnt_user_data_prefix_to_backend_root(tmp_path):
    root = tmp_path / "thread" / "user-data"
    backend = LocalShellBackend(
        root_dir=root,
        virtual_mode=True,
        inherit_env=True,
        timeout=30,
    )

    write_result = backend.write("/mnt/user-data/outputs/proof.html", "<h1>ok</h1>")

    assert write_result.error is None
    assert (root / "outputs" / "proof.html").exists()
    assert not (root / "mnt" / "user-data" / "outputs" / "proof.html").exists()


def test_execute_rewrites_virtual_paths_to_thread_root(tmp_path):
    root = tmp_path / "thread" / "user-data"
    backend = LocalShellBackend(
        root_dir=root,
        virtual_mode=True,
        inherit_env=True,
        timeout=30,
    )

    file_name = f"proof-{uuid.uuid4().hex}.txt"
    source_path = f"/mnt/user-data/workspace/{file_name}"
    output_path = f"/mnt/user-data/outputs/{file_name}"
    global_output = Path("/mnt/user-data/outputs") / file_name

    try:
        write_result = backend.write(source_path, "ok")
        assert write_result.error is None

        result = backend.execute(f"cp {source_path} {output_path}")
        assert result.exit_code == 0, result.output

        assert (root / "workspace" / file_name).exists()
        assert (root / "outputs" / file_name).exists()
        assert not global_output.exists()
    finally:
        if global_output.exists():
            global_output.unlink()
