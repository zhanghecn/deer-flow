package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

type AgentHandler struct {
	svc *service.AgentService
	fs  *storage.FS
}

func NewAgentHandler(svc *service.AgentService, fs *storage.FS) *AgentHandler {
	return &AgentHandler{svc: svc, fs: fs}
}

func (h *AgentHandler) List(c *gin.Context) {
	status := c.Query("status")
	agents, err := listFilesystemAgents(h.fs, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if agents == nil {
		agents = []model.Agent{}
	}
	c.JSON(http.StatusOK, gin.H{"agents": agents})
}

func (h *AgentHandler) Get(c *gin.Context) {
	name := c.Param("name")
	status := c.DefaultQuery("status", "dev")
	agent, err := loadFilesystemAgent(h.fs, name, status, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}
	c.JSON(http.StatusOK, agent)
}

func (h *AgentHandler) Create(c *gin.Context) {
	var req model.CreateAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	userID := middleware.GetUserID(c)
	agent, err := h.svc.Create(c.Request.Context(), req, userID)
	if err != nil {
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusCreated, agent)
}

func (h *AgentHandler) Update(c *gin.Context) {
	name := c.Param("name")
	status := c.DefaultQuery("status", "dev")
	var req model.UpdateAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	agent, err := h.svc.Update(c.Request.Context(), name, status, req)
	if err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, agent)
}

func (h *AgentHandler) Delete(c *gin.Context) {
	name := c.Param("name")
	status := c.Query("status")
	if err := deleteFilesystemAgent(h.fs, name, status); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse{Message: "agent deleted"})
}

func (h *AgentHandler) Publish(c *gin.Context) {
	name := c.Param("name")
	agent, err := publishFilesystemAgent(h.fs, name)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, agent)
}

func (h *AgentHandler) CheckName(c *gin.Context) {
	name := c.Query("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "missing name"})
		return
	}
	normalized := strings.ToLower(strings.TrimSpace(name))
	if normalized == "lead_agent" {
		c.JSON(http.StatusOK, gin.H{"available": false, "name": normalized})
		return
	}
	if !filesystemAgentExists(h.fs, normalized) {
		c.JSON(http.StatusOK, gin.H{"available": true, "name": name})
		return
	}
	c.JSON(http.StatusOK, gin.H{"available": false, "name": normalized})
}

func (h *AgentHandler) Export(c *gin.Context) {
	name := c.Param("name")
	agent, err := loadFilesystemAgent(h.fs, name, "prod", true)
	if err != nil || agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}

	doc := gin.H{
		"agent": agent.Name,
		"endpoints": gin.H{
			"stream": gin.H{
				"method": "POST",
				"url":    "/open/v1/agents/" + name + "/stream",
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
					"Content-Type":  "application/json",
				},
				"body": gin.H{
					"message":   "your message",
					"thread_id": "optional",
				},
			},
			"chat": gin.H{
				"method": "POST",
				"url":    "/open/v1/agents/" + name + "/chat",
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
					"Content-Type":  "application/json",
				},
				"body": gin.H{
					"message":   "your message",
					"thread_id": "optional",
				},
			},
		},
	}
	c.JSON(http.StatusOK, doc)
}
