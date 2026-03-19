package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/repository"
)

type fakeThreadRepo struct {
	items            []repository.ThreadSearchRecord
	runtimeRecord    *repository.ThreadRuntimeRecord
	runtimeErr       error
	err              error
	updateTitleErr   error
	updateTitleCalls []struct {
		threadID string
		title    string
	}
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
	h := NewThreadsHandler(repo)

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

	h := NewThreadsHandler(&fakeThreadRepo{})

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

func TestThreadsHandlerUpdateTitle(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	repo := &fakeThreadRepo{}
	h := NewThreadsHandler(repo)

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
	h := NewThreadsHandler(repo)

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
	h := NewThreadsHandler(repo)

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

func ptrString(value string) *string {
	return &value
}
