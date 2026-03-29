package bootstrap

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/joho/godotenv"
)

func sourceDir() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		panic("bootstrap source path unavailable")
	}
	return filepath.Dir(filename)
}

func pathFromSource(relativePath string) string {
	return filepath.Clean(filepath.Join(sourceDir(), relativePath))
}

// RepoRootDir returns the repository root derived from this source file.
func RepoRootDir() string {
	return pathFromSource("../../../..")
}

// GatewayDir returns the backend/gateway directory.
func GatewayDir() string {
	return pathFromSource("../..")
}

// SharedEnvPath returns the repository-wide .env path.
func SharedEnvPath() string {
	return filepath.Join(RepoRootDir(), ".env")
}

// GatewayConfigPath returns the canonical gateway config file path.
func GatewayConfigPath() string {
	return filepath.Join(GatewayDir(), "gateway.yaml")
}

func resolveExplicitPath(envVarName string) string {
	raw := filepath.Clean(os.Getenv(envVarName))
	if raw == "" || raw == "." {
		return ""
	}
	if filepath.IsAbs(raw) {
		return raw
	}
	cwd, err := os.Getwd()
	if err != nil {
		return raw
	}
	return filepath.Join(cwd, raw)
}

// MainConfigPath returns the repository-wide config.yaml path.
func MainConfigPath() string {
	if path := resolveExplicitPath("OPENAGENTS_CONFIG_PATH"); path != "" {
		return path
	}
	return filepath.Join(RepoRootDir(), "config.yaml")
}

// ExtensionsConfigPath returns the unified extensions config path.
func ExtensionsConfigPath() string {
	if path := resolveExplicitPath("OPENAGENTS_EXTENSIONS_CONFIG_PATH"); path != "" {
		return path
	}
	return filepath.Join(RepoRootDir(), "extensions_config.json")
}

// LoadSharedEnv loads the repository-wide .env file.
func LoadSharedEnv() error {
	err := godotenv.Load(SharedEnvPath())
	if err == nil || errors.Is(err, os.ErrNotExist) {
		return err
	}
	return fmt.Errorf("load shared env: %w", err)
}
