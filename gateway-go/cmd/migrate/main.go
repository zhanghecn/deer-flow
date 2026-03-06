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

func checkPassword() string {
	password := os.Getenv("DB_PASSWORD")
	if password == "" {
		fmt.Println("Warning: DB_PASSWORD is not set (empty)")
	}
	return password
}

func main() {
	// Try to load .env file (ignore error if it doesn't exist)
	if err := godotenv.Load(); err != nil {
		fmt.Printf("Note: .env file not found, using environment variables\n")
	}

	fmt.Println("Starting database migration...")

	// Load config from gateway.yaml
	cfg, err := config.Load("gateway.yaml")
	if err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Override password if set in env (for security)
	if password := checkPassword(); password != "" {
		cfg.Database.Password = password
	}

	dsn := cfg.Database.DSN()
	fmt.Printf("Connecting to database: %s@%s:%s/%s\n",
		cfg.Database.User, cfg.Database.Host, cfg.Database.Port, cfg.Database.DBName)

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
