import logging
from types import SimpleNamespace

from deepagents.backends.sandbox import BaseSandbox

from src.community.aio_sandbox import aio_sandbox as aio_sandbox_module


class _DummyShell:
    def exec_command(self, **kwargs):
        self.last_call = kwargs
        return SimpleNamespace(
            data=SimpleNamespace(output="sandbox-ok", status="completed", exit_code=0),
        )


class _DummyFile:
    def __init__(self):
        self.uploads: dict[str, bytes] = {}

    def upload_file(self, *, file, path):
        self.uploads[path] = file
        return SimpleNamespace()

    def download_file(self, *, path):
        if path not in self.uploads:
            raise FileNotFoundError(path)
        yield self.uploads[path]


class _DummySandboxAPI:
    @staticmethod
    def get_context():
        return SimpleNamespace(home_dir="/mnt/user-data")


class _DummyClient:
    def __init__(self, *, base_url, timeout):
        self.base_url = base_url
        self.timeout = timeout
        self.shell = _DummyShell()
        self.file = _DummyFile()
        self.sandbox = _DummySandboxAPI()


def test_aio_sandbox_is_base_sandbox(monkeypatch):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(id="sb-1", base_url="http://sandbox.test")

    assert isinstance(sandbox, BaseSandbox)

    execute_result = sandbox.execute("pwd")
    assert execute_result.output == "sandbox-ok"
    assert execute_result.exit_code == 0

    upload_result = sandbox.upload_files([("/tmp/file.txt", b"hello")])
    assert upload_result[0].error is None

    download_result = sandbox.download_files(["/tmp/file.txt"])
    assert download_result[0].content == b"hello"

    read_result = sandbox.read("/tmp/file.txt")
    assert "hello" in read_result

    write_result = sandbox.write("/tmp/new.txt", "world")
    assert write_result.error is None
    assert sandbox.download_files(["/tmp/new.txt"])[0].content == b"world"

    edit_result = sandbox.edit("/tmp/new.txt", "world", "updated")
    assert edit_result.error is None
    assert sandbox.download_files(["/tmp/new.txt"])[0].content == b"updated"


def test_aio_sandbox_execute_supports_nested_shell_response(monkeypatch):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(id="sb-2", base_url="http://sandbox.test")

    result = sandbox.execute("pwd")

    assert result.output == "sandbox-ok"
    assert result.exit_code == 0


def test_aio_sandbox_execute_rewrites_runtime_alias_paths(monkeypatch):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(id="sb-3", base_url="http://sandbox.test")

    sandbox.execute("python /agents/dev/lead_agent/skills/image-generation/scripts/generate.py --output-file /outputs/demo.jpg")

    command = sandbox._client.shell.last_call["command"]
    assert command.startswith("bwrap ")
    assert "python /mnt/user-data/agents/dev/lead_agent/skills/image-generation/scripts/generate.py" in command
    assert "/mnt/user-data/outputs/demo.jpg" in command
    assert sandbox._client.shell.last_call["exec_dir"] == "/mnt/user-data"


def test_aio_sandbox_execute_rewrites_virtual_paths_into_thread_mount(monkeypatch):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-4",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-1/user-data",
    )

    sandbox.execute("python /mnt/user-data/agents/dev/lead_agent/skills/image-generation/scripts/generate.py --output-file /mnt/user-data/outputs/demo.jpg")

    assert sandbox._client.shell.last_call["exec_dir"] == "/openagents/threads/thread-1/user-data"
    command = sandbox._client.shell.last_call["command"]
    assert command.startswith("bwrap ")
    assert "--bind /openagents/threads/thread-1/user-data /mnt/user-data" in command
    assert "python /mnt/user-data/agents/dev/lead_agent/skills/image-generation/scripts/generate.py" in command
    assert "/mnt/user-data/outputs/demo.jpg" in command


def test_aio_sandbox_execute_can_disable_exec_isolation(monkeypatch):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)
    monkeypatch.setenv("OPENAGENTS_SANDBOX_EXEC_ISOLATION", "off")

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-disable",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-9/user-data",
    )

    sandbox.execute("pwd && ls /workspace")

    assert sandbox._client.shell.last_call["command"] == (
        "pwd && ls /openagents/threads/thread-9/user-data/workspace"
    )


def test_aio_sandbox_file_api_rewrites_virtual_paths_into_thread_mount(monkeypatch):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-5",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-2/user-data",
    )

    upload_result = sandbox.upload_files([("/mnt/user-data/workspace/demo.txt", b"hello")])
    assert upload_result[0].error is None
    assert upload_result[0].path == "/mnt/user-data/workspace/demo.txt"
    assert "/openagents/threads/thread-2/user-data/workspace/demo.txt" in sandbox._client.file.uploads

    download_result = sandbox.download_files(["/mnt/user-data/workspace/demo.txt"])
    assert download_result[0].path == "/mnt/user-data/workspace/demo.txt"
    assert download_result[0].content == b"hello"


