package handler

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/model"
)

type MCPHandler struct {
	extensionsConfigPath string
}

type mcpConfigResponse struct {
	MCPServers map[string]any `json:"mcp_servers"`
}

type mcpConfigUpdateRequest struct {
	MCPServers map[string]any `json:"mcp_servers"`
}

func NewMCPHandler(configPath string) *MCPHandler {
	return &MCPHandler{extensionsConfigPath: configPath}
}

func (h *MCPHandler) configPath() string {
	return h.extensionsConfigPath
}

func (h *MCPHandler) Get(c *gin.Context) {
	config, err := readExtensionsConfig(h.configPath())
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, mcpConfigResponse{MCPServers: map[string]any{}})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read MCP config"})
		return
	}

	c.JSON(http.StatusOK, mcpConfigResponse{MCPServers: config.MCPServers})
}

func (h *MCPHandler) Update(c *gin.Context) {
	var body mcpConfigUpdateRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	config, err := readExtensionsConfig(h.configPath())
	if err != nil {
		if !os.IsNotExist(err) {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read MCP config"})
			return
		}
		config = extensionsConfigJSON{
			MCPServers: map[string]any{},
			Skills:     map[string]skillStateJSON{},
		}
	}

	if body.MCPServers == nil {
		body.MCPServers = map[string]any{}
	}
	config.MCPServers = body.MCPServers

	if err := writeExtensionsConfig(h.configPath(), config); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to write config"})
		return
	}

	c.JSON(http.StatusOK, mcpConfigResponse{MCPServers: config.MCPServers})
}
