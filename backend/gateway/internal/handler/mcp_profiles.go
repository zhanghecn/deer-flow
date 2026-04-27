package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/service"
)

type MCPProfileHandler struct {
	svc *service.MCPProfileService
}

func NewMCPProfileHandler(svc *service.MCPProfileService) *MCPProfileHandler {
	return &MCPProfileHandler{svc: svc}
}

func writeMCPProfileServiceError(c *gin.Context, err error, notFoundStatus int) {
	switch {
	case errors.Is(err, service.ErrMCPProfileReadOnly):
		c.JSON(http.StatusForbidden, model.ErrorResponse{Error: err.Error()})
	case errors.Is(err, service.ErrMCPProfileAmbiguous):
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: err.Error()})
	case errors.Is(err, service.ErrMCPProfileInvalidSourcePath):
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
	case errors.Is(err, service.ErrMCPProfileInvalidConfig):
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
	default:
		c.JSON(notFoundStatus, model.ErrorResponse{Error: err.Error()})
	}
}

func (h *MCPProfileHandler) List(c *gin.Context) {
	items, err := h.svc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if items == nil {
		items = []model.MCPProfile{}
	}
	c.JSON(http.StatusOK, gin.H{"profiles": items})
}

func (h *MCPProfileHandler) Get(c *gin.Context) {
	name := c.Param("name")
	sourcePath := c.Query("source_path")
	profile, err := h.svc.Get(c.Request.Context(), name, sourcePath)
	if err != nil {
		writeMCPProfileServiceError(c, err, http.StatusNotFound)
		return
	}
	c.JSON(http.StatusOK, profile)
}

func (h *MCPProfileHandler) Create(c *gin.Context) {
	var req model.CreateMCPProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	profile, err := h.svc.Create(c.Request.Context(), req)
	if err != nil {
		writeMCPProfileServiceError(c, err, http.StatusConflict)
		return
	}
	c.JSON(http.StatusCreated, profile)
}

func (h *MCPProfileHandler) Update(c *gin.Context) {
	name := c.Param("name")
	var req model.UpdateMCPProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	profile, err := h.svc.Update(c.Request.Context(), name, req)
	if err != nil {
		writeMCPProfileServiceError(c, err, http.StatusNotFound)
		return
	}
	c.JSON(http.StatusOK, profile)
}

func (h *MCPProfileHandler) Delete(c *gin.Context) {
	name := c.Param("name")
	if err := h.svc.Delete(c.Request.Context(), name); err != nil {
		writeMCPProfileServiceError(c, err, http.StatusNotFound)
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse{Message: "mcp profile deleted"})
}
