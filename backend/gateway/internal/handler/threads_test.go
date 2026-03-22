package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type fakeThreadRepo struct {
	items            []repository.ThreadSearchRecord
	runtimeRecord    *repository.ThreadRuntimeRecord
	runtimeErr       error
	err              error
	threadIDs        []string
	deleteErr        error
	updateTitleErr   error
	updateTitleCalls []struct {
		threadID string
		title    string
	}
	deleteCalls []string
}

func (f *fakeThreadRepo) SearchByUser(
	_ context.Context,
	_ uuid.UUID,
	_ repository.ThreadSearchOptions,
) ([]repository.ThreadSearchRecord, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.items, nil
}

func (f *fakeThreadRepo) GetRuntimeByUser(
	_ context.Context,
	_ uuid.UUID,
	_ string,
) (*repository.ThreadRuntimeRecord, error) {
	if f.runtimeErr != nil {
		return nil, f.runtimeErr
	}
	return f.runtimeRecord, nil
}

func (f *fakeThreadRepo) UpdateTitle(
	_ context.Context,
	_ uuid.UUID,
	threadID string,
	title string,
) error {
	f.updateTitleCalls = append(
		f.updateTitleCalls,
		struct {
			threadID string
			title    string
		}{threadID: threadID, title: title},
	)
	return f.updateTitleErr
}

func (f *fakeThreadRepo) ListIDsByUser(
	_ context.Context,
	_ uuid.UUID,
) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.threadIDs, nil
}

func (f *fakeThreadRepo) DeleteByUser(
	_ context.Context,
	_ uuid.UUID,
	threadID string,
) error {
	f.deleteCalls = append(f.deleteCalls, threadID)
	return f.deleteErr
}

func newTestThreadsHandler(
	t *testing.T,
	repo *fakeThreadRepo,
	runtimeHandler http.Handler,
) (*ThreadsHandler, *storage.FS) {
	t.Helper()

	runtimeServer := httptest.NewServer(runtimeHandler)
	t.Cleanup(runtimeServer.Close)

	fs := storage.NewFS(t.TempDir())
	return NewThreadsHandler(repo, runtimeServer.URL, fs), fs
}

