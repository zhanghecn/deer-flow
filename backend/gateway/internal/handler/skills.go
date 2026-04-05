package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

type SkillHandler struct {
	svc                  *service.SkillService
	fs                   *storage.FS
	extensionsConfigPath string
}

func NewSkillHandler(svc *service.SkillService, fs *storage.FS, extensionsConfigPath string) *SkillHandler {
	return &SkillHandler{
		svc:                  svc,
		fs:                   fs,
		extensionsConfigPath: extensionsConfigPath,
	}
}

func writeSkillServiceError(c *gin.Context, err error, notFoundStatus int) {
	switch {
	case errors.Is(err, service.ErrSkillReadOnly):
		c.JSON(http.StatusForbidden, model.ErrorResponse{Error: err.Error()})
	case errors.Is(err, service.ErrSkillAmbiguous):
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: err.Error()})
	case errors.Is(err, service.ErrSkillInvalidSourcePath):
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
	default:
		c.JSON(notFoundStatus, model.ErrorResponse{Error: err.Error()})
	}
}

func (h *SkillHandler) List(c *gin.Context) {
	status := c.Query("status")
	skills, err := listFilesystemSkills(h.fs, h.extensionsConfigPath, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if skills == nil {
		skills = []skillListItem{}
	}
	c.JSON(http.StatusOK, gin.H{"skills": skills})
}

func (h *SkillHandler) Get(c *gin.Context) {
	name := c.Param("name")
	sourcePath := c.Query("source_path")
	skill, err := h.svc.Get(c.Request.Context(), name, sourcePath)
	if err != nil {
		writeSkillServiceError(c, err, http.StatusNotFound)
		return
	}
	c.JSON(http.StatusOK, skill)
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
	var req struct {
		Enabled         *bool              `json:"enabled"`
		Description     *string            `json:"description"`
		DescriptionI18n *map[string]string `json:"description_i18n"`
		SkillMD         *string            `json:"skill_md"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	if req.Enabled != nil {
		skill, err := loadFilesystemSkillByName(h.fs, h.extensionsConfigPath, name)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
			return
		}
		if skill == nil {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "skill not found"})
			return
		}

		cfg, err := readExtensionsConfig(h.extensionsConfigPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read extensions config"})
			return
		}
		cfg.Skills[name] = skillStateJSON{Enabled: *req.Enabled}
		if err := writeExtensionsConfig(h.extensionsConfigPath, cfg); err != nil {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to write extensions config"})
			return
		}

		skill.Enabled = *req.Enabled
		c.JSON(http.StatusOK, skill)
		return
	}

	skill, err := h.svc.Update(c.Request.Context(), name, model.UpdateSkillRequest{
		Description:     req.Description,
		DescriptionI18n: req.DescriptionI18n,
		SkillMD:         req.SkillMD,
	})
	if err != nil {
		writeSkillServiceError(c, err, http.StatusNotFound)
		return
	}
	c.JSON(http.StatusOK, skill)
}

func (h *SkillHandler) Delete(c *gin.Context) {
	name := c.Param("name")
	if err := h.svc.Delete(c.Request.Context(), name); err != nil {
		writeSkillServiceError(c, err, http.StatusNotFound)
		return
	}
	c.JSON(http.StatusOK, model.SuccessResponse{Message: "skill deleted"})
}

func (h *SkillHandler) Install(c *gin.Context) {
	var req struct {
		ThreadID string `json:"thread_id" binding:"required"`
		Path     string `json:"path" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	skillName, err := installSkillArchive(h.fs, req.ThreadID, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"skill_name": skillName,
		"message":    "Skill '" + skillName + "' installed successfully to .openagents/custom/skills",
	})
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
