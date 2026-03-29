package bootstrap

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGatewayConfigPathPointsToGatewayConfig(t *testing.T) {
	t.Parallel()

	path := GatewayConfigPath()
	if filepath.Base(path) != "gateway.yaml" {
		t.Fatalf("unexpected gateway config path: %s", path)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat gateway config: %v", err)
	}
	if info.IsDir() {
		t.Fatalf("gateway config path is a directory: %s", path)
	}
}

func TestMainConfigPathPointsToRepoConfig(t *testing.T) {
	t.Parallel()

	path := MainConfigPath()
	if filepath.Base(path) != "config.yaml" {
		t.Fatalf("unexpected main config path: %s", path)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat main config: %v", err)
	}
	if info.IsDir() {
		t.Fatalf("main config path is a directory: %s", path)
	}
}

func TestMainConfigPathRespectsEnvOverride(t *testing.T) {
	overridePath := filepath.Join(t.TempDir(), "runtime-config.yaml")
	if err := os.WriteFile(overridePath, []byte("models: []\n"), 0644); err != nil {
		t.Fatalf("write override config: %v", err)
	}

	t.Setenv("OPENAGENTS_CONFIG_PATH", overridePath)

	if got := MainConfigPath(); got != overridePath {
		t.Fatalf("unexpected main config override: got %s want %s", got, overridePath)
	}
}

func TestExtensionsConfigPathDefaultsToRepoRoot(t *testing.T) {
	t.Parallel()

	path := ExtensionsConfigPath()
	if filepath.Base(path) != "extensions_config.json" {
		t.Fatalf("unexpected extensions config path: %s", path)
	}
}

func TestExtensionsConfigPathRespectsEnvOverride(t *testing.T) {
	overridePath := filepath.Join(t.TempDir(), "extensions.json")
	if err := os.WriteFile(overridePath, []byte("{}\n"), 0644); err != nil {
		t.Fatalf("write override extensions config: %v", err)
	}

	t.Setenv("OPENAGENTS_EXTENSIONS_CONFIG_PATH", overridePath)

	if got := ExtensionsConfigPath(); got != overridePath {
		t.Fatalf("unexpected extensions config override: got %s want %s", got, overridePath)
	}
}
