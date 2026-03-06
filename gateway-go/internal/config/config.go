package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	JWT      JWTConfig      `yaml:"jwt"`
	Storage  StorageConfig  `yaml:"storage"`
	Upstream UpstreamConfig `yaml:"upstream"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

type DatabaseConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	DBName   string `yaml:"dbname"`
	SSLMode  string `yaml:"sslmode"`
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.DBName, d.SSLMode)
}

type JWTConfig struct {
	Secret     string `yaml:"secret"`
	ExpireHour int    `yaml:"expire_hour"`
}

type StorageConfig struct {
	BaseDir string `yaml:"base_dir"`
}

type UpstreamConfig struct {
	LangGraphURL string `yaml:"langgraph_url"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{
			Port: 8001,
			Host: "0.0.0.0",
		},
		Database: DatabaseConfig{
			Host:    "localhost",
			Port:    5432,
			User:    "openagents",
			DBName:  "openagents",
			SSLMode: "disable",
		},
		JWT: JWTConfig{
			ExpireHour: 72,
		},
		Storage: StorageConfig{
			BaseDir: ".openagents",
		},
		Upstream: UpstreamConfig{
			LangGraphURL: "http://localhost:2024",
		},
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, fmt.Errorf("read config: %w", err)
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	cfg.resolveEnvVars()

	// Allow OPENAGENTS_HOME env var to override storage.base_dir
	// This is the same env var used by the Python backend (src/config/paths.py)
	if envHome := os.Getenv("OPENAGENTS_HOME"); envHome != "" && cfg.Storage.BaseDir == ".openagents" {
		cfg.Storage.BaseDir = envHome
	}

	return cfg, nil
}

func (c *Config) resolveEnvVars() {
	resolve := func(s string) string {
		if strings.HasPrefix(s, "$") {
			return os.Getenv(strings.TrimPrefix(s, "$"))
		}
		return s
	}
	c.Database.Password = resolve(c.Database.Password)
	c.Database.User = resolve(c.Database.User)
	c.Database.Host = resolve(c.Database.Host)
	c.JWT.Secret = resolve(c.JWT.Secret)
}
