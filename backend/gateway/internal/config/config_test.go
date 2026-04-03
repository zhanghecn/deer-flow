package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadUsesGatewayDefaultsForNonSecretURLs(t *testing.T) {
	t.Parallel()

	configPath := filepath.Join(t.TempDir(), "gateway.yaml")
	if err := os.WriteFile(configPath, []byte("database:\n  uri: postgres://db\njwt:\n  secret: secret\n"), 0644); err != nil {
		t.Fatalf("write gateway config: %v", err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("load gateway config: %v", err)
	}

	if cfg.Upstream.LangGraphURL != "http://localhost:2024" {
		t.Fatalf("unexpected default langgraph url: %s", cfg.Upstream.LangGraphURL)
	}
	if cfg.OnlyOffice.ServerURL != "http://localhost:8082" {
		t.Fatalf("unexpected default onlyoffice server url: %s", cfg.OnlyOffice.ServerURL)
	}
	if cfg.OnlyOffice.InternalServerURL != "http://localhost:8082" {
		t.Fatalf("unexpected default onlyoffice internal url: %s", cfg.OnlyOffice.InternalServerURL)
	}
	if cfg.OnlyOffice.PublicAppURL != "http://host.docker.internal:8001" {
		t.Fatalf("unexpected default onlyoffice public url: %s", cfg.OnlyOffice.PublicAppURL)
	}
}

func TestLoadAllowsExplicitEnvOverridesForContainerWiring(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "gateway.yaml")
	if err := os.WriteFile(
		configPath,
		[]byte(
			"database:\n  uri: postgres://db\njwt:\n  secret: secret\nupstream:\n  langgraph_url: http://localhost:2024\nonlyoffice:\n  server_url: http://localhost:8082\n  public_app_url: http://host.docker.internal:8001\nproxy:\n  routes:\n    - prefix: /api/langgraph\n      upstream: http://localhost:2024\n      strip_prefix: true\n      auth: jwt\n",
		),
		0644,
	); err != nil {
		t.Fatalf("write gateway config: %v", err)
	}

	t.Setenv("LANGGRAPH_URL", "http://langgraph:2024")
	t.Setenv("ONLYOFFICE_SERVER_URL", "/onlyoffice")
	t.Setenv("ONLYOFFICE_INTERNAL_SERVER_URL", "http://onlyoffice")
	t.Setenv("ONLYOFFICE_PUBLIC_APP_URL", "http://gateway:8001")

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("load gateway config: %v", err)
	}

	if cfg.Upstream.LangGraphURL != "http://langgraph:2024" {
		t.Fatalf("unexpected overridden langgraph url: %s", cfg.Upstream.LangGraphURL)
	}
	if len(cfg.Proxy.Routes) != 1 || cfg.Proxy.Routes[0].Upstream != "http://langgraph:2024" {
		t.Fatalf("expected proxy langgraph upstream override, got %#v", cfg.Proxy.Routes)
	}
	if cfg.OnlyOffice.ServerURL != "/onlyoffice" {
		t.Fatalf("unexpected overridden onlyoffice server url: %s", cfg.OnlyOffice.ServerURL)
	}
	if cfg.OnlyOffice.InternalServerURL != "http://onlyoffice" {
		t.Fatalf("unexpected overridden onlyoffice internal url: %s", cfg.OnlyOffice.InternalServerURL)
	}
	if cfg.OnlyOffice.PublicAppURL != "http://gateway:8001" {
		t.Fatalf("unexpected overridden onlyoffice public url: %s", cfg.OnlyOffice.PublicAppURL)
	}
}
