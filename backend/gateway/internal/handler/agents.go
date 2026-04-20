package handler

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"

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
	svc      *service.AgentService
	fs       *storage.FS
	userRepo *repository.UserRepo
}

const manageAgentForbiddenDetail = "you do not have permission to manage this agent"

func NewAgentHandler(
	svc *service.AgentService,
	fs *storage.FS,
	userRepo *repository.UserRepo,
) *AgentHandler {
	return &AgentHandler{svc: svc, fs: fs, userRepo: userRepo}
}

func canManageAgent(c *gin.Context, agent *model.Agent) bool {
	if agent == nil {
		return false
	}
	if middleware.IsAdmin(c) {
		return true
	}

	ownerUserID := strings.TrimSpace(agent.OwnerUserID)
	if ownerUserID == "" {
		// Hard-cut legacy ownerless archives to read-only for normal users. New
		// agents always persist `owner_user_id`, so silent ownerless manage access
		// would only preserve ambiguous historical behavior.
		return false
	}

	userID := middleware.GetUserID(c)
	return userID != uuid.Nil && userID.String() == ownerUserID
}

func (h *AgentHandler) decorateAgentAccess(c *gin.Context, agent *model.Agent) *model.Agent {
	if agent == nil {
		return nil
	}
	decorated := *agent
	decorated.CanManage = canManageAgent(c, agent)
	h.decorateAgentOwnerName(c, &decorated)
	return &decorated
}

func (h *AgentHandler) decorateAgentOwnerName(c *gin.Context, agent *model.Agent) {
	if agent == nil || h.userRepo == nil {
		return
	}
	ownerUserID := strings.TrimSpace(agent.OwnerUserID)
	if ownerUserID == "" {
		return
	}
	parsedOwnerUserID, err := uuid.Parse(ownerUserID)
	if err != nil {
		return
	}
	owner, err := h.userRepo.FindByID(c.Request.Context(), parsedOwnerUserID)
	if err != nil || owner == nil {
		return
	}
	agent.OwnerName = owner.Name
}

func writeManageAgentForbidden(c *gin.Context) {
	c.JSON(http.StatusForbidden, model.ErrorResponse{
		Error:   "forbidden",
		Details: manageAgentForbiddenDetail,
	})
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
	for i := range agents {
		agents[i].CanManage = canManageAgent(c, &agents[i])
		h.decorateAgentOwnerName(c, &agents[i])
	}
	c.JSON(http.StatusOK, gin.H{"agents": agents})
}

func (h *AgentHandler) ListToolCatalog(c *gin.Context) {
	tools, err := h.svc.ListToolCatalog()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"tools": tools})
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
	c.JSON(http.StatusOK, h.decorateAgentAccess(c, agent))
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
	c.JSON(http.StatusCreated, h.decorateAgentAccess(c, agent))
}

func (h *AgentHandler) Update(c *gin.Context) {
	name := c.Param("name")
	status := c.DefaultQuery("status", "dev")
	var req model.UpdateAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	existing, err := agentfs.LoadAgent(h.fs, name, status, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: fmt.Sprintf("agent %q (%s) not found", name, status)})
		return
	}
	if !canManageAgent(c, existing) {
		writeManageAgentForbidden(c)
		return
	}

	agent, err := h.svc.Update(c.Request.Context(), name, status, req)
	if err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, h.decorateAgentAccess(c, agent))
}

func (h *AgentHandler) Delete(c *gin.Context) {
	name := c.Param("name")
	status := c.Query("status")
	targetStatuses := []string{"dev", "prod"}
	if trimmedStatus := strings.TrimSpace(status); trimmedStatus != "" {
		targetStatuses = []string{trimmedStatus}
	}

	found := false
	for _, item := range targetStatuses {
		agent, err := agentfs.LoadAgent(h.fs, name, item, false)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
			return
		}
		if agent == nil {
			continue
		}
		found = true
		if !canManageAgent(c, agent) {
			writeManageAgentForbidden(c)
			return
		}
	}
	if !found {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: fmt.Sprintf("agent %q not found", name)})
		return
	}
	if err := agentfs.DeleteAgent(h.fs, name, status); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse{Message: "agent deleted"})
}

