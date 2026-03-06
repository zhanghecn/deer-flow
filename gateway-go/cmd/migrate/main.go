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
)

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func buildDSN(host, port, user, password, dbname, sslmode string) string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		user, password, host, port, dbname, sslmode)
}

func main() {
	// Try to load .env file (ignore error if it doesn't exist)
	if err := godotenv.Load(); err != nil {
		fmt.Printf("Note: .env file not found, using environment variables\n")
	}

	fmt.Println("Starting database migration...")

	host := getEnvOrDefault("DB_HOST", "localhost")
	port := getEnvOrDefault("DB_PORT", "5432")
	user := getEnvOrDefault("DB_USER", "root")
	password := checkPassword()
	dbname := getEnvOrDefault("DB_NAME", "openagents")

	fmt.Printf("Connecting to database: %s:%s@%s:%s/%s\n", user, password, host, port, dbname)

	sslmode := getEnvOrDefault("DB_SSLMODE", "disable")
	dsn := buildDSN(host, port, user, password, dbname, sslmode)

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

func checkPassword() string {
	password := os.Getenv("DB_PASSWORD")
	if password == "" {
		fmt.Println("Warning: DB_PASSWORD is not set (empty)")
	}
	return password
}
