package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

type agentFinder interface {
	FindByName(ctx context.Context, name string) (*model.Agent, error)
}

type modelFinder interface {
	FindEnabledByName(ctx context.Context, name string) (*repository.ModelRecord, error)
}

type LangGraphRuntimeHandler struct {
	agentRepo          agentFinder
	modelRepo          modelFinder
	modelRequiredPaths []string
	modelOptionalPaths []string
}

func NewLangGraphRuntimeHandlerWithPatterns(
	agentRepo agentFinder,
	modelRepo modelFinder,
	requiredPaths []string,
	optionalPaths []string,
) (*LangGraphRuntimeHandler, error) {
	required := sanitizePatterns(requiredPaths)
	optional := sanitizePatterns(optionalPaths)
	if len(required) == 0 {
		return nil, fmt.Errorf("langgraph_runtime.model_required_paths must not be empty")
	}
	if err := validatePathPatterns(required); err != nil {
		return nil, fmt.Errorf("invalid langgraph_runtime.model_required_paths: %w", err)
	}
	if err := validatePathPatterns(optional); err != nil {
		return nil, fmt.Errorf("invalid langgraph_runtime.model_optional_paths: %w", err)
	}

	return &LangGraphRuntimeHandler{
		agentRepo:          agentRepo,
		modelRepo:          modelRepo,
		modelRequiredPaths: required,
		modelOptionalPaths: optional,
	}, nil
}

func (h *LangGraphRuntimeHandler) InjectRuntimeConfig() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body == nil || !isJSONRequest(c.Request.Method, c.ContentType()) {
			c.Next()
			return
		}

		originalBody, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, model.ErrorResponse{Error: "failed to read request body"})
			return
		}
		_ = c.Request.Body.Close()

		if len(bytes.TrimSpace(originalBody)) == 0 {
			restoreRequestBody(c, originalBody)
			c.Next()
			return
		}

		payload := map[string]interface{}{}
		if err := json.Unmarshal(originalBody, &payload); err != nil {
			restoreRequestBody(c, originalBody)
			c.Next()
			return
		}

		userID := middleware.GetUserID(c)
		if err := h.scopeThreadRequest(payload, c.Request.URL.Path, userID); err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
			return
		}

		configurable, found := extractConfigurable(payload)
		mode := h.modelResolutionMode(c.Request.URL.Path)
		if !found {
			configurable = map[string]interface{}{}
		}

		if err := h.resolveAndInjectModel(c.Request.Context(), configurable, userID, mode); err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
			return
		}

		setConfigurable(payload, configurable)
		modifiedBody, err := json.Marshal(payload)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to encode request body"})
			return
		}
		restoreRequestBody(c, modifiedBody)
		c.Next()
	}
}

func (h *LangGraphRuntimeHandler) resolveAndInjectModel(
	ctx context.Context,
	configurable map[string]interface{},
	userID uuid.UUID,
	mode modelResolutionPolicy,
) error {
	if userID != uuid.Nil {
		configurable["user_id"] = userID.String()
	}
	if mode == modelResolutionNone {
		return nil
	}

	requestedModelName := firstString(configurable, "model_name", "model")
	agentName := firstString(configurable, "agent_name")

	runtimeModelName, err := parseRuntimeModelName(configurable)
	if err != nil {
		return err
	}
	if requestedModelName != "" && runtimeModelName != "" && requestedModelName != runtimeModelName {
		return fmt.Errorf("model conflict: `configurable.model_name` and `configurable.model_config.name` must match")
	}

	var agentModelName string
	if agentName != "" {
		agent, err := h.agentRepo.FindByName(ctx, agentName)
		if err != nil {
			return fmt.Errorf("failed to load agent %q: %w", agentName, err)
		}
		if agent == nil {
			return fmt.Errorf("agent %q not found", agentName)
		}
		if agent.Model != nil {
			agentModelName = strings.TrimSpace(*agent.Model)
		}
	}

	modelName := firstNonEmpty(runtimeModelName, requestedModelName, agentModelName)
	if modelName == "" {
		if mode == modelResolutionOptional {
			return nil
		}
		return fmt.Errorf(
			"No model resolved for this run. Provide `configurable.model_name`/`model`, " +
				"`configurable.model_config.name`, or set `agent.model`",
		)
	}
	if agentModelName != "" && modelName != agentModelName {
		return fmt.Errorf("model conflict: requested model %q does not match agent model %q", modelName, agentModelName)
	}

	row, err := h.modelRepo.FindEnabledByName(ctx, modelName)
	if err != nil {
		return fmt.Errorf("failed to load model %q: %w", modelName, err)
	}
	if row == nil {
		return fmt.Errorf("resolved model %q not found or disabled", modelName)
	}

	modelConfig := map[string]interface{}{}
	if len(row.ConfigJSON) > 0 {
		if err := json.Unmarshal(row.ConfigJSON, &modelConfig); err != nil {
			return fmt.Errorf("invalid model config_json for %q: %w", row.Name, err)
		}
	}
	modelConfig["name"] = row.Name
	if row.DisplayName != nil && strings.TrimSpace(*row.DisplayName) != "" {
		modelConfig["display_name"] = *row.DisplayName
	}

	configurable["model_name"] = row.Name
	configurable["model"] = row.Name
	configurable["model_config"] = modelConfig
	return nil
}

func parseRuntimeModelName(configurable map[string]interface{}) (string, error) {
	runtimePayload, ok := configurable["model_config"]
	if !ok || runtimePayload == nil {
		return "", nil
	}
	runtimeConfig, ok := runtimePayload.(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("`configurable.model_config` must be an object")
	}
	return firstString(runtimeConfig, "name"), nil
}

