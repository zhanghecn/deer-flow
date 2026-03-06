package handler

import (
	"net/http"
	"os"
	"strings"

	"github.com/deer-flow/gateway/internal/model"
	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

type ModelHandler struct {
	configPath string
}

func NewModelHandler(configPath string) *ModelHandler {
	return &ModelHandler{configPath: configPath}
}

// ModelConfig represents a model entry from config.yaml
type ModelConfig struct {
	Name               string `yaml:"name" json:"name"`
	DisplayName        string `yaml:"display_name" json:"display_name"`
	Model              string `yaml:"model" json:"model"`
	SupportsThinking   bool   `yaml:"supports_thinking" json:"supports_thinking"`
	SupportsVision     bool   `yaml:"supports_vision" json:"supports_vision"`
	SupportsReasoning  bool   `yaml:"supports_reasoning_effort" json:"supports_reasoning_effort"`
}

type configFile struct {
	Models []ModelConfig `yaml:"models"`
}

func (h *ModelHandler) List(c *gin.Context) {
	data, err := os.ReadFile(h.configPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to read config"})
		return
	}

	// Resolve environment variables
	content := os.ExpandEnv(string(data))

	var cfg configFile
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to parse config"})
		return
	}

	// Filter by query
	query := strings.ToLower(c.Query("q"))
	var result []ModelConfig
	for _, m := range cfg.Models {
		if query == "" || strings.Contains(strings.ToLower(m.Name), query) || strings.Contains(strings.ToLower(m.DisplayName), query) {
			result = append(result, m)
		}
	}

	if result == nil {
		result = []ModelConfig{}
	}
	c.JSON(http.StatusOK, result)
}
