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

// MainConfigPath returns the repository-wide config.yaml path.
func MainConfigPath() string {
	return filepath.Join(RepoRootDir(), "config.yaml")
}

// MigrationsDir returns the repository migrations directory.
func MigrationsDir() string {
	return filepath.Join(RepoRootDir(), "migrations")
}

// LoadSharedEnv loads the repository-wide .env file.
func LoadSharedEnv() error {
	err := godotenv.Load(SharedEnvPath())
	if err == nil || errors.Is(err, os.ErrNotExist) {
		return err
	}
	return fmt.Errorf("load shared env: %w", err)
}

// MigrationsSourceURL returns the golang-migrate file source URL.
func MigrationsSourceURL() (string, error) {
	migrationsDir := MigrationsDir()
	info, err := os.Stat(migrationsDir)
	if err != nil {
		return "", fmt.Errorf("stat migrations dir: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("migrations path is not a directory: %s", migrationsDir)
	}
	return "file://" + migrationsDir, nil
}
