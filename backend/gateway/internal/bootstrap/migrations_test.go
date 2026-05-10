package bootstrap

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestRootMigrationsKeepOrderedUpSQLContract(t *testing.T) {
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

	// Deploy uses a migration ledger now, so future reviewed SQL changes may be
	// appended. The first two files remain the immutable empty-database baseline.
	if len(sqlFiles) < 2 {
		t.Fatalf("expected at least baseline migrations, got %v", sqlFiles)
	}

	wantPrefix := []string{
		"001_init.up.sql",
		"002_seed_data.up.sql",
	}
	if !slices.Equal(sqlFiles[:2], wantPrefix) {
		t.Fatalf("unexpected baseline migration prefix: got %v want %v", sqlFiles[:2], wantPrefix)
	}

	for _, file := range sqlFiles {
		if filepath.Ext(file) != ".sql" || len(file) < len("001_x.up.sql") || file[len(file)-len(".up.sql"):] != ".up.sql" {
			t.Fatalf("migration file must use the reviewed *.up.sql contract: %s", file)
		}
	}
}
