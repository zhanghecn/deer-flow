package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/pkg/storage"
)

func TestMemoryHandlerRejectsMissingAgentName(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	h := NewMemoryHandler(storage.NewFS(t.TempDir()))
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse("11111111-1111-1111-1111-111111111111"))
		c.Next()
	})
	router.GET("/api/memory", h.Get)

	req := httptest.NewRequest(http.MethodGet, "/api/memory", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestMemoryHandlerReadsUserAgentPath(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	baseDir := t.TempDir()
	fs := storage.NewFS(baseDir)
	h := NewMemoryHandler(fs)

	userID := "11111111-1111-1111-1111-111111111111"
	memDir := fs.UserDir(userID) + "/agents/prod/analyst"
	if err := os.MkdirAll(memDir, 0o755); err != nil {
		t.Fatalf("mkdir memory dir: %v", err)
	}
	if err := os.WriteFile(memDir+"/memory.json", []byte(`{"version":"1.0","facts":[]}`), 0o644); err != nil {
		t.Fatalf("write memory file: %v", err)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.UserIDKey), uuid.MustParse(userID))
		c.Next()
	})
	router.GET("/api/memory", h.Get)

	req := httptest.NewRequest(http.MethodGet, "/api/memory?agent_name=analyst&agent_status=prod", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}
