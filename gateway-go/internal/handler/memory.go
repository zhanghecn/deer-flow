package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/deer-flow/gateway/internal/middleware"
	"github.com/deer-flow/gateway/internal/model"
	"github.com/deer-flow/gateway/pkg/storage"
	"github.com/gin-gonic/gin"
)

type MemoryHandler struct {
	fs *storage.FS
}

func NewMemoryHandler(fs *storage.FS) *MemoryHandler {
	return &MemoryHandler{fs: fs}
}

func (h *MemoryHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)
	memPath := filepath.Join(h.fs.UserDir(userID.String()), "memory.json")

	data, err := os.ReadFile(memPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, gin.H{})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read memory"})
		return
	}

	var memory interface{}
	if err := json.Unmarshal(data, &memory); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "invalid memory format"})
		return
	}
	c.JSON(http.StatusOK, memory)
}

func (h *MemoryHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var body interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	data, err := json.MarshalIndent(body, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to marshal memory"})
		return
	}

	dir := h.fs.UserDir(userID.String())
	_ = os.MkdirAll(dir, 0755)
	memPath := filepath.Join(dir, "memory.json")

	if err := os.WriteFile(memPath, data, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to write memory"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "memory updated"})
}
