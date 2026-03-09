from types import SimpleNamespace

from deepagents.backends.sandbox import BaseSandbox

from src.community.aio_sandbox import aio_sandbox as aio_sandbox_module


class _DummyShell:
    def exec_command(self, **kwargs):
        self.last_call = kwargs
        return SimpleNamespace(output="sandbox-ok", status="completed", exit_code=0)


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
