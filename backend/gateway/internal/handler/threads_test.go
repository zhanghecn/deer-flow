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
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/repository"
)

type fakeThreadRepo struct {
	items []repository.ThreadSearchRecord
	err   error
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

func TestThreadsHandlerSearchReturnsUserThreads(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	now := time.Now().UTC()
	repo := &fakeThreadRepo{
		items: []repository.ThreadSearchRecord{
			{
				ThreadID:  "thread-1",
				UpdatedAt: &now,
				Values:    nil,
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
