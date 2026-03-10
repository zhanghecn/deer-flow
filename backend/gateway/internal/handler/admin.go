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
}

func NewAdminHandler(
	userRepo *repository.UserRepo,
	observabilityRepo *repository.AdminObservabilityRepo,
) *AdminHandler {
	return &AdminHandler{userRepo: userRepo, observabilityRepo: observabilityRepo}
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
	total, err := h.observabilityRepo.CountTraces(c.Request.Context(), userID, agentName, threadID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to count traces"})
		return
	}
	if traces == nil {
		traces = []repository.AgentTraceRecord{}
	}
	c.JSON(http.StatusOK, gin.H{
		"items":  traces,
		"limit":  limit,
		"offset": offset,
		"total":  total,
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
