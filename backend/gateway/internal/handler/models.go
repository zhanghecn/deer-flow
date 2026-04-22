package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

type ModelHandler struct {
	repo *repository.ModelRepo
}

func NewModelHandler(repo *repository.ModelRepo) *ModelHandler {
	return &ModelHandler{repo: repo}
}

type ModelConfig struct {
	Name              string `json:"name"`
	DisplayName       string `json:"display_name"`
	Model             string `json:"model"`
	SupportsThinking  bool   `json:"supports_thinking"`
	SupportsVision    bool   `json:"supports_vision"`
	SupportsEffort    bool   `json:"supports_effort"`
}

func (h *ModelHandler) List(c *gin.Context) {
	rows, err := h.repo.ListEnabled(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to query models"})
		return
	}

	models := make([]ModelConfig, 0, len(rows))
	for _, row := range rows {
		models = append(models, mapModelRow(row))
	}

	// Filter by query
	query := strings.ToLower(c.Query("q"))
	var result []ModelConfig
	for _, m := range models {
		if query == "" || strings.Contains(strings.ToLower(m.Name), query) || strings.Contains(strings.ToLower(m.DisplayName), query) {
			result = append(result, m)
		}
	}

	if result == nil {
		result = []ModelConfig{}
	}
	c.JSON(http.StatusOK, gin.H{"models": result})
}

func mapModelRow(row repository.ModelRecord) ModelConfig {
	cfgMap := map[string]interface{}{}
	_ = json.Unmarshal(row.ConfigJSON, &cfgMap)

	displayName := row.Name
	if row.DisplayName != nil && strings.TrimSpace(*row.DisplayName) != "" {
		displayName = *row.DisplayName
	}

	modelName, _ := cfgMap["model"].(string)
	if strings.TrimSpace(modelName) == "" {
		modelName = row.Name
	}

	return ModelConfig{
		Name:              row.Name,
		DisplayName:       displayName,
		Model:             modelName,
		SupportsThinking:  toBool(cfgMap["supports_thinking"]),
		SupportsVision:    toBool(cfgMap["supports_vision"]),
		SupportsEffort:    toBool(cfgMap["supports_effort"]),
	}
}

func toBool(v interface{}) bool {
	b, ok := v.(bool)
	return ok && b
}
