package handler

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

type ThreadsHandler struct {
	repo         threadSearchRepository
	langGraphURL string
	httpClient   *http.Client
	fs           threadFilesystem
}

type threadSearchRepository interface {
	SearchByUser(
		ctx context.Context,
		userID uuid.UUID,
		opts repository.ThreadSearchOptions,
	) ([]repository.ThreadSearchRecord, error)
	GetRuntimeByUser(
		ctx context.Context,
		userID uuid.UUID,
		threadID string,
	) (*repository.ThreadRuntimeRecord, error)
	UpdateTitle(
		ctx context.Context,
		userID uuid.UUID,
		threadID string,
		title string,
	) error
	ListIDsByUser(
		ctx context.Context,
		userID uuid.UUID,
	) ([]string, error)
	DeleteByUser(
		ctx context.Context,
		userID uuid.UUID,
		threadID string,
	) error
}

type threadFilesystem interface {
	DeleteThreadDir(threadID string) error
}

func NewThreadsHandler(
	repo threadSearchRepository,
	langGraphURL string,
	fs threadFilesystem,
) *ThreadsHandler {
	return &ThreadsHandler{
		repo:         repo,
		langGraphURL: strings.TrimRight(langGraphURL, "/"),
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		fs:           fs,
	}
}

type threadSearchRequest struct {
	Limit     int      `json:"limit"`
	Offset    int      `json:"offset"`
	SortBy    string   `json:"sort_by"`
	SortOrder string   `json:"sort_order"`
	Select    []string `json:"select"`
}

type updateThreadTitleRequest struct {
	Title string `json:"title"`
}

type clearThreadsResponse struct {
	DeletedCount int `json:"deleted_count"`
}

func (h *ThreadsHandler) Search(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	var req threadSearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	items, err := h.repo.SearchByUser(
		c.Request.Context(),
		userID,
		repository.ThreadSearchOptions{
			Limit:     req.Limit,
			Offset:    req.Offset,
			SortBy:    req.SortBy,
			SortOrder: req.SortOrder,
		},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to search threads"})
		return
	}
	if items == nil {
		items = []repository.ThreadSearchRecord{}
	}
	c.JSON(http.StatusOK, items)
}

func (h *ThreadsHandler) UpdateTitle(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Param("id"))
	if threadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id is required"})
		return
	}

	var req updateThreadTitleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "title is required"})
		return
	}

	if err := h.repo.UpdateTitle(c.Request.Context(), userID, threadID, req.Title); err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "thread not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to update thread title"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"thread_id": threadID,
		"title":     req.Title,
	})
}

func (h *ThreadsHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Param("id"))
	if threadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id is required"})
		return
	}

	if _, err := h.repo.GetRuntimeByUser(c.Request.Context(), userID, threadID); err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "thread not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load thread runtime"})
		return
	}

	if err := h.deleteThreadResources(c.Request.Context(), userID, threadID); err != nil {
		c.JSON(http.StatusBadGateway, model.ErrorResponse{Error: "failed to delete thread"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"thread_id": threadID,
		"deleted":   true,
	})
}

func (h *ThreadsHandler) ClearAll(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadIDs, err := h.repo.ListIDsByUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load threads"})
		return
	}

	deletedCount := 0
	for _, threadID := range threadIDs {
		if err := h.deleteThreadResources(c.Request.Context(), userID, threadID); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"error":         "failed to clear all threads",
				"deleted_count": deletedCount,
				"failed_thread": threadID,
			})
			return
		}
		deletedCount++
	}

	c.JSON(http.StatusOK, clearThreadsResponse{DeletedCount: deletedCount})
}

func (h *ThreadsHandler) GetRuntime(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, model.ErrorResponse{Error: "unauthorized"})
		return
	}

	threadID := strings.TrimSpace(c.Param("id"))
	if threadID == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "thread id is required"})
		return
	}

	record, err := h.repo.GetRuntimeByUser(c.Request.Context(), userID, threadID)
	if err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "thread not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to load thread runtime"})
		return
	}

	c.JSON(http.StatusOK, record)
}

func (h *ThreadsHandler) deleteThreadResources(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
) error {
	if err := h.deleteRuntimeThread(ctx, userID, threadID); err != nil {
		return err
	}
	if err := h.repo.DeleteByUser(ctx, userID, threadID); err != nil {
		return err
	}
	h.deleteThreadDirBestEffort(threadID)
	return nil
}

func (h *ThreadsHandler) deleteRuntimeThread(
	ctx context.Context,
	userID uuid.UUID,
	threadID string,
) error {
	if _, err := uuid.Parse(threadID); err != nil {
		log.Printf("threads: skipping runtime delete for legacy non-uuid thread id %q", threadID)
		return nil
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodDelete,
		h.langGraphURL+"/threads/"+url.PathEscape(threadID),
		nil,
	)
	if err != nil {
		return err
	}
	req.Header.Set("X-User-ID", userID.String())

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		return nil
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return fmt.Errorf(
		"langgraph delete thread %s failed with status %d: %s",
		threadID,
		resp.StatusCode,
		strings.TrimSpace(string(body)),
	)
}

func (h *ThreadsHandler) deleteThreadDirBestEffort(threadID string) {
	if h.fs == nil {
		return
	}
	if err := h.fs.DeleteThreadDir(threadID); err != nil {
		log.Printf("threads: failed to delete thread directory for %s: %v", threadID, err)
	}
}
