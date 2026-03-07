package main

import (
	"database/sql"
	"fmt"
	"os"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"

	"github.com/openagents/gateway/internal/config"
)

func main() {
	// Prefer shared root env, keep local .env as fallback.
	loadedEnv := false
	for _, envPath := range []string{"../../.env", ".env"} {
		if err := godotenv.Load(envPath); err == nil {
			loadedEnv = true
		}
	}
	if !loadedEnv {
		fmt.Printf("Note: .env file not found in ../../.env or .env, using environment variables\n")
	}

	fmt.Println("Starting database migration...")

	// Load config from gateway.yaml
	cfg, err := config.Load("gateway.yaml")
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	dsn := cfg.Database.DSN()
	fmt.Println("Connecting to database using configured DSN")

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		fmt.Printf("Error connecting to database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	driver, err := pgx.WithInstance(db, &pgx.Config{})
	if err != nil {
		fmt.Printf("Error creating migrate driver: %v\n", err)
		os.Exit(1)
	}

	m, err := migrate.NewWithDatabaseInstance(
		"file://migrations",
		"pgx",
		driver,
	)
	if err != nil {
		fmt.Printf("Error creating migrate instance: %v\n", err)
		os.Exit(1)
	}

	version, dirty, _ := m.Version()
	fmt.Printf("Current database version: %d (dirty: %v)\n", version, dirty)

	fmt.Println("Applying migrations...")
	if err := m.Up(); err != nil {
		if err == migrate.ErrNoChange {
			fmt.Println("No new migrations to apply")
		} else {
			fmt.Printf("Error running migrations: %v\n", err)
			os.Exit(1)
		}
	}

	version, dirty, _ = m.Version()
	fmt.Printf("Migration completed. Current version: %d (dirty: %v)\n", version, dirty)
}
