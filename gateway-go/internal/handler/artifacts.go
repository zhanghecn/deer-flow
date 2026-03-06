package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
	"github.com/gin-gonic/gin"
)

type ArtifactsHandler struct {
	fs *storage.FS
}

func NewArtifactsHandler(fs *storage.FS) *ArtifactsHandler {
	return &ArtifactsHandler{fs: fs}
}

func (h *ArtifactsHandler) Serve(c *gin.Context) {
	threadID := c.Param("id")
	artifactPath := c.Param("path")

	if artifactPath == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing artifact path"})
		return
	}

	// Prevent path traversal
	cleaned := filepath.Clean(artifactPath)
	if strings.Contains(cleaned, "..") {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid path"})
		return
	}

	// Try outputs first, then workspace
	userDataDir := h.fs.ThreadUserDataDir(threadID)
	candidates := []string{
		filepath.Join(userDataDir, "outputs", cleaned),
		filepath.Join(userDataDir, "workspace", cleaned),
	}

	for _, path := range candidates {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			c.File(path)
			return
		}
	}

	c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "artifact not found"})
}
