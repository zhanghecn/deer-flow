package handler

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

type AgentHandler struct {
	svc       *service.AgentService
	fs        *storage.FS
	tokenRepo *repository.APITokenRepo
}

func NewAgentHandler(svc *service.AgentService, fs *storage.FS, tokenRepo *repository.APITokenRepo) *AgentHandler {
	return &AgentHandler{svc: svc, fs: fs, tokenRepo: tokenRepo}
}

func (h *AgentHandler) List(c *gin.Context) {
	status := c.Query("status")
	agents, err := agentfs.ListAgents(h.fs, status)
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
	agent, err := agentfs.LoadAgent(h.fs, name, status, true)
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
	if err := agentfs.DeleteAgent(h.fs, name, status); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse{Message: "agent deleted"})
}

func (h *AgentHandler) Publish(c *gin.Context) {
	name := c.Param("name")
	agent, err := agentfs.PublishAgent(h.fs, name)
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
	if !agentfs.AgentExists(h.fs, normalized) {
		c.JSON(http.StatusOK, gin.H{"available": true, "name": name})
		return
	}
	c.JSON(http.StatusOK, gin.H{"available": false, "name": normalized})
}

func (h *AgentHandler) Export(c *gin.Context) {
	name := c.Param("name")
	agent, err := agentfs.LoadAgent(h.fs, name, "prod", true)
	if err != nil || agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}

	doc := h.buildExportDocument(c, agent.Name)
	c.JSON(http.StatusOK, doc)
}

func (h *AgentHandler) ExportDemo(c *gin.Context) {
	name := c.Param("name")
	agent, err := agentfs.LoadAgent(h.fs, name, "prod", true)
	if err != nil || agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}
	if h.tokenRepo == nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "api token repository is unavailable"})
		return
	}

	userID := middleware.GetUserID(c)
	plainToken, expiresAt, err := h.createDemoToken(c, userID, agent.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to create demo api token"})
		return
	}

	openAPIBaseURL := resolvePublicGatewayBaseURL(c)
	exportDoc := h.buildExportDocument(c, agent.Name)
	archiveBytes, err := buildReactDemoArchive(
		agent.Name,
		openAPIBaseURL,
		plainToken,
		expiresAt,
		exportDoc,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to build demo archive"})
		return
	}

	filename := fmt.Sprintf("%s-react-demo.zip", sanitizeDemoName(agent.Name))
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "application/zip", archiveBytes)
}

func (h *AgentHandler) createDemoToken(c *gin.Context, userID uuid.UUID, agentName string) (string, time.Time, error) {
	plainToken := generateRandomToken()
	tokenHash := hashTokenStr(plainToken)
	expiresAt := time.Now().UTC().Add(7 * 24 * time.Hour)

	apiToken := &model.APIToken{
		ID:        uuid.New(),
		UserID:    userID,
		TokenHash: tokenHash,
		Name:      fmt.Sprintf("demo-%s-%s", sanitizeDemoName(agentName), time.Now().UTC().Format("20060102-150405")),
		Scopes:    []string{"openapi:invoke"},
		ExpiresAt: &expiresAt,
	}
	if err := h.tokenRepo.Create(c.Request.Context(), apiToken); err != nil {
		return "", time.Time{}, err
	}
	return plainToken, expiresAt, nil
}

func (h *AgentHandler) buildExportDocument(c *gin.Context, agentName string) gin.H {
	baseURL := resolvePublicGatewayBaseURL(c)
	apiExportURL := fmt.Sprintf("%s/api/agents/%s/export", baseURL, agentName)
	demoExportURL := fmt.Sprintf("%s/api/agents/%s/export/demo", baseURL, agentName)
	return gin.H{
		"agent":        agentName,
		"status":       "prod",
		"api_base_url": baseURL,
		"endpoints": gin.H{
			"stream": gin.H{
				"method": "POST",
				"url":    fmt.Sprintf("%s/open/v1/agents/%s/stream", baseURL, agentName),
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
				"url":    fmt.Sprintf("%s/open/v1/agents/%s/chat", baseURL, agentName),
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
		"demo": gin.H{
			"framework": "react-vite",
			"method":    "POST",
			"url":       demoExportURL,
			"notes": []string{
				"Calling the demo export endpoint creates a new API token and embeds it into the downloaded React project.",
				"The generated token expires after 7 days. Rotate or delete it from the API token page if you do not need it anymore.",
			},
		},
		"documentation_url": apiExportURL,
	}
}
