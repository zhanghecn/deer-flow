package proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRouteHandlerIgnoresClientAbortPanic(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer upstream.Close()

	route, err := NewRoute(RouteConfig{
		Prefix:      "/api/langgraph",
		Upstream:    upstream.URL,
		StripPrefix: true,
	})
	if err != nil {
		t.Fatalf("new route: %v", err)
	}

	route.proxy.ModifyResponse = func(resp *http.Response) error {
		panic(http.ErrAbortHandler)
	}

	router := gin.New()
	router.Any("/api/langgraph/*path", route.Handler())

	server := httptest.NewServer(router)
	defer server.Close()

	resp, err := http.Post(server.URL+"/api/langgraph/threads/demo/runs/stream", "application/json", http.NoBody)
	if err != nil {
		t.Fatalf("post proxy request: %v", err)
	}
	defer resp.Body.Close()

	if _, err := io.ReadAll(resp.Body); err != nil {
		t.Fatalf("read proxy response: %v", err)
	}
}
