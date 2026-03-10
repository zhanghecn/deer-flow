package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

type adminModelRequest struct {
	Name        string                 `json:"name" binding:"required"`
	DisplayName *string                `json:"display_name"`
	Provider    string                 `json:"provider" binding:"required"`
	Enabled     *bool                  `json:"enabled"`
	ConfigJSON  map[string]interface{} `json:"config_json" binding:"required"`
}

type adminModelResponse struct {
	Name        string          `json:"name"`
	DisplayName *string         `json:"display_name,omitempty"`
	Provider    string          `json:"provider"`
	Enabled     bool            `json:"enabled"`
	ConfigJSON  json.RawMessage `json:"config_json"`
	CreatedAt   string          `json:"created_at"`
}

func (h *AdminHandler) ListModels(c *gin.Context) {
	rows, err := h.modelRepo.ListAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to list models"})
		return
	}
	if rows == nil {
		rows = []repository.ModelRecord{}
	}

	items := make([]adminModelResponse, 0, len(rows))
	for _, row := range rows {
		items = append(items, toAdminModelResponse(row))
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *AdminHandler) CreateModel(c *gin.Context) {
	record, ok := parseAdminModelRequest(c)
	if !ok {
		return
	}

	if err := h.modelRepo.Create(c.Request.Context(), &record); err != nil {
		handleAdminModelWriteError(c, err, "failed to create model")
		return
	}

	c.JSON(http.StatusCreated, toAdminModelResponse(record))
}

func (h *AdminHandler) UpdateModel(c *gin.Context) {
	currentName := strings.TrimSpace(c.Param("name"))
	if currentName == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "model name is required"})
		return
	}

	record, ok := parseAdminModelRequest(c)
	if !ok {
		return
	}

	if err := h.modelRepo.UpdateByName(c.Request.Context(), currentName, &record); err != nil {
		handleAdminModelWriteError(c, err, "failed to update model")
		return
	}

	c.JSON(http.StatusOK, toAdminModelResponse(record))
}

func (h *AdminHandler) DeleteModel(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: "model name is required"})
		return
	}

	if err := h.modelRepo.DeleteByName(c.Request.Context(), name); err != nil {
		handleAdminModelWriteError(c, err, "failed to delete model")
		return
	}

	c.JSON(http.StatusOK, model.SuccessResponse{Message: "model deleted"})
}

func parseAdminModelRequest(c *gin.Context) (repository.ModelRecord, bool) {
	var req adminModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return repository.ModelRecord{}, false
	}

	record, err := buildAdminModelRecord(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return repository.ModelRecord{}, false
	}
	return record, true
}

func buildAdminModelRecord(req adminModelRequest) (repository.ModelRecord, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return repository.ModelRecord{}, errors.New("name is required")
	}

	provider := strings.TrimSpace(req.Provider)
	if provider == "" {
		return repository.ModelRecord{}, errors.New("provider is required")
	}

	if len(req.ConfigJSON) == 0 {
		return repository.ModelRecord{}, errors.New("config_json must be a non-empty object")
	}

	if !hasNonEmptyString(req.ConfigJSON["use"]) {
		return repository.ModelRecord{}, errors.New("config_json.use is required")
	}
	if !hasNonEmptyString(req.ConfigJSON["model"]) {
		return repository.ModelRecord{}, errors.New("config_json.model is required")
	}

	configJSON, err := json.Marshal(req.ConfigJSON)
	if err != nil {
		return repository.ModelRecord{}, errors.New("config_json must be valid JSON")
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	return repository.ModelRecord{
		Name:        name,
		DisplayName: normalizeOptionalString(req.DisplayName),
		Provider:    provider,
		ConfigJSON:  configJSON,
		Enabled:     enabled,
	}, nil
}

func toAdminModelResponse(row repository.ModelRecord) adminModelResponse {
	return adminModelResponse{
		Name:        row.Name,
		DisplayName: normalizeOptionalString(row.DisplayName),
		Provider:    row.Provider,
		Enabled:     row.Enabled,
		ConfigJSON:  row.ConfigJSON,
		CreatedAt:   row.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func normalizeOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	normalized := strings.TrimSpace(*value)
	if normalized == "" {
		return nil
	}
	return &normalized
}

func hasNonEmptyString(value interface{}) bool {
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) != ""
}

func handleAdminModelWriteError(c *gin.Context, err error, fallback string) {
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, model.ErrorResponse{Error: "model not found"})
		return
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		c.JSON(http.StatusConflict, model.ErrorResponse{Error: "model name already exists"})
		return
	}

	c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: fallback})
}
