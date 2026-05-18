package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const DefaultPublicAPILangGraphTimeoutSeconds = 5400

type Config struct {
	Server     ServerConfig     `yaml:"server"`
	Database   DatabaseConfig   `yaml:"database"`
	JWT        JWTConfig        `yaml:"jwt"`
	Storage    StorageConfig    `yaml:"storage"`
	Logging    LoggingConfig    `yaml:"logging"`
	Upstream   UpstreamConfig   `yaml:"upstream"`
	OnlyOffice OnlyOfficeConfig `yaml:"onlyoffice"`
	PublicAPI  PublicAPIConfig  `yaml:"public_api"`
	Proxy      ProxyConfig      `yaml:"proxy"`
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

type ServerConfig struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

type DatabaseConfig struct {
	URI string `yaml:"uri"`
}

func (d DatabaseConfig) DSN() string {
	return strings.TrimSpace(d.URI)
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

type PublicAPIConfig struct {
	LangGraphTimeoutSeconds int `yaml:"langgraph_timeout_seconds"`
}

func (p PublicAPIConfig) LangGraphTimeout() time.Duration {
	return time.Duration(p.LangGraphTimeoutSeconds) * time.Second
}

type OnlyOfficeConfig struct {
	ServerURL         string `yaml:"server_url"`
	InternalServerURL string `yaml:"internal_server_url"`
	PublicAppURL      string `yaml:"public_app_url"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{
			Port: 8001,
			Host: "0.0.0.0",
		},
		Database: DatabaseConfig{
			URI: "",
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
		OnlyOffice: OnlyOfficeConfig{
			ServerURL:         "http://localhost:8082",
			InternalServerURL: "http://localhost:8082",
			PublicAppURL:      "http://host.docker.internal:8001",
		},
		PublicAPI: PublicAPIConfig{
			LangGraphTimeoutSeconds: DefaultPublicAPILangGraphTimeoutSeconds,
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
	if err := cfg.applyEnvOverrides(); err != nil {
		return nil, err
	}
	cfg.normalizeDerivedConfig()
	if cfg.PublicAPI.LangGraphTimeoutSeconds <= 0 {
		return nil, fmt.Errorf("public_api.langgraph_timeout_seconds must be positive")
	}
	if cfg.Database.DSN() == "" {
		return nil, fmt.Errorf("database.uri is required (set DATABASE_URI)")
	}

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
	c.Database.URI = resolve(c.Database.URI)
	c.JWT.Secret = resolve(c.JWT.Secret)
	c.Upstream.LangGraphURL = resolve(c.Upstream.LangGraphURL)
	c.OnlyOffice.ServerURL = resolve(c.OnlyOffice.ServerURL)
	c.OnlyOffice.InternalServerURL = resolve(c.OnlyOffice.InternalServerURL)
	c.OnlyOffice.PublicAppURL = resolve(c.OnlyOffice.PublicAppURL)
	for i := range c.Proxy.Routes {
		c.Proxy.Routes[i].Upstream = resolve(c.Proxy.Routes[i].Upstream)
	}

	if c.Logging.Level == "" {
		c.Logging.Level = "info"
	}
}

func (c *Config) applyEnvOverrides() error {
	override := func(envVar string, target *string) {
		if value := strings.TrimSpace(os.Getenv(envVar)); value != "" {
			*target = value
		}
	}

	override("LANGGRAPH_URL", &c.Upstream.LangGraphURL)
	override("ONLYOFFICE_SERVER_URL", &c.OnlyOffice.ServerURL)
	override("ONLYOFFICE_INTERNAL_SERVER_URL", &c.OnlyOffice.InternalServerURL)
	override("ONLYOFFICE_PUBLIC_APP_URL", &c.OnlyOffice.PublicAppURL)

	if value := strings.TrimSpace(os.Getenv("OPENAGENTS_PUBLIC_API_LANGGRAPH_TIMEOUT_SECONDS")); value != "" {
		seconds, err := strconv.Atoi(value)
		if err != nil || seconds <= 0 {
			return fmt.Errorf("OPENAGENTS_PUBLIC_API_LANGGRAPH_TIMEOUT_SECONDS must be a positive integer")
		}
		// This timeout covers the gateway -> LangGraph hop for external SDK
		// turns. It must be longer than expensive domain agents that perform
		// knowledge search, validation, and artifact packaging in one turn.
		c.PublicAPI.LangGraphTimeoutSeconds = seconds
	}
	return nil
}

func (c *Config) normalizeDerivedConfig() {
	for i := range c.Proxy.Routes {
		if strings.TrimSpace(c.Proxy.Routes[i].Prefix) == "/api/langgraph" {
			c.Proxy.Routes[i].Upstream = c.Upstream.LangGraphURL
		}
	}
}