func TestThreadsHandlerSearchReturnsUserThreads(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	now := time.Now().UTC()
	repo := &fakeThreadRepo{
		items: []repository.ThreadSearchRecord{
			{
				ThreadID:         "thread-1",
				UpdatedAt:        &now,
				Values:           map[string]any{"title": "Greeting"},
				AgentName:        ptrString("reviewer"),
				AgentStatus:      "prod",
				ExecutionBackend: ptrString("remote"),
				RemoteSessionID:  ptrString("session-1"),
				ModelName:        ptrString("kimi-k2.5"),
			},
		},
	}
	h, _ := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.POST("/api/threads/search", h.Search)

	reqBody := `{"limit":50,"offset":0,"sort_by":"updated_at","sort_order":"desc","select":["thread_id","updated_at","values"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/threads/search", bytes.NewBufferString(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var payload []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload) != 1 {
		t.Fatalf("expected 1 thread, got %d", len(payload))
	}
	if payload[0]["thread_id"] != "thread-1" {
		t.Fatalf("expected thread_id thread-1, got %v", payload[0]["thread_id"])
	}
	values, ok := payload[0]["values"].(map[string]any)
	if !ok {
		t.Fatalf("expected values map, got %T", payload[0]["values"])
	}
	if values["title"] != "Greeting" {
		t.Fatalf("expected title Greeting, got %v", values["title"])
	}
	if payload[0]["agent_name"] != "reviewer" {
		t.Fatalf("expected agent_name reviewer, got %v", payload[0]["agent_name"])
	}
	if payload[0]["agent_status"] != "prod" {
		t.Fatalf("expected agent_status prod, got %v", payload[0]["agent_status"])
	}
}

func TestThreadsHandlerSearchRejectsMissingUser(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	h, _ := newTestThreadsHandler(t, &fakeThreadRepo{}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	router := gin.New()
	router.POST("/api/threads/search", h.Search)

	req := httptest.NewRequest(http.MethodPost, "/api/threads/search", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestThreadsHandlerSearchTreatsCanceledRequestAsClientClosed(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	repo := &fakeThreadRepo{err: context.Canceled}
	h, _ := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.POST("/api/threads/search", h.Search)

	req := httptest.NewRequest(http.MethodPost, "/api/threads/search", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != 499 {
		t.Fatalf("expected status 499, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestThreadsHandlerUpdateTitle(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	repo := &fakeThreadRepo{}
	h, _ := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.PATCH("/api/threads/:id/title", h.UpdateTitle)

	req := httptest.NewRequest(
		http.MethodPatch,
		"/api/threads/thread-1/title",
		bytes.NewBufferString(`{"title":"  New Title  "}`),
	)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(repo.updateTitleCalls) != 1 {
		t.Fatalf("expected 1 update call, got %d", len(repo.updateTitleCalls))
	}
	if repo.updateTitleCalls[0].threadID != "thread-1" {
		t.Fatalf("expected thread-1, got %s", repo.updateTitleCalls[0].threadID)
	}
	if repo.updateTitleCalls[0].title != "New Title" {
		t.Fatalf("expected trimmed title, got %q", repo.updateTitleCalls[0].title)
	}
}

func TestThreadsHandlerUpdateTitleNotFound(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	repo := &fakeThreadRepo{updateTitleErr: pgx.ErrNoRows}
	h, _ := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.PATCH("/api/threads/:id/title", h.UpdateTitle)

	req := httptest.NewRequest(
		http.MethodPatch,
		"/api/threads/missing/title",
		bytes.NewBufferString(`{"title":"Missing"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestThreadsHandlerGetRuntime(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	repo := &fakeThreadRepo{
		runtimeRecord: &repository.ThreadRuntimeRecord{
			ThreadID:         "thread-1",
			AgentName:        ptrString("reviewer"),
			AgentStatus:      "prod",
			ExecutionBackend: ptrString("remote"),
			RemoteSessionID:  ptrString("session-1"),
			ModelName:        ptrString("kimi-k2.5"),
		},
	}
	h, _ := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.GET("/api/threads/:id/runtime", h.GetRuntime)

	req := httptest.NewRequest(http.MethodGet, "/api/threads/thread-1/runtime", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["agent_name"] != "reviewer" {
		t.Fatalf("expected agent_name reviewer, got %v", payload["agent_name"])
	}
	if payload["agent_status"] != "prod" {
		t.Fatalf("expected agent_status prod, got %v", payload["agent_status"])
	}
}

func TestThreadsHandlerDelete(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	threadID := "11111111-1111-1111-1111-111111111111"
	repo := &fakeThreadRepo{
		runtimeRecord: &repository.ThreadRuntimeRecord{
			ThreadID:    threadID,
			AgentStatus: "dev",
		},
	}

	var deletedPath string
	var deletedUserID string
	h, fs := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deletedPath = r.URL.Path
		deletedUserID = r.Header.Get("X-User-ID")
		w.WriteHeader(http.StatusNoContent)
	}))

	threadDir := fs.ThreadDir(threadID)
	if err := os.MkdirAll(filepath.Join(threadDir, "user-data", "outputs"), 0755); err != nil {
		t.Fatalf("mkdir thread dir: %v", err)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.DELETE("/api/threads/:id", h.Delete)

	req := httptest.NewRequest(http.MethodDelete, "/api/threads/"+threadID, nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if deletedPath != "/threads/"+threadID {
		t.Fatalf("expected runtime delete path /threads/%s, got %s", threadID, deletedPath)
	}
	if deletedUserID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("expected X-User-ID header, got %s", deletedUserID)
	}
	if len(repo.deleteCalls) != 1 || repo.deleteCalls[0] != threadID {
		t.Fatalf("expected one binding delete call for %s, got %#v", threadID, repo.deleteCalls)
	}
	if _, err := os.Stat(threadDir); !os.IsNotExist(err) {
		t.Fatalf("expected thread dir to be removed, got err=%v", err)
	}
}

func TestThreadsHandlerDeleteSkipsRuntimeDeleteForLegacyThreadID(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	repo := &fakeThreadRepo{
		runtimeRecord: &repository.ThreadRuntimeRecord{
			ThreadID:    "direct-debug-thread",
			AgentStatus: "dev",
		},
	}

	runtimeDeleteCalls := 0
	h, fs := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		runtimeDeleteCalls++
		w.WriteHeader(http.StatusNoContent)
	}))

	threadDir := fs.ThreadDir("direct-debug-thread")
	if err := os.MkdirAll(filepath.Join(threadDir, "user-data", "outputs"), 0755); err != nil {
		t.Fatalf("mkdir thread dir: %v", err)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.DELETE("/api/threads/:id", h.Delete)

	req := httptest.NewRequest(http.MethodDelete, "/api/threads/direct-debug-thread", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if runtimeDeleteCalls != 0 {
		t.Fatalf("expected no runtime delete calls for legacy thread id, got %d", runtimeDeleteCalls)
	}
	if len(repo.deleteCalls) != 1 || repo.deleteCalls[0] != "direct-debug-thread" {
		t.Fatalf("expected one binding delete call for direct-debug-thread, got %#v", repo.deleteCalls)
	}
	if _, err := os.Stat(threadDir); !os.IsNotExist(err) {
		t.Fatalf("expected thread dir to be removed, got err=%v", err)
	}
}

func TestThreadsHandlerClearAll(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	threadID1 := "11111111-1111-1111-1111-111111111111"
	threadID2 := "22222222-2222-2222-2222-222222222222"
	repo := &fakeThreadRepo{
		threadIDs: []string{threadID1, threadID2},
	}

	deletedPaths := make([]string, 0, len(repo.threadIDs))
	h, fs := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deletedPaths = append(deletedPaths, r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, threadID := range repo.threadIDs {
		if err := os.MkdirAll(filepath.Join(fs.ThreadDir(threadID), "user-data", "workspace"), 0755); err != nil {
			t.Fatalf("mkdir thread dir for %s: %v", threadID, err)
		}
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.DELETE("/api/threads", h.ClearAll)

	req := httptest.NewRequest(http.MethodDelete, "/api/threads", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["deleted_count"] != float64(2) {
		t.Fatalf("expected deleted_count 2, got %v", payload["deleted_count"])
	}
	if len(repo.deleteCalls) != 2 {
		t.Fatalf("expected 2 binding deletes, got %d", len(repo.deleteCalls))
	}
	if len(deletedPaths) != 2 {
		t.Fatalf("expected 2 runtime deletes, got %d", len(deletedPaths))
	}
	for _, threadID := range repo.threadIDs {
		if _, err := os.Stat(fs.ThreadDir(threadID)); !os.IsNotExist(err) {
			t.Fatalf("expected thread dir %s to be removed, got err=%v", threadID, err)
		}
	}
}

func TestThreadsHandlerClearAllSkipsLegacyThreadIDs(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	uuidThreadID := "11111111-1111-1111-1111-111111111111"
	repo := &fakeThreadRepo{
		threadIDs: []string{"direct-debug-thread", uuidThreadID},
	}

	deletedPaths := make([]string, 0, 1)
	h, fs := newTestThreadsHandler(t, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deletedPaths = append(deletedPaths, r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, threadID := range repo.threadIDs {
		if err := os.MkdirAll(filepath.Join(fs.ThreadDir(threadID), "user-data", "workspace"), 0755); err != nil {
			t.Fatalf("mkdir thread dir for %s: %v", threadID, err)
		}
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.DELETE("/api/threads", h.ClearAll)

	req := httptest.NewRequest(http.MethodDelete, "/api/threads", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["deleted_count"] != float64(2) {
		t.Fatalf("expected deleted_count 2, got %v", payload["deleted_count"])
	}
	if len(repo.deleteCalls) != 2 {
		t.Fatalf("expected 2 binding deletes, got %d", len(repo.deleteCalls))
	}
	if len(deletedPaths) != 1 {
		t.Fatalf("expected 1 runtime delete for uuid thread, got %d", len(deletedPaths))
	}
	if deletedPaths[0] != "/threads/"+uuidThreadID {
		t.Fatalf("expected runtime delete path for uuid thread, got %s", deletedPaths[0])
	}
	for _, threadID := range repo.threadIDs {
		if _, err := os.Stat(fs.ThreadDir(threadID)); !os.IsNotExist(err) {
			t.Fatalf("expected thread dir %s to be removed, got err=%v", threadID, err)
		}
	}
}

func ptrString(value string) *string {
	return &value
}
