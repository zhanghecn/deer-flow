package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

type ThreadsHandler struct {
	repo threadSearchRepository
}

type threadSearchRepository interface {
	SearchByUser(
		ctx context.Context,
		userID uuid.UUID,
		opts repository.ThreadSearchOptions,
	) ([]repository.ThreadSearchRecord, error)
}

func NewThreadsHandler(repo threadSearchRepository) *ThreadsHandler {
	return &ThreadsHandler{repo: repo}
}

type threadSearchRequest struct {
	Limit     int      `json:"limit"`
	Offset    int      `json:"offset"`
	SortBy    string   `json:"sort_by"`
	SortOrder string   `json:"sort_order"`
	Select    []string `json:"select"`
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
