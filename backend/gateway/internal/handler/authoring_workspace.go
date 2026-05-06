package handler

import (
	"context"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/internal/service"
	"github.com/openagents/gateway/pkg/storage"
)

type authoringThreadRepository interface {
	GetRuntimeByUser(
		ctx context.Context,
		userID uuid.UUID,
		threadID string,
	) (*repository.ThreadRuntimeRecord, error)
	GetOwnerByThreadID(
		ctx context.Context,
		threadID string,
	) (uuid.UUID, error)
}

type AuthoringWorkspaceHandler struct {
	svc        *service.AuthoringWorkspaceService
	fs         *storage.FS
	threadRepo authoringThreadRepository
}

var authoringThreadIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func normalizeAuthoringDraftAgentStatus(status string) string {
	if strings.TrimSpace(status) == "prod" {
		return "prod"
	}
	return "dev"
}

func NewAuthoringWorkspaceHandler(
	svc *service.AuthoringWorkspaceService,
	fs *storage.FS,
	threadRepo authoringThreadRepository,
) *AuthoringWorkspaceHandler {
	return &AuthoringWorkspaceHandler{
		svc:        svc,
		fs:         fs,
		threadRepo: threadRepo,
	}
}

func (h *AuthoringWorkspaceHandler) CreateAgentDraft(c *gin.Context) {
	name := c.Param("name")
	var req model.CreateAgentAuthoringDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	userID, ok := h.ensureThreadAccess(c, req.ThreadID)
	if !ok {
		return
	}

	agent, err := agentfs.LoadAgent(h.fs, name, normalizeAuthoringDraftAgentStatus(req.AgentStatus), false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}
	if !canManageAgent(c, agent) {
		writeManageAgentForbidden(c)
		return
	}

	rootPath, files, err := h.svc.StageAgentDraft(userID.String(), req.ThreadID, name, req.AgentStatus, req.Overwrite)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"root_path": rootPath, "files": files})
}

func (h *AuthoringWorkspaceHandler) CreateSkillDraft(c *gin.Context) {
	name := c.Param("name")
	var req model.CreateSkillAuthoringDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	userID, ok := h.ensureThreadAccess(c, req.ThreadID)
	if !ok {
		return
	}

	rootPath, files, err := h.svc.StageSkillDraft(userID.String(), req.ThreadID, name, req.SourcePath)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"root_path": rootPath, "files": files})
}

func (h *AuthoringWorkspaceHandler) ListFiles(c *gin.Context) {
	var req model.ListAuthoringFilesRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	userID, ok := h.ensureThreadAccess(c, req.ThreadID)
	if !ok {
		return
	}

	files, err := h.svc.ListDraftFiles(userID.String(), req.ThreadID, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"files": files})
}

func (h *AuthoringWorkspaceHandler) ReadFile(c *gin.Context) {
	var req model.ReadAuthoringFileRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	userID, ok := h.ensureThreadAccess(c, req.ThreadID)
	if !ok {
		return
	}

	content, err := h.svc.ReadDraftFile(userID.String(), req.ThreadID, req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": req.Path, "content": content})
}

func (h *AuthoringWorkspaceHandler) WriteFile(c *gin.Context) {
	var req model.WriteAuthoringFileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	userID, ok := h.ensureThreadAccess(c, req.ThreadID)
	if !ok {
		return
	}

	if err := h.svc.WriteDraftFile(userID.String(), req.ThreadID, req.Path, req.Content); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": req.Path, "saved": true})
}

func (h *AuthoringWorkspaceHandler) DeleteFile(c *gin.Context) {
	var req model.DeleteAuthoringFileRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	userID, ok := h.ensureThreadAccess(c, req.ThreadID)
	if !ok {
		return
	}

	if err := h.svc.DeleteDraftPath(userID.String(), req.ThreadID, req.Path); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": req.Path, "deleted": true})
}

func (h *AuthoringWorkspaceHandler) SaveAgentDraft(c *gin.Context) {
	name := c.Param("name")
	var req model.SaveAgentAuthoringDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	userID, ok := h.ensureThreadAccess(c, req.ThreadID)
	if !ok {
		return
	}

	agent, err := agentfs.LoadAgent(h.fs, name, normalizeAuthoringDraftAgentStatus(req.AgentStatus), false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: err.Error()})
		return
	}
	if agent == nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "agent not found"})
		return
	}
	if !canManageAgent(c, agent) {
		writeManageAgentForbidden(c)
		return
	}

	rootPath, err := h.svc.SaveAgentDraft(userID.String(), req.ThreadID, name, req.AgentStatus)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"root_path": rootPath, "saved": true})
}

func (h *AuthoringWorkspaceHandler) SaveSkillDraft(c *gin.Context) {
	name := c.Param("name")
	var req model.SaveSkillAuthoringDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	userID, ok := h.ensureThreadAccess(c, req.ThreadID)
	if !ok {
		return
	}

	rootPath, err := h.svc.SaveSkillDraft(userID.String(), req.ThreadID, name)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"root_path": rootPath, "saved": true})
}

func (h *AuthoringWorkspaceHandler) ensureThreadAccess(c *gin.Context, threadID string) (uuid.UUID, bool) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return uuid.Nil, false
	}
	normalizedThreadID := strings.TrimSpace(threadID)
	if normalizedThreadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread_id is required"})
		return uuid.Nil, false
	}
	if !authoringThreadIDPattern.MatchString(normalizedThreadID) {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread_id must use only letters, numbers, hyphens, or underscores"})
		return uuid.Nil, false
	}
	if h.threadRepo == nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "thread repository unavailable"})
		return uuid.Nil, false
	}
	if _, err := h.threadRepo.GetRuntimeByUser(c.Request.Context(), userID, normalizedThreadID); err != nil {
		if err == pgx.ErrNoRows {
			ownerID, ownerErr := h.threadRepo.GetOwnerByThreadID(c.Request.Context(), normalizedThreadID)
			switch ownerErr {
			case nil:
				if ownerID != userID && !middleware.IsAdmin(c) {
					c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "thread not found"})
					return uuid.Nil, false
				}
			case pgx.ErrNoRows:
				// Authoring workbenches can bootstrap from an unbound UUID-style
				// draft thread id before any runtime has persisted thread_bindings.
			default:
				c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to resolve thread owner"})
				return uuid.Nil, false
			}
		} else {
			c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load thread runtime"})
			return uuid.Nil, false
		}
	}
	if err := h.fs.EnsureThreadDirsForUser(userID.String(), normalizedThreadID); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to initialize authoring workspace"})
		return uuid.Nil, false
	}
	return userID, true
}
