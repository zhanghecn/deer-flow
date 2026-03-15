package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/openagents/gateway/internal/bootstrap"
	"github.com/openagents/gateway/internal/config"
)

func main() {
	if err := bootstrap.LoadSharedEnv(); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			fmt.Printf("Error loading root .env: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf(
			"Note: root .env file not found at %s, using environment variables\n",
			bootstrap.SharedEnvPath(),
		)
	}

	fmt.Println("Starting database migration...")

	cfg, err := config.Load(bootstrap.GatewayConfigPath())
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

	sourceURL, err := bootstrap.MigrationsSourceURL()
	if err != nil {
		fmt.Printf("Error resolving migrations directory: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Using migrations from: %s\n", sourceURL)

	m, err := migrate.NewWithDatabaseInstance(
		sourceURL,
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
