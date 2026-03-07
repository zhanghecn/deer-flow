package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

type AdminHandler struct {
	userRepo          *repository.UserRepo
	observabilityRepo *repository.AdminObservabilityRepo
	llmKeyRepo        *repository.LLMKeyRepo
}

func NewAdminHandler(
	userRepo *repository.UserRepo,
	observabilityRepo *repository.AdminObservabilityRepo,
	llmKeyRepo *repository.LLMKeyRepo,
) *AdminHandler {
	return &AdminHandler{userRepo: userRepo, observabilityRepo: observabilityRepo, llmKeyRepo: llmKeyRepo}
}

type updateUserRoleRequest struct {
	Role string `json:"role" binding:"required"`
}

func (h *AdminHandler) ListUsers(c *gin.Context) {
	users, err := h.userRepo.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list users"})
		return
	}
	if users == nil {
		users = []model.User{}
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

func (h *AdminHandler) UpdateUserRole(c *gin.Context) {
	userIDRaw := strings.TrimSpace(c.Param("id"))
	userID, err := uuid.Parse(userIDRaw)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid user id"})
		return
	}

	var req updateUserRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	role := strings.ToLower(strings.TrimSpace(req.Role))
	if role != "admin" && role != "user" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "role must be one of: admin, user"})
		return
	}

	if err := h.userRepo.UpdateRole(c.Request.Context(), userID, role); err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "user not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to update user role"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "user role updated"})
}

func (h *AdminHandler) ListTraces(c *gin.Context) {
	userIDRaw := strings.TrimSpace(c.Query("user_id"))
	agentName := strings.TrimSpace(c.Query("agent_name"))
	threadID := strings.TrimSpace(c.Query("thread_id"))
	limit, offset := repository.ParseTracePagination(c.Query("limit"), c.Query("offset"))

	var userID *uuid.UUID
	if userIDRaw != "" {
		parsed, err := uuid.Parse(userIDRaw)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid user_id"})
			return
		}
		userID = &parsed
	}

	traces, err := h.observabilityRepo.ListTraces(
		c.Request.Context(),
		userID,
		agentName,
		threadID,
		limit,
		offset,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list traces"})
		return
	}
	if traces == nil {
		traces = []repository.AgentTraceRecord{}
	}
	c.JSON(http.StatusOK, gin.H{
		"items":  traces,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *AdminHandler) GetTraceEvents(c *gin.Context) {
	traceID := strings.TrimSpace(c.Param("trace_id"))
	if traceID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "trace_id is required"})
		return
	}
	events, err := h.observabilityRepo.ListTraceEvents(c.Request.Context(), traceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list trace events"})
		return
	}
	if events == nil {
		events = []repository.AgentTraceEventRecord{}
	}
	c.JSON(http.StatusOK, gin.H{"items": events})
}

func (h *AdminHandler) ListRuntimeThreads(c *gin.Context) {
	limit, offset := repository.ParseTracePagination(c.Query("limit"), c.Query("offset"))
	threads, err := h.observabilityRepo.ListRuntimeThreads(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list runtime threads"})
		return
	}
	if threads == nil {
		threads = []repository.RuntimeThreadRecord{}
	}
	c.JSON(http.StatusOK, gin.H{
		"items":  threads,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *AdminHandler) GetCheckpointStatus(c *gin.Context) {
	tables, err := h.observabilityRepo.ListCheckpointTables(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to inspect checkpoint tables"})
		return
	}
	if tables == nil {
		tables = []repository.CheckpointTableRecord{}
	}
	c.JSON(http.StatusOK, gin.H{
		"enabled": len(tables) > 0,
		"tables":  tables,
	})
}

// DeleteUser removes a user by ID.
func (h *AdminHandler) DeleteUser(c *gin.Context) {
	userIDRaw := strings.TrimSpace(c.Param("id"))
	userID, err := uuid.Parse(userIDRaw)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid user id"})
		return
	}

	if err := h.userRepo.Delete(c.Request.Context(), userID); err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "user not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to delete user"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "user deleted"})
}

