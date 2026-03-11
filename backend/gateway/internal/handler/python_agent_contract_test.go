package handler

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPythonLeadAgentModelResolutionContract(t *testing.T) {
	t.Parallel()

	_, filePath, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("failed to get caller path")
	}
	gatewayRoot := filepath.Clean(filepath.Join(filepath.Dir(filePath), "..", ".."))
	projectRoot := filepath.Clean(filepath.Join(gatewayRoot, ".."))
	backendRoot := filepath.Join(projectRoot, "backend")
	pythonBin := filepath.Join(backendRoot, ".venv", "bin", "python")
	if _, err := os.Stat(pythonBin); err != nil {
		t.Skipf("python runtime not found at %s: %v", pythonBin, err)
	}

	script := `
from src.agents.lead_agent.agent import _parse_runtime_model_config, _resolve_run_model
from src.config.model_config import ModelConfig
from src.config.agents_config import AgentConfig

class FakeStore:
    def __init__(self):
        self.models = {
            "contract-model": ModelConfig.model_validate({
                "name": "contract-model",
                "use": "langchain_openai:ChatOpenAI",
                "model": "gpt-4.1"
            }),
            "thread-model": ModelConfig.model_validate({
                "name": "thread-model",
                "use": "langchain_openai:ChatOpenAI",
                "model": "gpt-4.1"
            }),
        }

    def get_model(self, name):
        return self.models.get(name)

    def get_thread_runtime_model(self, *, thread_id, user_id):
        if thread_id == "thread-1" and user_id == "user-1":
            return "thread-model"
        return None

store = FakeStore()

runtime = _parse_runtime_model_config({
    "name": "contract-model",
    "use": "langchain_openai:ChatOpenAI",
    "model": "gpt-4.1"
})
name, config = _resolve_run_model(
    requested_model_name=None,
    runtime_model_name=runtime,
    agent_config=None,
    thread_id=None,
    user_id=None,
    db_store=store,
)
assert name == "contract-model"
assert config.name == "contract-model"

name, config = _resolve_run_model(
    requested_model_name=None,
    runtime_model_name=None,
    agent_config=None,
    thread_id="thread-1",
    user_id="user-1",
    db_store=store,
)
assert name == "thread-model"
assert config.name == "thread-model"

try:
    _resolve_run_model(
        requested_model_name="model-b",
        runtime_model_name=None,
        agent_config=AgentConfig(
            name="agent-a",
            status="dev",
            model="model-a",
            tool_groups=[],
            mcp_servers=[],
        ),
        thread_id=None,
        user_id=None,
        db_store=store,
    )
except ValueError as e:
    assert "Model conflict" in str(e), str(e)
else:
    raise AssertionError("expected model conflict error")

try:
    _resolve_run_model(
        requested_model_name=None,
        runtime_model_name=None,
        agent_config=None,
        thread_id=None,
        user_id=None,
        db_store=store,
    )
except ValueError as e:
    assert "No model resolved for this run" in str(e), str(e)
else:
    raise AssertionError("expected unresolved model error")
`

	cmd := exec.Command(pythonBin, "-c", script)
	cmd.Dir = backendRoot
	cmd.Env = append(os.Environ(), "PYTHONPATH="+backendRoot)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python contract failed: %v\n%s", err, string(output))
	}
}
