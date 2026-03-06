package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
	"github.com/gin-gonic/gin"
)

type UploadsHandler struct {
	fs *storage.FS
}

func NewUploadsHandler(fs *storage.FS) *UploadsHandler {
	return &UploadsHandler{fs: fs}
}

func (h *UploadsHandler) Upload(c *gin.Context) {
	threadID := c.Param("id")
	if threadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing thread id"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid multipart form"})
		return
	}

	uploadsDir := filepath.Join(h.fs.ThreadUserDataDir(threadID), "uploads")
	_ = os.MkdirAll(uploadsDir, 0755)

	files := form.File["files"]
	var uploaded []string
	for _, f := range files {
		// Sanitize filename
		name := filepath.Base(f.Filename)
		dst := filepath.Join(uploadsDir, name)
		if err := c.SaveUploadedFile(f, dst); err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: fmt.Sprintf("failed to save %s", name)})
			return
		}
		uploaded = append(uploaded, name)
	}

	c.JSON(http.StatusOK, gin.H{"uploaded": uploaded})
}

func (h *UploadsHandler) List(c *gin.Context) {
	threadID := c.Param("id")
	uploadsDir := filepath.Join(h.fs.ThreadUserDataDir(threadID), "uploads")

	entries, err := os.ReadDir(uploadsDir)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, []string{})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list uploads"})
		return
	}

	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	if names == nil {
		names = []string{}
	}
	c.JSON(http.StatusOK, names)
}

func (h *UploadsHandler) Delete(c *gin.Context) {
	threadID := c.Param("id")
	filename := c.Query("filename")
	if filename == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing filename"})
		return
	}

	// Prevent path traversal
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid filename"})
		return
	}

	path := filepath.Join(h.fs.ThreadUserDataDir(threadID), "uploads", filename)
	if err := os.Remove(path); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "file not found"})
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse{Message: "file deleted"})
}