def test_aio_sandbox_transport_logs_execute_upload_and_download(monkeypatch, caplog):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)
    caplog.set_level(logging.INFO, logger=aio_sandbox_module.__name__)

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-log",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-log/user-data",
    )

    sandbox.execute("pwd")
    sandbox.upload_files([("/mnt/user-data/workspace/demo.txt", b"hello")])
    sandbox.download_files(["/mnt/user-data/workspace/demo.txt"])

    assert "sandbox-aio transport sandbox_id=sb-log" in caplog.text
    assert "operation=execute" in caplog.text
    assert "operation=upload_files" in caplog.text
    assert "operation=download_files" in caplog.text
    assert "first_transport_path='/openagents/threads/thread-log/user-data/workspace/demo.txt'" in caplog.text


def test_aio_sandbox_ls_info_virtualizes_runtime_root_paths(monkeypatch):
    captured: dict[str, str] = {}

    def fake_ls_info(self, path: str):
        captured["path"] = path
        return [
            {
                "path": "/openagents/threads/thread-3/user-data/agents/dev/lead_agent",
                "is_dir": True,
            }
        ]

    monkeypatch.setattr(BaseSandbox, "ls_info", fake_ls_info)
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-6",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-3/user-data",
    )

    result = sandbox.ls_info("/")

    assert captured["path"] == "/mnt/user-data"
    assert result == [
        {
            "path": "/mnt/user-data/agents/dev/lead_agent",
            "is_dir": True,
        }
    ]


def test_aio_sandbox_ls_info_uses_host_paths_when_exec_isolation_disabled(monkeypatch):
    captured: dict[str, str] = {}

    def fake_ls_info(self, path: str):
        captured["path"] = path
        return []

    monkeypatch.setattr(BaseSandbox, "ls_info", fake_ls_info)
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)
    monkeypatch.setenv("OPENAGENTS_SANDBOX_EXEC_ISOLATION", "off")

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-6b",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-3/user-data",
    )

    sandbox.ls_info("/")

    assert captured["path"] == "/openagents/threads/thread-3/user-data"


def test_aio_sandbox_glob_info_rewrites_virtual_patterns(monkeypatch):
    captured: dict[str, str] = {}

    def fake_glob_info(self, pattern: str, path: str = "/"):
        captured["pattern"] = pattern
        captured["path"] = path
        return [
            {
                "path": "/openagents/threads/thread-4/user-data/agents/dev/lead_agent/skills/review/SKILL.md",
                "is_dir": False,
            }
        ]

    monkeypatch.setattr(BaseSandbox, "glob_info", fake_glob_info)
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-7",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-4/user-data",
    )

    result = sandbox.glob_info("/mnt/user-data/agents/dev/lead_agent/skills/**/*")

    assert captured["path"] == "/mnt/user-data"
    assert captured["pattern"] == "/mnt/user-data/agents/dev/lead_agent/skills/**/*"
    assert result == [
        {
            "path": "/mnt/user-data/agents/dev/lead_agent/skills/review/SKILL.md",
            "is_dir": False,
        }
    ]


def test_aio_sandbox_glob_info_uses_host_paths_when_exec_isolation_disabled(monkeypatch):
    captured: dict[str, str] = {}

    def fake_glob_info(self, pattern: str, path: str = "/"):
        captured["pattern"] = pattern
        captured["path"] = path
        return []

    monkeypatch.setattr(BaseSandbox, "glob_info", fake_glob_info)
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)
    monkeypatch.setenv("OPENAGENTS_SANDBOX_EXEC_ISOLATION", "off")

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-7b",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-4/user-data",
    )

    sandbox.glob_info("/mnt/user-data/agents/dev/lead_agent/skills/**/*")

    assert captured["path"] == "/openagents/threads/thread-4/user-data"
    assert (
        captured["pattern"]
        == "/openagents/threads/thread-4/user-data/agents/dev/lead_agent/skills/**/*"
    )


def test_aio_sandbox_grep_raw_virtualizes_result_paths(monkeypatch):
    captured: dict[str, str | None] = {}

    def fake_grep_raw(self, pattern: str, path: str | None = None, glob: str | None = None):
        captured["pattern"] = pattern
        captured["path"] = path
        captured["glob"] = glob
        return [
            {
                "path": "/openagents/threads/thread-5/user-data/agents/dev/lead_agent/AGENTS.md",
                "line": 7,
                "text": "contract review",
            }
        ]

    monkeypatch.setattr(BaseSandbox, "grep_raw", fake_grep_raw)
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-8",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-5/user-data",
    )

    result = sandbox.grep_raw("contract", path="/mnt/user-data/agents/dev", glob="*.md")

    assert captured["pattern"] == "contract"
    assert captured["path"] == "/openagents/threads/thread-5/user-data/agents/dev"
    assert captured["glob"] == "*.md"
    assert result == [
        {
            "path": "/mnt/user-data/agents/dev/lead_agent/AGENTS.md",
            "line": 7,
            "text": "contract review",
        }
    ]
