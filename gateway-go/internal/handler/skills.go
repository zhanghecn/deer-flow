package handler

import (
	"net/http"

	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/service"
	"github.com/gin-gonic/gin"
)

type SkillHandler struct {
	svc *service.SkillService
}

func NewSkillHandler(svc *service.SkillService) *SkillHandler {
	return &SkillHandler{svc: svc}
}

func (h *SkillHandler) List(c *gin.Context) {
	status := c.Query("status")
	skills, err := h.svc.List(c.Request.Context(), status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if skills == nil {
		skills = []model.Skill{}
	}
	c.JSON(http.StatusOK, skills)
}

func (h *SkillHandler) Create(c *gin.Context) {
	var req model.CreateSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	userID := middleware.GetUserID(c)
	skill, err := h.svc.Create(c.Request.Context(), req, userID)
	if err != nil {
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusCreated, skill)
}

func (h *SkillHandler) Update(c *gin.Context) {
	name := c.Param("name")
	var req model.UpdateSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	skill, err := h.svc.Update(c.Request.Context(), name, req)
	if err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, skill)
}

func (h *SkillHandler) Delete(c *gin.Context) {
	name := c.Param("name")
	if err := h.svc.Delete(c.Request.Context(), name); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse{Message: "skill deleted"})
}

func (h *SkillHandler) Publish(c *gin.Context) {
	name := c.Param("name")
	skill, err := h.svc.Publish(c.Request.Context(), name)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, skill)
}
