package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

type MemoryHandler struct {
	fs *storage.FS
}

func NewMemoryHandler(fs *storage.FS) *MemoryHandler {
	return &MemoryHandler{fs: fs}
}

func normalizeMemoryAgentStatus(raw string) (string, bool) {
	status := strings.TrimSpace(raw)
	if status == "" {
		return "dev", true
	}
	if status != "dev" && status != "prod" {
		return "", false
	}
	return status, true
}

func (h *MemoryHandler) Get(c *gin.Context) {
	userID := middleware.GetUserID(c)
	agentName := strings.TrimSpace(c.Query("agent_name"))
	if agentName == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing agent_name"})
		return
	}
	agentStatus, ok := normalizeMemoryAgentStatus(c.Query("agent_status"))
	if !ok {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid agent_status"})
		return
	}
	memPath := filepath.Join(h.fs.UserDir(userID.String()), "agents", agentStatus, agentName, "memory.json")

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
	agentName := strings.TrimSpace(c.Query("agent_name"))
	if agentName == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing agent_name"})
		return
	}
	agentStatus, ok := normalizeMemoryAgentStatus(c.Query("agent_status"))
	if !ok {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid agent_status"})
		return
	}

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

	dir := filepath.Join(h.fs.UserDir(userID.String()), "agents", agentStatus, agentName)
	_ = os.MkdirAll(dir, 0755)
	memPath := filepath.Join(dir, "memory.json")

	if err := os.WriteFile(memPath, data, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to write memory"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "memory updated"})
}
