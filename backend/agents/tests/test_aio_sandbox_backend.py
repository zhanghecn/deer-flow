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

    assert sandbox._client.shell.last_call["command"].startswith(
        "python /mnt/user-data/agents/dev/lead_agent/skills/image-generation/scripts/generate.py"
    )
    assert "/mnt/user-data/outputs/demo.jpg" in sandbox._client.shell.last_call["command"]


def test_aio_sandbox_execute_rewrites_virtual_paths_into_thread_mount(monkeypatch):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-4",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-1/user-data",
    )

    sandbox.execute("python /mnt/user-data/agents/dev/lead_agent/skills/image-generation/scripts/generate.py --output-file /mnt/user-data/outputs/demo.jpg")

    assert sandbox._client.shell.last_call["exec_dir"] == "/openagents/threads/thread-1/user-data"
    assert sandbox._client.shell.last_call["command"].startswith(
        "python /openagents/threads/thread-1/user-data/agents/dev/lead_agent/skills/image-generation/scripts/generate.py"
    )
    assert "/openagents/threads/thread-1/user-data/outputs/demo.jpg" in sandbox._client.shell.last_call["command"]


def test_aio_sandbox_file_api_rewrites_virtual_paths_into_thread_mount(monkeypatch):
    monkeypatch.setattr(aio_sandbox_module, "AioSandboxClient", _DummyClient)

    sandbox = aio_sandbox_module.AioSandbox(
        id="sb-5",
        base_url="http://sandbox.test",
        runtime_root="/openagents/threads/thread-2/user-data",
    )

    upload_result = sandbox.upload_files([("/mnt/user-data/workspace/demo.txt", b"hello")])
    assert upload_result[0].error is None
    assert "/openagents/threads/thread-2/user-data/workspace/demo.txt" in sandbox._client.file.uploads

    download_result = sandbox.download_files(["/mnt/user-data/workspace/demo.txt"])
    assert download_result[0].content == b"hello"
