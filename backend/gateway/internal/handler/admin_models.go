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
	Name        string                 `json:"name"`
	DisplayName *string                `json:"display_name"`
	Provider    string                 `json:"provider"`
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

type knownModelProviderDefaults struct {
	canonicalProvider string
	runtimeClass      string
}

var knownModelProviderMap = map[string]knownModelProviderDefaults{
	"openai":               {canonicalProvider: "openai", runtimeClass: "langchain_openai:ChatOpenAI"},
	"openai-compatible":    {canonicalProvider: "openai", runtimeClass: "langchain_openai:ChatOpenAI"},
	"anthropic":            {canonicalProvider: "anthropic", runtimeClass: "langchain_anthropic:ChatAnthropic"},
	"anthropic-compatible": {canonicalProvider: "anthropic", runtimeClass: "langchain_anthropic:ChatAnthropic"},
	"google":               {canonicalProvider: "google", runtimeClass: "langchain_google_genai:ChatGoogleGenerativeAI"},
	"google-genai":         {canonicalProvider: "google", runtimeClass: "langchain_google_genai:ChatGoogleGenerativeAI"},
	"gemini":               {canonicalProvider: "google", runtimeClass: "langchain_google_genai:ChatGoogleGenerativeAI"},
	"deepseek":             {canonicalProvider: "deepseek", runtimeClass: "langchain_deepseek:ChatDeepSeek"},
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
	if len(req.ConfigJSON) == 0 {
		return repository.ModelRecord{}, errors.New("config_json must be a non-empty object")
	}

	configJSON := normalizeAdminModelConfig(req.ConfigJSON)
	// `effort` is a per-run execution input, not a persisted model profile
	// field. Rejecting it here keeps runtime-only policy out of the provider
	// config that is later materialized into model constructor kwargs.
	if _, exists := configJSON["effort"]; exists {
		return repository.ModelRecord{}, errors.New("config_json.effort is runtime-only; remove it from the model profile")
	}
	if _, exists := configJSON["reasoning_effort"]; exists {
		return repository.ModelRecord{}, errors.New("config_json.reasoning_effort is retired; use per-run `effort` instead")
	}
	if _, exists := configJSON["supports_reasoning_effort"]; exists {
		return repository.ModelRecord{}, errors.New("config_json.supports_reasoning_effort is retired; rename it to `supports_effort`")
	}
	modelName := getConfigString(configJSON, "model")
	if modelName == "" {
		return repository.ModelRecord{}, errors.New("config_json.model is required")
	}

	provider := strings.TrimSpace(req.Provider)
	runtimeClass := getConfigString(configJSON, "use")

	if provider == "" {
		inferredProvider, ok := inferProviderFromRuntimeClass(runtimeClass)
		if !ok {
			return repository.ModelRecord{}, errors.New("provider is required")
		}
		provider = inferredProvider
	}

	if runtimeClass == "" {
		inferredRuntimeClass, ok := inferRuntimeClassForProvider(provider)
		if !ok {
			return repository.ModelRecord{}, errors.New("config_json.use is required")
		}
		runtimeClass = inferredRuntimeClass
	}
	configJSON["use"] = runtimeClass

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = buildGeneratedModelName(provider, modelName)
	}
	if name == "" {
		return repository.ModelRecord{}, errors.New("name is required")
	}

	displayName := normalizeOptionalString(req.DisplayName)
	if displayName == nil {
		// Defaulting the display label to the provider-side model id keeps the
		// admin UX lightweight while still producing a readable selector label.
		displayName = normalizeOptionalString(&modelName)
	}

	configJSONBytes, err := json.Marshal(configJSON)
	if err != nil {
		return repository.ModelRecord{}, errors.New("config_json must be valid JSON")
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	return repository.ModelRecord{
		Name:        name,
		DisplayName: displayName,
		Provider:    provider,
		ConfigJSON:  configJSONBytes,
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

func getConfigString(config map[string]interface{}, key string) string {
	text, ok := config[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func normalizeAdminModelConfig(config map[string]interface{}) map[string]interface{} {
	normalized := make(map[string]interface{}, len(config))
	for key, value := range config {
		if text, ok := value.(string); ok {
			normalized[key] = strings.TrimSpace(text)
			continue
		}
		normalized[key] = value
	}
	return normalized
}

func normalizeProviderLookupKey(value string) string {
	replacer := strings.NewReplacer("_", "-", " ", "-")
	return replacer.Replace(strings.ToLower(strings.TrimSpace(value)))
}

func inferRuntimeClassForProvider(provider string) (string, bool) {
	defaults, ok := knownModelProviderMap[normalizeProviderLookupKey(provider)]
	if !ok {
		return "", false
	}
	return defaults.runtimeClass, true
}

func inferProviderFromRuntimeClass(runtimeClass string) (string, bool) {
	trimmedRuntimeClass := strings.TrimSpace(runtimeClass)
	for _, defaults := range knownModelProviderMap {
		if defaults.runtimeClass == trimmedRuntimeClass {
			return defaults.canonicalProvider, true
		}
	}
	return "", false
}

func buildGeneratedModelName(provider string, modelName string) string {
	// Keep generated row ids deterministic so operators can predict and search
	// them later instead of chasing opaque client-generated identifiers.
	segments := []string{slugifyAdminModelSegment(provider), slugifyAdminModelSegment(modelName)}
	filtered := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment != "" {
			filtered = append(filtered, segment)
		}
	}
	return strings.Join(filtered, "-")
}

func slugifyAdminModelSegment(value string) string {
	var builder strings.Builder
	lastWasHyphen := false
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastWasHyphen = false
			continue
		}
		if builder.Len() == 0 || lastWasHyphen {
			continue
		}
		builder.WriteByte('-')
		lastWasHyphen = true
	}
	return strings.Trim(builder.String(), "-")
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
