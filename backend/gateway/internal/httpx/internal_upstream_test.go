package httpx

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewInternalHTTPClientBypassesEnvironmentProxy(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("target"))
	}))
	t.Cleanup(target.Close)

	var proxyHits atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyHits.Add(1)
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("proxy"))
	}))
	t.Cleanup(proxy.Close)

	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("HTTPS_PROXY", proxy.URL)
	t.Setenv("NO_PROXY", "")
	t.Setenv("http_proxy", proxy.URL)
	t.Setenv("https_proxy", proxy.URL)
	t.Setenv("no_proxy", "")

	client := NewInternalHTTPClient(5 * time.Second)
	resp, err := client.Get(target.URL)
	if err != nil {
		t.Fatalf("direct internal request failed: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.StatusCode, string(body))
	}
	if string(body) != "target" {
		t.Fatalf("expected target body, got %q", string(body))
	}
	if got := proxyHits.Load(); got != 0 {
		t.Fatalf("expected internal client to bypass proxy, got %d proxy hits", got)
	}
}
