package bootstrap

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestRootMigrationsStayAsTwoBaselineSQLFiles(t *testing.T) {
	t.Parallel()

	migrationsDir := filepath.Join(RepoRootDir(), "migrations")
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		t.Fatalf("read migrations dir: %v", err)
	}

	var sqlFiles []string
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		sqlFiles = append(sqlFiles, entry.Name())
	}

	slices.Sort(sqlFiles)

	// Keep the manual bootstrap contract stable: one schema SQL and one data SQL.
	want := []string{
		"001_init.up.sql",
		"002_seed_data.up.sql",
	}
	if !slices.Equal(sqlFiles, want) {
		t.Fatalf("unexpected root migration SQL files: got %v want %v", sqlFiles, want)
	}
}