func extractConfigurable(payload map[string]interface{}) (map[string]interface{}, bool) {
	top, topOK := asMap(payload["configurable"])

	var nested map[string]interface{}
	nestedOK := false
	if config, ok := asMap(payload["config"]); ok {
		nested, nestedOK = asMap(config["configurable"])
	}

	switch {
	case topOK && nestedOK:
		merged := cloneMap(top)
		for key, value := range nested {
			merged[key] = value
		}
		return merged, true
	case nestedOK:
		return cloneMap(nested), true
	case topOK:
		return cloneMap(top), true
	default:
		return nil, false
	}
}

func setConfigurable(payload map[string]interface{}, configurable map[string]interface{}) {
	payload["configurable"] = configurable

	config, ok := asMap(payload["config"])
	if !ok {
		config = map[string]interface{}{}
	}
	config["configurable"] = configurable
	payload["config"] = config
}

func asMap(v interface{}) (map[string]interface{}, bool) {
	m, ok := v.(map[string]interface{})
	return m, ok
}

func firstString(data map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		value, ok := data[key]
		if !ok || value == nil {
			continue
		}
		asString, ok := value.(string)
		if !ok {
			continue
		}
		asString = strings.TrimSpace(asString)
		if asString != "" {
			return asString
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func cloneMap(src map[string]interface{}) map[string]interface{} {
	dst := make(map[string]interface{}, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func restoreRequestBody(c *gin.Context, body []byte) {
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	c.Request.ContentLength = int64(len(body))
}

func isJSONRequest(method, contentType string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
	default:
		return false
	}
	return contentType == "application/json"
}

type modelResolutionPolicy int

const (
	modelResolutionNone modelResolutionPolicy = iota
	modelResolutionOptional
	modelResolutionRequired
)

func (h *LangGraphRuntimeHandler) modelResolutionMode(requestPath string) modelResolutionPolicy {
	normalizedPath := normalizeLangGraphPath(requestPath)
	if matchesAnyPattern(normalizedPath, h.modelRequiredPaths) {
		return modelResolutionRequired
	}
	if matchesAnyPattern(normalizedPath, h.modelOptionalPaths) {
		return modelResolutionOptional
	}
	return modelResolutionNone
}

func normalizeLangGraphPath(path string) string {
	trimmed := strings.TrimPrefix(path, "/api/langgraph")
	if trimmed == "" {
		return "/"
	}
	return trimmed
}

func sanitizePatterns(patterns []string) []string {
	cleaned := make([]string, 0, len(patterns))
	for _, p := range patterns {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		cleaned = append(cleaned, p)
	}
	return cleaned
}

func validatePathPatterns(patterns []string) error {
	for _, patternValue := range patterns {
		patternValue = strings.TrimSpace(patternValue)
		if patternValue == "" {
			return fmt.Errorf("pattern must not be empty")
		}
		if _, err := path.Match(patternValue, "/__validate__"); err != nil {
			return fmt.Errorf("%q: %w", patternValue, err)
		}
	}
	return nil
}

func matchesAnyPattern(targetPath string, patterns []string) bool {
	for _, patternValue := range patterns {
		if pathMatches(patternValue, targetPath) {
			return true
		}
	}
	return false
}

func pathMatches(patternValue string, targetPath string) bool {
	if strings.HasSuffix(patternValue, "/*") {
		base := strings.TrimSuffix(patternValue, "/*")
		if targetPath == base {
			return true
		}
	}
	matched, _ := path.Match(patternValue, targetPath)
	return matched
}

var userScopedSearchPaths = []string{
	"/threads/search",
	"/threads/count",
}

var userScopedMetadataPaths = []string{
	"/threads",
	"/threads/*",
	"/threads/*/copy",
	"/threads/*/runs",
	"/threads/*/runs/*",
}

func (h *LangGraphRuntimeHandler) scopeThreadRequest(
	payload map[string]interface{},
	requestPath string,
	userID uuid.UUID,
) error {
	if userID == uuid.Nil {
		return nil
	}
	normalizedPath := normalizeLangGraphPath(requestPath)
	userIDStr := userID.String()

	if matchesAnyPattern(normalizedPath, userScopedSearchPaths) {
		metadata, err := ensureMapField(payload, "metadata")
		if err != nil {
			return err
		}
		if err := setMetadataUserID(metadata, userIDStr); err != nil {
			return err
		}
	}

	if matchesAnyPattern(normalizedPath, userScopedMetadataPaths) {
		metadata, err := ensureMapField(payload, "metadata")
		if err != nil {
			return err
		}
		if err := setMetadataUserID(metadata, userIDStr); err != nil {
			return err
		}
	}

	return nil
}

func ensureMapField(payload map[string]interface{}, field string) (map[string]interface{}, error) {
	raw, exists := payload[field]
	if !exists || raw == nil {
		created := map[string]interface{}{}
		payload[field] = created
		return created, nil
	}
	asMap, ok := raw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("`%s` must be an object", field)
	}
	return asMap, nil
}

func setMetadataUserID(metadata map[string]interface{}, userID string) error {
	if raw, ok := metadata["user_id"]; ok && raw != nil {
		asString, ok := raw.(string)
		if !ok {
			return fmt.Errorf("`metadata.user_id` must be a string")
		}
		asString = strings.TrimSpace(asString)
		if asString != "" && asString != userID {
			return fmt.Errorf("`metadata.user_id` does not match the authenticated user")
		}
	}
	metadata["user_id"] = userID
	return nil
}
