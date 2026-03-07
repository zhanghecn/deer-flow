package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/openagents/gateway/internal/model"
	"github.com/gin-gonic/gin"
)

type MCPHandler struct {
	configDir string
}

func NewMCPHandler(configDir string) *MCPHandler {
	return &MCPHandler{configDir: configDir}
}

func (h *MCPHandler) configPath() string {
	return filepath.Join(h.configDir, "extensions_config.json")
}

func (h *MCPHandler) Get(c *gin.Context) {
	data, err := os.ReadFile(h.configPath())
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, gin.H{})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read MCP config"})
		return
	}

	var config interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "invalid MCP config"})
		return
	}
	c.JSON(http.StatusOK, config)
}

func (h *MCPHandler) Update(c *gin.Context) {
	var body interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	data, err := json.MarshalIndent(body, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to marshal config"})
		return
	}

	if err := os.WriteFile(h.configPath(), data, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to write config"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "MCP config updated"})
}
