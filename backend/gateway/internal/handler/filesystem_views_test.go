package handler

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/pkg/storage"
)

func TestListFilesystemAgentsSkipsBuiltinLeadAgent(t *testing.T) {
	t.Parallel()

	baseDir := filepath.Join(t.TempDir(), ".openagents")
	writeAgent := func(status string, name string) {
		agentDir := filepath.Join(baseDir, "agents", status, name)
		if err := os.MkdirAll(agentDir, 0755); err != nil {
			t.Fatalf("mkdir %s: %v", agentDir, err)
		}
		config := "name: " + name + "\nstatus: " + status + "\nagents_md_path: AGENTS.md\n"
		if err := os.WriteFile(filepath.Join(agentDir, "config.yaml"), []byte(config), 0644); err != nil {
			t.Fatalf("write config: %v", err)
		}
		if err := os.WriteFile(filepath.Join(agentDir, "AGENTS.md"), []byte("# "+name), 0644); err != nil {
			t.Fatalf("write AGENTS.md: %v", err)
		}
	}

	writeAgent("dev", "lead_agent")
	writeAgent("dev", "contract-review-agent")

	agents, err := agentfs.ListAgents(storage.NewFS(baseDir), "")
	if err != nil {
		t.Fatalf("agentfs.ListAgents() error = %v", err)
	}
	if len(agents) != 1 {
		t.Fatalf("len(agents) = %d, want 1", len(agents))
	}
	if agents[0].Name != "contract-review-agent" {
		t.Fatalf("agents[0].Name = %q, want %q", agents[0].Name, "contract-review-agent")
	}
}