func (h *AgentHandler) Publish(c *gin.Context) {
	name := c.Param("name")
	devAgent, err := agentfs.LoadAgent(h.fs, name, "dev", false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if devAgent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}
	if !canManageAgent(c, devAgent) {
		writeManageAgentForbidden(c)
		return
	}

	agent, err := agentfs.PublishAgent(h.fs, name)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, h.decorateAgentAccess(c, agent))
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

func (h *AgentHandler) PublicExport(c *gin.Context) {
	name := c.Param("name")
	agent, err := agentfs.LoadAgent(h.fs, name, "prod", true)
	if err != nil || agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}

	// This public export is intentionally limited to published agents and stable
	// northbound contract metadata. It lets external integrators retrieve the
	// docs page and machine-readable export without exposing any workspace-only
	// management APIs or draft archives.
	doc := h.buildExportDocument(c, agent.Name)
	c.JSON(http.StatusOK, doc)
}

func (h *AgentHandler) PublicOpenAPISpec(c *gin.Context) {
	name := c.Param("name")
	agent, err := agentfs.LoadAgent(h.fs, name, "prod", true)
	if err != nil || agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}

	// The public spec is the machine-readable source of truth for external
	// integrators. UI pages can change freely, but the OpenAPI document must stay
	// stable and environment-aware so SDK users always receive the live `/v1`
	// contract for the published agent.
	spec := h.buildOpenAPIDocument(c, agent.Name)
	c.JSON(http.StatusOK, spec)
}

func (h *AgentHandler) buildExportDocument(c *gin.Context, agentName string) gin.H {
	baseURL := resolvePublicGatewayBaseURL(c)
	apiBaseURL := fmt.Sprintf("%s/v1", baseURL)
	publicDocsURL := fmt.Sprintf("%s/docs/agents/%s", baseURL, agentName)
	publicExportURL := fmt.Sprintf("%s/open/agents/%s/export", baseURL, agentName)
	publicReferenceURL := fmt.Sprintf("%s/docs/agents/%s/reference", baseURL, agentName)
	publicPlaygroundURL := fmt.Sprintf("%s/docs/agents/%s/playground", baseURL, agentName)
	publicOpenAPIURL := fmt.Sprintf("%s/open/agents/%s/openapi.json", baseURL, agentName)
	return gin.H{
		"agent":                  agentName,
		"status":                 "prod",
		"gateway_base_url":       baseURL,
		"api_base_url":           apiBaseURL,
		"model":                  agentName,
		"documentation_url":      publicDocsURL,
		"reference_url":          publicReferenceURL,
		"playground_url":         publicPlaygroundURL,
		"openapi_url":            publicOpenAPIURL,
		"documentation_json_url": publicExportURL,
		"endpoints": gin.H{
			"models": gin.H{
				"method": "GET",
				"url":    fmt.Sprintf("%s/models", apiBaseURL),
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
				},
			},
			"files": gin.H{
				"method": "POST",
				"url":    fmt.Sprintf("%s/files", apiBaseURL),
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
					"Content-Type":  "multipart/form-data",
				},
				"body": gin.H{
					"purpose": "assistants",
					"file":    "@/path/to/document.pdf",
				},
				"notes": []string{
					"Upload input files first, then reference the returned file id from /v1/responses.",
					"Uploaded files are scoped to the api token that created them.",
				},
			},
			"file": gin.H{
				"method": "GET",
				"url":    fmt.Sprintf("%s/files/{file_id}", apiBaseURL),
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
				},
			},
			"responses": gin.H{
				"method": "POST",
				"url":    fmt.Sprintf("%s/responses", apiBaseURL),
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
					"Content-Type":  "application/json",
				},
				"body": gin.H{
					"model": agentName,
					"input": []gin.H{
						{
							"role": "user",
							"content": []gin.H{
								{
									"type": "input_text",
									"text": "Summarize the uploaded file and return JSON.",
								},
								{
									"type":    "input_file",
									"file_id": "file_...",
								},
							},
						},
					},
					"previous_response_id": "optional for follow-up turns",
					"text": gin.H{
						"format": gin.H{
							"type":   "json_schema",
							"name":   "summary",
							"schema": gin.H{"type": "object"},
							"strict": true,
						},
					},
				},
			},
			"chat_completions": gin.H{
				"method": "POST",
				"url":    fmt.Sprintf("%s/chat/completions", apiBaseURL),
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
					"Content-Type":  "application/json",
				},
				"body": gin.H{
					"model": agentName,
					"messages": []gin.H{
						{
							"role":    "user",
							"content": "Review the contract and return the key risks.",
						},
					},
					"stream": false,
				},
			},
			"response": gin.H{
				"method": "GET",
				"url":    fmt.Sprintf("%s/responses/{response_id}", apiBaseURL),
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
				},
			},
			"file_content": gin.H{
				"method": "GET",
				"url":    fmt.Sprintf("%s/files/{file_id}/content", apiBaseURL),
				"headers": gin.H{
					"Authorization": "Bearer <api_token>",
				},
				"notes": []string{
					"Use the file id from the response.artifacts array.",
					"Append ?download=true when you want an attachment download header.",
				},
			},
		},
	}
}