// GetStats returns aggregate statistics for the admin dashboard.
func (h *AdminHandler) GetStats(c *gin.Context) {
	stats, err := h.observabilityRepo.GetStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to get stats"})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// maskAPIKey returns a masked version of an API key for display.
func maskAPIKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "****" + key[len(key)-4:]
}

type createLLMKeyRequest struct {
	ProviderName string  `json:"provider_name" binding:"required"`
	DisplayName  string  `json:"display_name" binding:"required"`
	APIKey       string  `json:"api_key" binding:"required"`
	BaseURL      *string `json:"base_url"`
	IsActive     *bool   `json:"is_active"`
}

type updateLLMKeyRequest struct {
	ProviderName string  `json:"provider_name" binding:"required"`
	DisplayName  string  `json:"display_name" binding:"required"`
	APIKey       string  `json:"api_key" binding:"required"`
	BaseURL      *string `json:"base_url"`
	IsActive     *bool   `json:"is_active"`
}

type llmKeyResponse struct {
	ID           uuid.UUID  `json:"id"`
	ProviderName string     `json:"provider_name"`
	DisplayName  string     `json:"display_name"`
	APIKey       string     `json:"api_key"`
	BaseURL      *string    `json:"base_url"`
	IsActive     bool       `json:"is_active"`
	CreatedBy    *uuid.UUID `json:"created_by"`
	CreatedAt    string     `json:"created_at"`
	UpdatedAt    string     `json:"updated_at"`
}

func toLLMKeyResponse(k repository.LLMProviderKey) llmKeyResponse {
	return llmKeyResponse{
		ID:           k.ID,
		ProviderName: k.ProviderName,
		DisplayName:  k.DisplayName,
		APIKey:       maskAPIKey(k.APIKey),
		BaseURL:      k.BaseURL,
		IsActive:     k.IsActive,
		CreatedBy:    k.CreatedBy,
		CreatedAt:    k.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:    k.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// ListLLMKeys returns all LLM provider keys (with masked API keys).
func (h *AdminHandler) ListLLMKeys(c *gin.Context) {
	keys, err := h.llmKeyRepo.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list LLM keys"})
		return
	}
	items := make([]llmKeyResponse, len(keys))
	for i, k := range keys {
		items[i] = toLLMKeyResponse(k)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// CreateLLMKey creates a new LLM provider key.
func (h *AdminHandler) CreateLLMKey(c *gin.Context) {
	var req createLLMKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	record := &repository.LLMProviderKey{
		ProviderName: req.ProviderName,
		DisplayName:  req.DisplayName,
		APIKey:       req.APIKey,
		BaseURL:      req.BaseURL,
		IsActive:     isActive,
	}

	if err := h.llmKeyRepo.Create(c.Request.Context(), record); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to create LLM key"})
		return
	}

	c.JSON(http.StatusCreated, toLLMKeyResponse(*record))
}

// UpdateLLMKey updates an existing LLM provider key.
func (h *AdminHandler) UpdateLLMKey(c *gin.Context) {
	idRaw := strings.TrimSpace(c.Param("id"))
	id, err := uuid.Parse(idRaw)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid id"})
		return
	}

	var req updateLLMKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	record := &repository.LLMProviderKey{
		ProviderName: req.ProviderName,
		DisplayName:  req.DisplayName,
		APIKey:       req.APIKey,
		BaseURL:      req.BaseURL,
		IsActive:     isActive,
	}

	if err := h.llmKeyRepo.Update(c.Request.Context(), id, record); err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "LLM key not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to update LLM key"})
		return
	}

	record.ID = id
	c.JSON(http.StatusOK, toLLMKeyResponse(*record))
}

// DeleteLLMKey removes an LLM provider key by ID.
func (h *AdminHandler) DeleteLLMKey(c *gin.Context) {
	idRaw := strings.TrimSpace(c.Param("id"))
	id, err := uuid.Parse(idRaw)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "invalid id"})
		return
	}

	if err := h.llmKeyRepo.Delete(c.Request.Context(), id); err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "LLM key not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to delete LLM key"})
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "LLM key deleted"})
}
