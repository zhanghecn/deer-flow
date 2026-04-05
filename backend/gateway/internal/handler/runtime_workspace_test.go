package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/repository"
)

type fakeRuntimeWorkspaceRepo struct {
	record *repository.ThreadRuntimeRecord
	err    error
}

func (f *fakeRuntimeWorkspaceRepo) GetRuntimeByUser(
	_ context.Context,
	_ uuid.UUID,
	_ string,
) (*repository.ThreadRuntimeRecord, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.record, nil
}

func TestRuntimeWorkspaceOpenReturnsSandboxSessionDescriptor(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	langGraphCalled := false
	langGraph := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		langGraphCalled = true
		if r.URL.Path != "/api/sandbox-ide/sessions" {
			t.Fatalf("unexpected langgraph path: %s", r.URL.Path)
		}
		if got := r.Header.Get(headerUserID); got != "11111111-1111-1111-1111-111111111111" {
			t.Fatalf("expected x-user-id header, got %q", got)
		}

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if payload["thread_id"] != "thread-1" {
			t.Fatalf("expected thread_id thread-1, got %#v", payload["thread_id"])
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"session_id":       "sess-1",
			"access_token":     "token-1",
			"mode":             "runtime",
			"target_path":      "/mnt/user-data/workspace",
			"relative_url":     "/sandbox-ide/sess-1/token-1/?folder=%2Fmnt%2Fuser-data%2Fworkspace",
			"public_base_path": "/sandbox-ide/sess-1/token-1",
			"expires_at":       "2026-04-06T00:00:00Z",
		})
	}))
	t.Cleanup(langGraph.Close)

	handler := NewRuntimeWorkspaceHandler(
		&fakeRuntimeWorkspaceRepo{
			record: &repository.ThreadRuntimeRecord{
				ThreadID:    "thread-1",
				AgentStatus: "dev",
			},
		},
		langGraph.URL,
	)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.POST("/api/threads/:id/runtime-workspace/open", handler.Open)

	req := httptest.NewRequest(http.MethodPost, "/api/threads/thread-1/runtime-workspace/open", bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !langGraphCalled {
		t.Fatal("expected langgraph session endpoint to be called")
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"/sandbox-ide/sess-1/token-1/`)) {
		t.Fatalf("expected sandbox ide url in response, got %s", rec.Body.String())
	}
}

func TestRuntimeWorkspaceOpenRejectsRemoteRuntime(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := NewRuntimeWorkspaceHandler(
		&fakeRuntimeWorkspaceRepo{
			record: &repository.ThreadRuntimeRecord{
				ThreadID:         "thread-2",
				AgentStatus:      "dev",
				ExecutionBackend: ptrString("remote"),
			},
		},
		"http://langgraph.invalid",
	)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.POST("/api/threads/:id/runtime-workspace/open", handler.Open)

	req := httptest.NewRequest(http.MethodPost, "/api/threads/thread-2/runtime-workspace/open", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRuntimeWorkspaceProxyResolvesTargetAndRewritesPath(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("x-upstream-path", r.URL.Path)
		w.Header().Set("x-upstream-query", r.URL.RawQuery)
		_, _ = w.Write([]byte("sandbox-ide"))
	}))
	t.Cleanup(upstream.Close)

	langGraph := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/sandbox-ide/sessions/sess-9/token-9" {
			t.Fatalf("unexpected langgraph resolve path: %s", r.URL.Path)
		}
		if got := r.Header.Get(headerUserID); got != "11111111-1111-1111-1111-111111111111" {
			t.Fatalf("expected x-user-id header, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"session_id":           "sess-9",
			"access_token":         "token-9",
			"upstream_base_url":    upstream.URL,
			"upstream_path_prefix": "/proxy/33221",
			"expires_at":           "2026-04-06T00:00:00Z",
		})
	}))
	t.Cleanup(langGraph.Close)

	handler := NewRuntimeWorkspaceHandler(&fakeRuntimeWorkspaceRepo{}, langGraph.URL)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.Any("/sandbox-ide/:session_id/:access_token/*path", handler.Proxy())

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	resp, err := http.Get(server.URL + "/sandbox-ide/sess-9/token-9/static/app.js?foo=bar")
	if err != nil {
		t.Fatalf("proxy request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected status 200, got %d body=%s", resp.StatusCode, string(body))
	}
	if got := resp.Header.Get("x-upstream-path"); got != "/proxy/33221/static/app.js" {
		t.Fatalf("unexpected upstream path %q", got)
	}
	if got := resp.Header.Get("x-upstream-query"); got != "foo=bar" {
		t.Fatalf("unexpected upstream query %q", got)
	}
}

func TestRuntimeWorkspaceProxyRootRouteUsesSandboxRoot(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("x-upstream-path", r.URL.Path)
		_, _ = w.Write([]byte("sandbox-root"))
	}))
	t.Cleanup(upstream.Close)

	langGraph := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"session_id":           "sess-10",
			"access_token":         "token-10",
			"upstream_base_url":    upstream.URL,
			"upstream_path_prefix": "/proxy/33222",
			"expires_at":           "2026-04-06T00:00:00Z",
		})
	}))
	t.Cleanup(langGraph.Close)

	handler := NewRuntimeWorkspaceHandler(&fakeRuntimeWorkspaceRepo{}, langGraph.URL)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.Any("/sandbox-ide/:session_id/:access_token", handler.Proxy())

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	resp, err := http.Get(server.URL + "/sandbox-ide/sess-10/token-10")
	if err != nil {
		t.Fatalf("proxy request failed: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("x-upstream-path"); got != "/proxy/33222/" {
		t.Fatalf("unexpected upstream path %q", got)
	}
}

func TestRuntimeWorkspaceProxyRewritesOriginForSandboxWebsocket(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("x-upstream-origin", r.Header.Get("Origin"))
		w.Header().Set("x-upstream-host", r.Host)
		_, _ = w.Write([]byte("sandbox-ws"))
	}))
	t.Cleanup(upstream.Close)

	langGraph := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"session_id":           "sess-11",
			"access_token":         "token-11",
			"upstream_base_url":    upstream.URL,
			"upstream_path_prefix": "/proxy/41234",
			"expires_at":           "2026-04-06T00:00:00Z",
		})
	}))
	t.Cleanup(langGraph.Close)

	handler := NewRuntimeWorkspaceHandler(&fakeRuntimeWorkspaceRepo{}, langGraph.URL)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.Any("/sandbox-ide/:session_id/:access_token/*path", handler.Proxy())

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	req, err := http.NewRequest(
		http.MethodGet,
		server.URL+"/sandbox-ide/sess-11/token-11/socket",
		nil,
	)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Origin", "http://127.0.0.1:8083")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("proxy request failed: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("x-upstream-origin"); got != "http://127.0.0.1:41234" {
		t.Fatalf("unexpected upstream origin %q", got)
	}
	if got := resp.Header.Get("x-upstream-host"); got != "127.0.0.1:41234" {
		t.Fatalf("unexpected upstream host %q", got)
	}
}

func TestRuntimeWorkspaceOpenPropagatesThreadNotFound(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	handler := NewRuntimeWorkspaceHandler(
		&fakeRuntimeWorkspaceRepo{err: pgx.ErrNoRows},
		"http://langgraph.invalid",
	)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.POST("/api/threads/:id/runtime-workspace/open", handler.Open)

	req := httptest.NewRequest(http.MethodPost, "/api/threads/thread-404/runtime-workspace/open", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d body=%s", rec.Code, rec.Body.String())
	}
}