func (h *AgentHandler) buildOpenAPIDocument(c *gin.Context, agentName string) gin.H {
	baseURL := resolvePublicGatewayBaseURL(c)
	apiBaseURL := fmt.Sprintf("%s/v1", baseURL)
	publicDocsURL := fmt.Sprintf("%s/docs/agents/%s", baseURL, agentName)
	publicPlaygroundURL := fmt.Sprintf("%s/docs/agents/%s/playground", baseURL, agentName)

	// Keep examples short and task-agnostic so every published agent starts with
	// a usable contract without embedding vertical-specific prompt glue.
	responsesExample := gin.H{
		"model": agentName,
		"input": []gin.H{
			{
				"role": "user",
				"content": []gin.H{
					{
						"type": "input_text",
						"text": "Summarize the uploaded materials and list the next actions.",
					},
				},
			},
		},
		"stream": false,
	}
	chatExample := gin.H{
		"model": agentName,
		"messages": []gin.H{
			{
				"role":    "user",
				"content": "Summarize the uploaded materials and list the next actions.",
			},
		},
		"stream": false,
	}

	return gin.H{
		"openapi": "3.1.0",
		"info": gin.H{
			"title":       fmt.Sprintf("%s Public API", agentName),
			"version":     "1.0.0",
			"description": "OpenAI-compatible surface for a published OpenAgents contract.",
		},
		"servers": []gin.H{
			{"url": apiBaseURL},
		},
		"security": []gin.H{
			{"bearerAuth": []string{}},
		},
		"tags": []gin.H{
			{
				"name":        "Published Agents",
				"description": "Stable northbound endpoints for published agent contracts.",
			},
		},
		"paths": gin.H{
			"/models": gin.H{
				"get": gin.H{
					"tags":        []string{"Published Agents"},
					"summary":     "List published agent models",
					"description": "Returns the published agents visible to the supplied API key.",
					"operationId": "listPublishedAgentModels",
					"responses": gin.H{
						"200": gin.H{
							"description": "Published models returned successfully.",
							"content": gin.H{
								"application/json": gin.H{
									"schema": gin.H{
										"$ref": "#/components/schemas/ModelListResponse",
									},
								},
							},
						},
						"401": gin.H{
							"$ref": "#/components/responses/ErrorResponse",
						},
						"403": gin.H{
							"$ref": "#/components/responses/ErrorResponse",
						},
					},
				},
			},
			"/files": gin.H{
				"post": gin.H{
					"tags":        []string{"Published Agents"},
					"summary":     "Upload an input file",
					"description": "Uploads a file to attach later as an `input_file` block in `/responses`.",
					"operationId": "uploadPublishedAgentFile",
					"requestBody": gin.H{
						"required": true,
						"content": gin.H{
							"multipart/form-data": gin.H{
								"schema": gin.H{
									"type": "object",
									"properties": gin.H{
										"purpose": gin.H{
											"type":    "string",
											"example": "assistants",
										},
										"file": gin.H{
											"type":   "string",
											"format": "binary",
										},
									},
									"required": []string{"purpose", "file"},
								},
							},
						},
					},
					"responses": gin.H{
						"200": gin.H{
							"description": "File uploaded successfully.",
							"content": gin.H{
								"application/json": gin.H{
									"schema": gin.H{
										"$ref": "#/components/schemas/FileObject",
									},
								},
							},
						},
						"400": gin.H{"$ref": "#/components/responses/ErrorResponse"},
						"401": gin.H{"$ref": "#/components/responses/ErrorResponse"},
					},
				},
			},
			"/files/{file_id}": gin.H{
				"get": gin.H{
					"tags":        []string{"Published Agents"},
					"summary":     "Get file metadata",
					"description": "Returns metadata for a previously uploaded file.",
					"operationId": "getPublishedAgentFile",
					"parameters": []gin.H{
						{
							"name":     "file_id",
							"in":       "path",
							"required": true,
							"schema": gin.H{
								"type": "string",
							},
						},
					},
					"responses": gin.H{
						"200": gin.H{
							"description": "File metadata returned successfully.",
							"content": gin.H{
								"application/json": gin.H{
									"schema": gin.H{
										"$ref": "#/components/schemas/FileObject",
									},
								},
							},
						},
						"401": gin.H{"$ref": "#/components/responses/ErrorResponse"},
						"404": gin.H{"$ref": "#/components/responses/ErrorResponse"},
					},
				},
			},
			"/files/{file_id}/content": gin.H{
				"get": gin.H{
					"tags":        []string{"Published Agents"},
					"summary":     "Download file content",
					"description": "Downloads the raw bytes for an uploaded file.",
					"operationId": "downloadPublishedAgentFile",
					"parameters": []gin.H{
						{
							"name":     "file_id",
							"in":       "path",
							"required": true,
							"schema": gin.H{
								"type": "string",
							},
						},
					},
					"responses": gin.H{
						"200": gin.H{
							"description": "Raw file content.",
							"content": gin.H{
								"application/octet-stream": gin.H{
									"schema": gin.H{
										"type":   "string",
										"format": "binary",
									},
								},
							},
						},
						"401": gin.H{"$ref": "#/components/responses/ErrorResponse"},
						"404": gin.H{"$ref": "#/components/responses/ErrorResponse"},
					},
				},
			},
			"/responses": gin.H{
				"post": gin.H{
					"tags":        []string{"Published Agents"},
					"summary":     "Run the published agent",
					"description": fmt.Sprintf("Use `model=%s` to execute this published agent contract. Use `stream=true` for SSE.", agentName),
					"operationId": "createPublishedAgentResponse",
					"requestBody": gin.H{
						"required": true,
						"content": gin.H{
							"application/json": gin.H{
								"schema": gin.H{
									"$ref": "#/components/schemas/ResponsesRequest",
								},
								"examples": gin.H{
									"blocking": gin.H{
										"summary": "Blocking response",
										"value":   responsesExample,
									},
									"streaming": gin.H{
										"summary": "Streaming response",
										"value": func() gin.H {
											streaming := cloneMap(responsesExample)
											streaming["stream"] = true
											return streaming
										}(),
									},
								},
							},
						},
					},
					"responses": gin.H{
						"200": gin.H{
							"description": "Blocking response envelope.",
							"content": gin.H{
								"application/json": gin.H{
									"schema": gin.H{
										"$ref": "#/components/schemas/ResponseEnvelope",
									},
								},
								"text/event-stream": gin.H{
									"schema": gin.H{
										"type":   "string",
										"format": "binary",
									},
								},
							},
						},
						"400": gin.H{"$ref": "#/components/responses/ErrorResponse"},
						"401": gin.H{"$ref": "#/components/responses/ErrorResponse"},
						"403": gin.H{"$ref": "#/components/responses/ErrorResponse"},
					},
				},
			},
			"/chat/completions": gin.H{
				"post": gin.H{
					"tags":        []string{"Published Agents"},
					"summary":     "Chat Completions compatibility surface",
					"description": "OpenAI Chat Completions-compatible adapter for the published agent contract.",
					"operationId": "createPublishedAgentChatCompletion",
					"requestBody": gin.H{
						"required": true,
						"content": gin.H{
							"application/json": gin.H{
								"schema": gin.H{
									"$ref": "#/components/schemas/ChatCompletionsRequest",
								},
								"examples": gin.H{
									"blocking": gin.H{
										"summary": "Blocking chat completion",
										"value":   chatExample,
									},
									"streaming": gin.H{
										"summary": "Streaming chat completion",
										"value": func() gin.H {
											streaming := cloneMap(chatExample)
											streaming["stream"] = true
											return streaming
										}(),
									},
								},
							},
						},
					},
					"responses": gin.H{
						"200": gin.H{
							"description": "Chat completion response.",
							"content": gin.H{
								"application/json": gin.H{
									"schema": gin.H{
										"$ref": "#/components/schemas/ChatCompletionResponse",
									},
								},
								"text/event-stream": gin.H{
									"schema": gin.H{
										"type":   "string",
										"format": "binary",
									},
								},
							},
						},
						"400": gin.H{"$ref": "#/components/responses/ErrorResponse"},
						"401": gin.H{"$ref": "#/components/responses/ErrorResponse"},
						"403": gin.H{"$ref": "#/components/responses/ErrorResponse"},
					},
				},
			},
		},
		"components": gin.H{
			"securitySchemes": gin.H{
				"bearerAuth": gin.H{
					"type":         "http",
					"scheme":       "bearer",
					"bearerFormat": "API Key",
					"description":  "Use a published-agent API key created by the platform.",
				},
			},
			"responses": gin.H{
				"ErrorResponse": gin.H{
					"description": "Error response.",
					"content": gin.H{
						"application/json": gin.H{
							"schema": gin.H{
								"$ref": "#/components/schemas/ErrorResponse",
							},
						},
					},
				},
			},
			"schemas": gin.H{
				"ModelListResponse": gin.H{
					"type": "object",
					"properties": gin.H{
						"object": gin.H{"type": "string", "example": "list"},
						"data": gin.H{
							"type": "array",
							"items": gin.H{
								"$ref": "#/components/schemas/ModelObject",
							},
						},
					},
				},
				"ModelObject": gin.H{
					"type": "object",
					"properties": gin.H{
						"id":       gin.H{"type": "string", "example": agentName},
						"object":   gin.H{"type": "string", "example": "model"},
						"created":  gin.H{"type": "integer", "example": 1775700000},
						"owned_by": gin.H{"type": "string", "example": "openagents"},
						"description": gin.H{
							"type":    "string",
							"example": "Published agent contract",
						},
					},
				},
				"FileObject": gin.H{
					"type": "object",
					"properties": gin.H{
						"id":         gin.H{"type": "string", "example": "file_123"},
						"object":     gin.H{"type": "string", "example": "file"},
						"filename":   gin.H{"type": "string", "example": "contract.pdf"},
						"bytes":      gin.H{"type": "integer", "example": 1024},
						"created_at": gin.H{"type": "integer", "example": 1775700000},
						"purpose":    gin.H{"type": "string", "example": "assistants"},
					},
				},
				"ResponsesRequest": gin.H{
					"type": "object",
					"properties": gin.H{
						"model": gin.H{
							"type":    "string",
							"example": agentName,
						},
						"input": gin.H{
							"oneOf": []gin.H{
								{"type": "string"},
								{
									"type": "array",
									"items": gin.H{
										"$ref": "#/components/schemas/InputMessage",
									},
								},
							},
						},
						"stream":               gin.H{"type": "boolean", "default": false},
						"previous_response_id": gin.H{"type": "string"},
						"reasoning": gin.H{
							"type": "object",
							"properties": gin.H{
								"effort":  gin.H{"type": "string", "enum": []string{"minimal", "low", "medium", "high"}},
								"summary": gin.H{"type": "string"},
							},
						},
						"text": gin.H{
							"type": "object",
							"properties": gin.H{
								"format": gin.H{
									"type": "object",
									"properties": gin.H{
										"type":   gin.H{"type": "string", "enum": []string{"json_schema"}},
										"name":   gin.H{"type": "string"},
										"schema": gin.H{"type": "object", "additionalProperties": true},
										"strict": gin.H{"type": "boolean"},
									},
								},
							},
						},
						"max_output_tokens": gin.H{"type": "integer"},
						"metadata": gin.H{
							"type":                 "object",
							"additionalProperties": true,
						},
					},
					"required": []string{"model", "input"},
				},
				"InputMessage": gin.H{
					"type": "object",
					"properties": gin.H{
						"role": gin.H{"type": "string", "example": "user"},
						"content": gin.H{
							"oneOf": []gin.H{
								{"type": "string"},
								{
									"type": "array",
									"items": gin.H{
										"type": "object",
										"properties": gin.H{
											"type":    gin.H{"type": "string", "example": "input_text"},
											"text":    gin.H{"type": "string"},
											"file_id": gin.H{"type": "string"},
										},
										"additionalProperties": true,
									},
								},
							},
						},
					},
					"required": []string{"role", "content"},
				},
				"ResponseEnvelope": gin.H{
					"type":                 "object",
					"additionalProperties": true,
					"description":          fmt.Sprintf("Blocking response envelope. For interactive docs and debug tooling, see %s and %s.", publicDocsURL, publicPlaygroundURL),
				},
				"ChatCompletionsRequest": gin.H{
					"type": "object",
					"properties": gin.H{
						"model": gin.H{"type": "string", "example": agentName},
						"messages": gin.H{
							"type": "array",
							"items": gin.H{
								"type": "object",
								"properties": gin.H{
									"role":    gin.H{"type": "string", "example": "user"},
									"content": gin.H{"type": "string"},
								},
								"required": []string{"role", "content"},
							},
						},
						"stream": gin.H{"type": "boolean", "default": false},
						"response_format": gin.H{
							"type":                 "object",
							"additionalProperties": true,
						},
						"reasoning_effort": gin.H{
							"type": "string",
							"enum": []string{"minimal", "low", "medium", "high"},
						},
						"max_completion_tokens": gin.H{"type": "integer"},
					},
					"required": []string{"model", "messages"},
				},
				"ChatCompletionResponse": gin.H{
					"type":                 "object",
					"additionalProperties": true,
				},
				"ErrorResponse": gin.H{
					"type": "object",
					"properties": gin.H{
						"error":   gin.H{"type": "string"},
						"detail":  gin.H{"type": "string"},
						"details": gin.H{"type": "string"},
					},
				},
			},
		},
	}
}

