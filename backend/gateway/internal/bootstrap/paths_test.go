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

func TestMigrationsDirExists(t *testing.T) {
	t.Parallel()

	path := MigrationsDir()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat migrations dir: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("migrations path is not a directory: %s", path)
	}
}

func TestMigrationsSourceURLMatchesMigrationsDir(t *testing.T) {
	t.Parallel()

	sourceURL, err := MigrationsSourceURL()
	if err != nil {
		t.Fatalf("resolve migrations source url: %v", err)
	}

	expected := "file://" + MigrationsDir()
	if sourceURL != expected {
		t.Fatalf("unexpected migrations source url: got %s want %s", sourceURL, expected)
	}
}
