package handler

import (
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
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
		head := c.Param("head")
		tail := c.Param("tail")
		if head != "" {
			artifactPath = "/" + head + tail
		}
	}

	if artifactPath == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing artifact path"})
		return
	}

	cleaned := path.Clean(strings.TrimPrefix(artifactPath, "/"))
	if cleaned == "." || cleaned == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing artifact path"})
		return
	}
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid path"})
		return
	}

	relativePath, preferredScope := normalizeArtifactPath(cleaned)

	// Try outputs first, then workspace
	userDataDir := h.fs.ThreadUserDataDir(threadID)
	var candidates []string
	switch preferredScope {
	case "outputs":
		candidates = []string{filepath.Join(userDataDir, "outputs", relativePath)}
	case "workspace":
		candidates = []string{filepath.Join(userDataDir, "workspace", relativePath)}
	default:
		candidates = []string{
			filepath.Join(userDataDir, "outputs", relativePath),
			filepath.Join(userDataDir, "workspace", relativePath),
		}
	}

	for _, path := range candidates {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			serveArtifactFile(c, path, info)
			return
		}
	}

	c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "artifact not found"})
}

func normalizeArtifactPath(cleaned string) (relativePath string, preferredScope string) {
	prefixes := []struct {
		prefix string
		scope  string
	}{
		{"mnt/user-data/outputs/", "outputs"},
		{"/mnt/user-data/outputs/", "outputs"},
		{"outputs/", "outputs"},
		{"mnt/user-data/workspace/", "workspace"},
		{"/mnt/user-data/workspace/", "workspace"},
		{"workspace/", "workspace"},
	}

	for _, item := range prefixes {
		if strings.HasPrefix(cleaned, item.prefix) {
			return strings.TrimPrefix(cleaned, item.prefix), item.scope
		}
	}
	return cleaned, ""
}

func serveArtifactFile(c *gin.Context, filePath string, info os.FileInfo) {
	file, err := os.Open(filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to open artifact"})
		return
	}
	defer file.Close()

	if contentType := mime.TypeByExtension(filepath.Ext(filePath)); contentType != "" {
		c.Header("Content-Type", contentType)
	}
	http.ServeContent(c.Writer, c.Request, filepath.Base(filePath), info.ModTime(), file)
}
