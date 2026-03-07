package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server           ServerConfig           `yaml:"server"`
	Database         DatabaseConfig         `yaml:"database"`
	JWT              JWTConfig              `yaml:"jwt"`
	Storage          StorageConfig          `yaml:"storage"`
	Logging          LoggingConfig          `yaml:"logging"`
	Upstream         UpstreamConfig         `yaml:"upstream"`
	Proxy            ProxyConfig            `yaml:"proxy"`
	LangGraphRuntime LangGraphRuntimeConfig `yaml:"langgraph_runtime"`
}

type ProxyConfig struct {
	Routes []ProxyRouteConfig `yaml:"routes"`
}

type ProxyRouteConfig struct {
	Prefix        string            `yaml:"prefix"`
	Upstream      string            `yaml:"upstream"`
	StripPrefix   bool              `yaml:"strip_prefix"`
	Auth          string            `yaml:"auth"`
	InjectHeaders map[string]string `yaml:"inject_headers"`
	InjectBody    map[string]string `yaml:"inject_body"`
}

type LangGraphRuntimeConfig struct {
	ModelRequiredPaths []string `yaml:"model_required_paths"`
	ModelOptionalPaths []string `yaml:"model_optional_paths"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

type DatabaseConfig struct {
	Host     string `yaml:"host"`
	Port     string `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	DBName   string `yaml:"dbname"`
	SSLMode  string `yaml:"sslmode"`
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.DBName, d.SSLMode)
}

type JWTConfig struct {
	Secret     string `yaml:"secret"`
	ExpireHour int    `yaml:"expire_hour"`
}

type StorageConfig struct {
	BaseDir string `yaml:"base_dir"`
}

type LoggingConfig struct {
	Level           string `yaml:"level"`             // debug | info | warn | error
	AccessLog       bool   `yaml:"access_log"`        // Gin access log
	ProxyDebug      bool   `yaml:"proxy_debug"`       // detailed proxy request/response logs
	ProxyLogHeaders bool   `yaml:"proxy_log_headers"` // include request headers in debug logs
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
			Host:     "localhost",
			Port:     "5432",
			User:     "root",
			Password: "zhangxuan66",
			DBName:   "openagents",
			SSLMode:  "disable",
		},
		JWT: JWTConfig{
			ExpireHour: 72,
		},
		Storage: StorageConfig{
			BaseDir: ".openagents",
		},
		Logging: LoggingConfig{
			Level:           "info",
			AccessLog:       true,
			ProxyDebug:      false,
			ProxyLogHeaders: false,
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
	c.Database.Port = resolve(c.Database.Port)
	c.Database.DBName = resolve(c.Database.DBName)
	c.Database.SSLMode = resolve(c.Database.SSLMode)
	c.JWT.Secret = resolve(c.JWT.Secret)
	c.Upstream.LangGraphURL = resolve(c.Upstream.LangGraphURL)
	for i := range c.Proxy.Routes {
		c.Proxy.Routes[i].Upstream = resolve(c.Proxy.Routes[i].Upstream)
	}

	if c.Logging.Level == "" {
		c.Logging.Level = "info"
	}
}