func cloneMap(source gin.H) gin.H {
	cloned := gin.H{}
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func resolvePublicGatewayBaseURL(c *gin.Context) string {
	if explicit := strings.TrimSpace(os.Getenv("OPENAGENTS_PUBLIC_GATEWAY_URL")); explicit != "" {
		return strings.TrimRight(explicit, "/")
	}

	scheme := "http"
	if forwardedProto := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Proto"), ",")[0]); forwardedProto != "" {
		scheme = forwardedProto
	} else if c.Request.TLS != nil {
		scheme = "https"
	}

	host := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Host"), ",")[0])
	if host == "" {
		host = strings.TrimSpace(c.Request.Host)
	}
	host = appendForwardedPortIfNeeded(host, strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Port"), ",")[0]))

	switch {
	case strings.HasSuffix(host, ":3000"):
		host = strings.TrimSuffix(host, ":3000") + ":8001"
	case strings.HasSuffix(host, ":5173"):
		host = strings.TrimSuffix(host, ":5173") + ":8001"
	}

	return strings.TrimRight(fmt.Sprintf("%s://%s", scheme, host), "/")
}

func appendForwardedPortIfNeeded(host string, port string) string {
	if host == "" || port == "" {
		return host
	}

	// Reverse proxies sometimes forward a bare host while publishing the external
	// port separately. Preserve that externally routable address in export docs so
	// the OpenAI-compatible base URL matches what browsers and API clients can hit.
	if _, _, err := net.SplitHostPort(host); err == nil {
		return host
	}
	if port == "80" || port == "443" {
		return host
	}
	return net.JoinHostPort(strings.Trim(host, "[]"), port)
}
