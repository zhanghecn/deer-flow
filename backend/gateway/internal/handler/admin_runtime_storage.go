package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
)

func (h *AdminHandler) RuntimeStorageSummary(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	summary, err := h.runtimeStorageSvc.Summary(c.Request.Context(), parseRefreshQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to inspect runtime storage"})
		return
	}
	c.JSON(http.StatusOK, summary)
}

func (h *AdminHandler) RuntimeStorageUsers(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	page, err := h.runtimeStorageSvc.UsersPage(
		c.Request.Context(),
		parseRefreshQuery(c),
		runtimeStorageListOptionsFromQuery(c),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to inspect runtime storage users"})
		return
	}
	if page.Items == nil {
		page.Items = []model.RuntimeStorageUserUsage{}
	}
	c.JSON(http.StatusOK, page)
}

func (h *AdminHandler) RuntimeStorageUserDetail(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	userID := strings.TrimSpace(c.Param("user_id"))
	if userID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "user_id is required"})
		return
	}
	detail, ok, err := h.runtimeStorageSvc.UserDetail(c.Request.Context(), userID, parseRefreshQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to inspect runtime storage user"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "runtime storage user not found"})
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h *AdminHandler) RuntimeStorageThreads(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	page, err := h.runtimeStorageSvc.ThreadsPage(
		c.Request.Context(),
		parseRefreshQuery(c),
		runtimeStorageListOptionsFromQuery(c),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to inspect runtime storage threads"})
		return
	}
	if page.Items == nil {
		page.Items = []model.RuntimeStorageThreadUsage{}
	}
	c.JSON(http.StatusOK, page)
}

func (h *AdminHandler) RuntimeStorageThreadDetail(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	threadID := strings.TrimSpace(c.Param("thread_id"))
	if threadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread_id is required"})
		return
	}
	thread, ok, err := h.runtimeStorageSvc.ThreadDetail(c.Request.Context(), threadID, parseRefreshQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to inspect runtime storage thread"})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "runtime storage thread not found"})
		return
	}
	c.JSON(http.StatusOK, thread)
}

func (h *AdminHandler) RuntimeStorageCleanupPreview(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	var req model.RuntimeStorageCleanupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	preview, err := h.runtimeStorageSvc.PreviewCleanup(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, preview)
}

func (h *AdminHandler) RuntimeStorageCreateCleanupJob(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	var req model.RuntimeStorageCleanupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	adminUserID := middleware.GetUserID(c).String()
	job, err := h.runtimeStorageSvc.CreateCleanupJob(c.Request.Context(), adminUserID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, job)
}

func (h *AdminHandler) RuntimeStorageCleanupJob(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	jobID := strings.TrimSpace(c.Param("job_id"))
	if jobID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "job_id is required"})
		return
	}
	job, ok := h.runtimeStorageSvc.GetCleanupJob(jobID)
	if !ok {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "cleanup job not found"})
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *AdminHandler) RuntimeStorageCleanupPolicies(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	policies, err := h.runtimeStorageSvc.CleanupPolicies(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load cleanup policies"})
		return
	}
	if policies == nil {
		policies = []model.RuntimeStorageCleanupPolicy{}
	}
	c.JSON(http.StatusOK, gin.H{"items": policies})
}

func (h *AdminHandler) RuntimeStorageUpdateCleanupPolicy(c *gin.Context) {
	if !h.ensureRuntimeStorageService(c) {
		return
	}
	action := strings.TrimSpace(c.Param("action"))
	if action == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "action is required"})
		return
	}
	var req model.RuntimeStorageCleanupPolicyUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	policy, err := h.runtimeStorageSvc.UpdateCleanupPolicy(c.Request.Context(), action, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, policy)
}

func (h *AdminHandler) ensureRuntimeStorageService(c *gin.Context) bool {
	if h.runtimeStorageSvc != nil {
		return true
	}
	c.JSON(http.StatusServiceUnavailable, model.ErrorResponse{Error: "runtime storage service is not configured"})
	return false
}

func parseRefreshQuery(c *gin.Context) bool {
	return strings.EqualFold(strings.TrimSpace(c.Query("refresh")), "true")
}

func runtimeStorageListOptionsFromQuery(c *gin.Context) model.RuntimeStorageListOptions {
	limit, offset := parseRuntimeStoragePagination(c.Query("limit"), c.Query("offset"))
	return model.RuntimeStorageListOptions{
		Limit:        limit,
		Offset:       offset,
		SortBy:       strings.TrimSpace(c.Query("sort_by")),
		Query:        strings.TrimSpace(c.Query("query")),
		UserID:       strings.TrimSpace(c.Query("user_id")),
		InactiveDays: parseRuntimeStorageInt(c.Query("inactive_days")),
	}
}

func parseRuntimeStoragePagination(limitRaw string, offsetRaw string) (int, int) {
	limit := parseRuntimeStorageInt(limitRaw)
	offset := parseRuntimeStorageInt(offsetRaw)
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func parseRuntimeStorageInt(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0
	}
	return value
}
