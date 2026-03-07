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

runtime = _parse_runtime_model_config({
    "name": "contract-model",
    "use": "langchain_openai:ChatOpenAI",
    "model": "gpt-4.1"
})
name, config = _resolve_run_model(
    requested_model_name=None,
    runtime_model_config=runtime,
    agent_model_name=None,
)
assert name == "contract-model"
assert config.name == "contract-model"

try:
    _resolve_run_model(
        requested_model_name=None,
        runtime_model_config=None,
        agent_model_name=None,
    )
except ValueError as e:
    assert "No model resolved for this run" in str(e), str(e)
else:
    raise AssertionError("expected unresolved model error")

runtime_conflict = _parse_runtime_model_config({
    "name": "model-a",
    "use": "langchain_openai:ChatOpenAI",
    "model": "gpt-4.1"
})
try:
    _resolve_run_model(
        requested_model_name="model-b",
        runtime_model_config=runtime_conflict,
        agent_model_name=None,
    )
except ValueError as e:
    assert "Model conflict" in str(e), str(e)
else:
    raise AssertionError("expected model conflict error")
`

	cmd := exec.Command(pythonBin, "-c", script)
	cmd.Dir = backendRoot
	cmd.Env = append(os.Environ(), "PYTHONPATH="+backendRoot)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("python contract failed: %v\n%s", err, string(output))
	}
}
