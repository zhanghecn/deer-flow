package main

import (
	"testing"
)

func TestResolveOnlyOfficeJWTSecretFallsBackToGatewayJWTSecret(t *testing.T) {
	t.Setenv("ONLYOFFICE_JWT_SECRET", "")
	t.Setenv("JWT_SECRET", "gateway-secret")

	if got := resolveOnlyOfficeJWTSecret(); got != "gateway-secret" {
		t.Fatalf("expected gateway JWT secret fallback, got %q", got)
	}
}

func TestResolveOnlyOfficeJWTSecretPrefersExplicitOverride(t *testing.T) {
	t.Setenv("ONLYOFFICE_JWT_SECRET", "office-secret")
	t.Setenv("JWT_SECRET", "gateway-secret")

	if got := resolveOnlyOfficeJWTSecret(); got != "office-secret" {
		t.Fatalf("expected explicit ONLYOFFICE secret, got %q", got)
	}
}

func TestResolveOnlyOfficeJWTSecretTrimsWhitespace(t *testing.T) {
	t.Setenv("ONLYOFFICE_JWT_SECRET", "  office-secret  ")
	t.Setenv("JWT_SECRET", "  gateway-secret  ")

	if got := resolveOnlyOfficeJWTSecret(); got != "office-secret" {
		t.Fatalf("expected trimmed ONLYOFFICE secret, got %q", got)
	}
}
