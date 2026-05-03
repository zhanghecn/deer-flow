package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
)

const (
	newAPIProviderOpenAI    = "openai"
	newAPIProviderAnthropic = "anthropic"
	newAPIProviderDeepSeek  = "deepseek"

	newAPIChannelTypeAnthropic = 14
	newAPIModelsResponseLimit  = 4 << 20

	// New API-compatible providers rarely expose LangChain model profiles, but
	// deepagents needs an explicit context limit for fraction-based compaction.
	newAPIImportedModelMaxInputTokens = 200000
)

var adminModelNewAPIHTTPClient = &http.Client{
	Timeout: 20 * time.Second,
}

type adminNewAPIModelScanRequest struct {
	BaseURL string `json:"base_url" binding:"required"`
	APIKey  string `json:"api_key"`
}

type adminNewAPIModelImportRequest struct {
	BaseURL  string                      `json:"base_url" binding:"required"`
	APIKey   string                      `json:"api_key"`
	ModelIDs []string                    `json:"model_ids"`
	Models   []adminNewAPIModelCandidate `json:"models"`
	Enabled  *bool                       `json:"enabled"`
}

type adminNewAPIModelCandidate struct {
	ID            string   `json:"id"`
	Owner         string   `json:"owner,omitempty"`
	Provider      string   `json:"provider"`
	EndpointTypes []string `json:"endpoint_types,omitempty"`
	Created       int64    `json:"created,omitempty"`
}

type adminNewAPIModelImportItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Provider    string `json:"provider"`
	Action      string `json:"action"`
}

type adminNewAPIModelSyncError struct {
	status  int
	message string
}

func (e adminNewAPIModelSyncError) Error() string {
	return e.message
}

type adminNewAPIUpstreamStatusError struct {
	adminNewAPIModelSyncError
}

func (e adminNewAPIUpstreamStatusError) Unwrap() error {
	return e.adminNewAPIModelSyncError
}

func (h *AdminHandler) ScanNewAPIModels(c *gin.Context) {
	var req adminNewAPIModelScanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	apiKey, keyErr := h.resolveNewAPIRequestKey(c.Request.Context(), req.BaseURL, req.APIKey)
	if keyErr != nil {
		handleAdminNewAPIModelSyncError(c, keyErr)
		return
	}

	items, err := scanNewAPIModels(
		c.Request.Context(),
		adminModelNewAPIHTTPClient,
		req.BaseURL,
		apiKey,
	)
	if err != nil {
		handleAdminNewAPIModelSyncError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"count": len(items),
	})
}

func (h *AdminHandler) ImportNewAPIModels(c *gin.Context) {
	var req adminNewAPIModelImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{Error: err.Error()})
		return
	}

	apiKey, keyErr := h.resolveNewAPIRequestKey(c.Request.Context(), req.BaseURL, req.APIKey)
	if keyErr != nil {
		handleAdminNewAPIModelSyncError(c, keyErr)
		return
	}

	candidates, resolveErr := resolveNewAPIImportCandidates(
		c.Request.Context(),
		adminModelNewAPIHTTPClient,
		req.BaseURL,
		apiKey,
		req.Models,
		req.ModelIDs,
	)
	if resolveErr != nil {
		handleAdminNewAPIModelSyncError(c, resolveErr)
		return
	}
	if len(candidates) == 0 {
		handleAdminNewAPIModelSyncError(c, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API returned no models to import",
		})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	items, err := h.importNewAPIModels(
		c.Request.Context(),
		req.BaseURL,
		apiKey,
		candidates,
		enabled,
	)
	if err != nil {
		handleAdminNewAPIModelSyncError(c, err)
		return
	}

	created := 0
	updated := 0
	providerCounts := map[string]int{}
	for _, item := range items {
		providerCounts[item.Provider]++
		if item.Action == "created" {
			created++
			continue
		}
		if item.Action == "updated" {
			updated++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     items,
		"count":     len(items),
		"created":   created,
		"updated":   updated,
		"providers": providerCounts,
	})
}

func (h *AdminHandler) importNewAPIModels(
	ctx context.Context,
	rawBaseURL string,
	apiKey string,
	candidates []adminNewAPIModelCandidate,
	enabled bool,
) ([]adminNewAPIModelImportItem, error) {
	items := make([]adminNewAPIModelImportItem, 0, len(candidates))
	for _, candidate := range candidates {
		provider := candidate.Provider
		if provider == "" {
			provider = inferNewAPIImportProvider(candidate.ID, candidate.Owner, candidate.EndpointTypes)
		}
		record, err := buildNewAPIImportedModelRecord(
			provider,
			candidate.ID,
			rawBaseURL,
			apiKey,
			enabled,
		)
		if err != nil {
			return nil, err
		}

		current, err := h.findExistingNewAPIModelRecord(ctx, rawBaseURL, candidate.ID, record.Name)
		if err != nil {
			return nil, adminNewAPIModelSyncError{
				status:  http.StatusInternalServerError,
				message: "failed to inspect existing model rows",
			}
		}

		action := "created"
		if current == nil {
			if err := h.modelRepo.Create(ctx, &record); err != nil {
				return nil, mapNewAPIModelWriteError(err, "failed to import model")
			}
		} else {
			if err := h.modelRepo.UpdateByName(ctx, current.Name, &record); err != nil {
				return nil, mapNewAPIModelWriteError(err, "failed to update imported model")
			}
			action = "updated"
		}
		if err := h.cleanupLegacyNewAPIModelRows(ctx, rawBaseURL, candidate.ID, record.Name); err != nil {
			return nil, adminNewAPIModelSyncError{
				status:  http.StatusInternalServerError,
				message: "failed to clean up legacy New API model rows",
			}
		}

		displayName := candidate.ID
		if record.DisplayName != nil {
			displayName = *record.DisplayName
		}
		items = append(items, adminNewAPIModelImportItem{
			ID:          candidate.ID,
			Name:        record.Name,
			DisplayName: displayName,
			Provider:    record.Provider,
			Action:      action,
		})
	}
	return items, nil
}

func (h *AdminHandler) resolveNewAPIRequestKey(
	ctx context.Context,
	rawBaseURL string,
	submittedKey string,
) (string, error) {
	normalizedKey := strings.TrimSpace(submittedKey)
	if normalizedKey != "" {
		return normalizedKey, nil
	}

	rows, err := h.modelRepo.ListAll(ctx)
	if err != nil {
		return "", adminNewAPIModelSyncError{
			status:  http.StatusInternalServerError,
			message: "failed to inspect existing New API model rows",
		}
	}

	storedKey, err := findStoredNewAPIKey(rawBaseURL, rows)
	if err != nil {
		return "", err
	}
	if storedKey == "" {
		return "", adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API key is required for the first sync of this URL",
		}
	}
	return storedKey, nil
}

func (h *AdminHandler) findExistingNewAPIModelRecord(
	ctx context.Context,
	rawBaseURL string,
	modelID string,
	generatedName string,
) (*repository.ModelRecord, error) {
	current, err := h.modelRepo.FindByName(ctx, generatedName)
	if err != nil || current != nil {
		return current, err
	}

	rows, err := h.modelRepo.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if isMatchingGeneratedNewAPIModelRecord(row, rawBaseURL, modelID) {
			rowCopy := row
			return &rowCopy, nil
		}
	}
	return nil, nil
}

func (h *AdminHandler) cleanupLegacyNewAPIModelRows(
	ctx context.Context,
	rawBaseURL string,
	modelID string,
	keepName string,
) error {
	rows, err := h.modelRepo.ListAll(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if strings.EqualFold(strings.TrimSpace(row.Name), strings.TrimSpace(keepName)) {
			continue
		}
		if !isLegacyGeneratedNewAPIModelRecord(row, rawBaseURL, modelID) {
			continue
		}
		if deleteErr := h.modelRepo.DeleteByName(ctx, row.Name); deleteErr != nil && !errors.Is(deleteErr, pgx.ErrNoRows) {
			return deleteErr
		}
	}
	return nil
}

func scanNewAPIModels(
	ctx context.Context,
	client *http.Client,
	rawBaseURL string,
	apiKey string,
) ([]adminNewAPIModelCandidate, error) {
	normalizedKey := strings.TrimSpace(apiKey)
	if normalizedKey == "" {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API key is required",
		}
	}

	modelsURL, err := newAPIModelListURL(rawBaseURL)
	if err != nil {
		return nil, err
	}

	body, err := fetchNewAPIModels(ctx, client, modelsURL, normalizedKey)
	if err != nil {
		return nil, err
	}
	items, err := parseNewAPIModelCandidates(body)
	if err != nil {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadGateway,
			message: err.Error(),
		}
	}
	return items, nil
}

func resolveNewAPIImportCandidates(
	ctx context.Context,
	client *http.Client,
	rawBaseURL string,
	apiKey string,
	submitted []adminNewAPIModelCandidate,
	modelIDs []string,
) ([]adminNewAPIModelCandidate, error) {
	selectedIDs := newAPIModelIDSet(modelIDs)
	candidates, err := normalizeNewAPIModelCandidates(submitted)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		// Import requests that only send selected IDs still need a fresh scan:
		// `/v1/models` carries New API's preferred endpoint type, which is the
		// only user-token-visible signal for Anthropic-compatible channels.
		scanned, scanErr := scanNewAPIModels(ctx, client, rawBaseURL, apiKey)
		if scanErr != nil {
			return nil, scanErr
		}
		candidates = scanned
	}
	if len(selectedIDs) == 0 {
		return candidates, nil
	}

	filtered := make([]adminNewAPIModelCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if _, ok := selectedIDs[candidate.ID]; ok {
			filtered = append(filtered, candidate)
		}
	}
	return filtered, nil
}

func buildNewAPIImportedModelRecord(
	provider string,
	modelID string,
	rawBaseURL string,
	apiKey string,
	enabled bool,
) (repository.ModelRecord, error) {
	normalizedProvider, err := normalizeNewAPIImportProvider(provider)
	if err != nil {
		return repository.ModelRecord{}, err
	}
	normalizedKey := strings.TrimSpace(apiKey)
	if normalizedKey == "" {
		return repository.ModelRecord{}, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API key is required",
		}
	}
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return repository.ModelRecord{}, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "model id is required",
		}
	}

	runtimeBaseURL, err := newAPIRuntimeBaseURL(rawBaseURL, normalizedProvider)
	if err != nil {
		return repository.ModelRecord{}, err
	}

	runtimeClass := newAPIImportProviderRuntime(normalizedProvider)
	displayName := modelID
	configJSON := map[string]interface{}{
		"use":              runtimeClass,
		"model":            modelID,
		"api_key":          normalizedKey,
		"base_url":         runtimeBaseURL,
		"max_input_tokens": newAPIImportedModelMaxInputTokens,
		"supports_vision":  true,
	}
	if normalizedProvider == newAPIProviderDeepSeek {
		// ChatDeepSeek names its OpenAI-compatible endpoint setting `api_base`,
		// while the admin import machinery keeps `base_url` for matching and
		// stored-key reuse across providers.
		configJSON["api_base"] = runtimeBaseURL
	}
	if reasoning := newAPIImportedReasoningConfig(normalizedProvider, modelID); reasoning != nil {
		configJSON["reasoning"] = reasoning
	}
	// Provider SDKs do not agree on whether `base_url` includes `/v1`, so the
	// URL is normalized before this canonical model record is built. The
	// persisted row must stay SDK-ready because Python consumes it directly.
	return buildAdminModelRecord(adminModelRequest{
		Name:        buildNewAPIImportedModelName(normalizedProvider, modelID),
		DisplayName: &displayName,
		Provider:    normalizedProvider,
		Enabled:     &enabled,
		ConfigJSON:  configJSON,
	})
}

func fetchNewAPIModels(
	ctx context.Context,
	client *http.Client,
	modelsURL string,
	apiKey string,
) ([]byte, error) {
	if client == nil {
		client = adminModelNewAPIHTTPClient
	}

	// Browser-visible host-loopback addresses should be translated before the
	// first network attempt; some WSL/Docker gateway IPs blackhole from sibling
	// containers and otherwise burn the full HTTP timeout before retrying.
	if aliasURL, ok := dockerHostAliasURL(modelsURL); ok {
		aliasBody, aliasErr := requestNewAPIModels(ctx, client, aliasURL, apiKey)
		if aliasErr == nil {
			return aliasBody, nil
		}
		var upstreamStatus adminNewAPIUpstreamStatusError
		if errors.As(aliasErr, &upstreamStatus) {
			return nil, aliasErr
		}
	}

	body, err := requestNewAPIModels(ctx, client, modelsURL, apiKey)
	if err == nil {
		return body, nil
	}

	var upstreamStatus adminNewAPIUpstreamStatusError
	if errors.As(err, &upstreamStatus) {
		return nil, err
	}

	// Keep the old retry path for tests and unusual aliases where the initial
	// host-alias attempt failed for a transient network reason.
	aliasURL, ok := dockerHostAliasURL(modelsURL)
	if !ok {
		return nil, err
	}
	aliasBody, aliasErr := requestNewAPIModels(ctx, client, aliasURL, apiKey)
	if aliasErr != nil {
		return nil, err
	}
	return aliasBody, nil
}

func requestNewAPIModels(
	ctx context.Context,
	client *http.Client,
	modelsURL string,
	apiKey string,
) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL, nil)
	if err != nil {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API URL is invalid",
		}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadGateway,
			message: "failed to reach New API models endpoint",
		}
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(io.LimitReader(resp.Body, newAPIModelsResponseLimit))
	if readErr != nil {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadGateway,
			message: "failed to read New API models response",
		}
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message := extractNewAPIErrorMessage(body, resp.Status)
		return nil, adminNewAPIUpstreamStatusError{adminNewAPIModelSyncError{
			status:  http.StatusBadGateway,
			message: message,
		}}
	}

	return body, nil
}

func parseNewAPIModelCandidates(body []byte) ([]adminNewAPIModelCandidate, error) {
	var envelope struct {
		Data   json.RawMessage   `json:"data"`
		Models []json.RawMessage `json:"models"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		var rawList []json.RawMessage
		if listErr := json.Unmarshal(body, &rawList); listErr != nil {
			return nil, fmt.Errorf("New API models response must be JSON")
		}
		return parseNewAPIModelCandidateList(rawList)
	}

	if len(envelope.Data) > 0 {
		var rawList []json.RawMessage
		if err := json.Unmarshal(envelope.Data, &rawList); err == nil {
			return parseNewAPIModelCandidateList(rawList)
		}

		var dataObject struct {
			Items []json.RawMessage `json:"items"`
		}
		if err := json.Unmarshal(envelope.Data, &dataObject); err == nil && len(dataObject.Items) > 0 {
			return parseNewAPIModelCandidateList(dataObject.Items)
		}
	}
	return parseNewAPIModelCandidateList(envelope.Models)
}

func parseNewAPIModelCandidateList(rawList []json.RawMessage) ([]adminNewAPIModelCandidate, error) {
	seen := map[string]struct{}{}
	items := make([]adminNewAPIModelCandidate, 0, len(rawList))
	for _, raw := range rawList {
		item, ok, err := parseNewAPIModelCandidate(raw)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		if _, exists := seen[item.ID]; exists {
			continue
		}
		seen[item.ID] = struct{}{}
		items = append(items, item)
	}
	if items == nil {
		return []adminNewAPIModelCandidate{}, nil
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].ID < items[j].ID
	})
	return items, nil
}

func parseNewAPIModelCandidate(raw json.RawMessage) (adminNewAPIModelCandidate, bool, error) {
	var id string
	if err := json.Unmarshal(raw, &id); err == nil {
		id = strings.TrimSpace(id)
		if id == "" {
			return adminNewAPIModelCandidate{}, false, nil
		}
		return adminNewAPIModelCandidate{
			ID:       id,
			Provider: inferNewAPIImportProvider(id, "", nil),
		}, true, nil
	}

	var row struct {
		ID                     string   `json:"id"`
		ModelName              string   `json:"model_name"`
		OwnedBy                string   `json:"owned_by"`
		Owner                  string   `json:"owner"`
		SupportedEndpointTypes []string `json:"supported_endpoint_types"`
		EndpointTypes          []string `json:"endpoint_types"`
		Endpoints              any      `json:"endpoints"`
		BoundChannels          []struct {
			Type int `json:"type"`
		} `json:"bound_channels"`
		Created int64 `json:"created"`
	}
	if err := json.Unmarshal(raw, &row); err != nil {
		return adminNewAPIModelCandidate{}, false, fmt.Errorf("New API model entries must be objects or strings")
	}
	id = strings.TrimSpace(row.ID)
	if id == "" {
		id = strings.TrimSpace(row.ModelName)
	}
	if id == "" {
		return adminNewAPIModelCandidate{}, false, nil
	}
	owner := strings.TrimSpace(row.OwnedBy)
	if owner == "" {
		owner = strings.TrimSpace(row.Owner)
	}
	endpointTypes := normalizeNewAPIEndpointTypes(row.SupportedEndpointTypes)
	if len(endpointTypes) == 0 {
		endpointTypes = normalizeNewAPIEndpointTypes(row.EndpointTypes)
	}
	if len(endpointTypes) == 0 {
		endpointTypes = parseNewAPIEndpointTypes(row.Endpoints)
	}
	if len(endpointTypes) == 0 && hasNewAPIAnthropicChannel(row.BoundChannels) {
		endpointTypes = []string{newAPIProviderAnthropic, newAPIProviderOpenAI}
	}
	return adminNewAPIModelCandidate{
		ID:            id,
		Owner:         owner,
		Provider:      inferNewAPIImportProvider(id, owner, endpointTypes),
		EndpointTypes: endpointTypes,
		Created:       row.Created,
	}, true, nil
}

func extractNewAPIErrorMessage(body []byte, fallback string) string {
	var payload struct {
		Error   interface{} `json:"error"`
		Msg     string      `json:"msg"`
		Message string      `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "New API rejected the model scan: " + fallback
	}
	switch typed := payload.Error.(type) {
	case map[string]interface{}:
		if message, ok := typed["message"].(string); ok && strings.TrimSpace(message) != "" {
			return strings.TrimSpace(message)
		}
	case string:
		if strings.TrimSpace(typed) != "" {
			return strings.TrimSpace(typed)
		}
	}
	if strings.TrimSpace(payload.Message) != "" {
		return strings.TrimSpace(payload.Message)
	}
	if strings.TrimSpace(payload.Msg) != "" {
		return strings.TrimSpace(payload.Msg)
	}
	return "New API rejected the model scan: " + fallback
}

func newAPIModelListURL(rawBaseURL string) (string, error) {
	base, err := parseNewAPIBaseURL(rawBaseURL)
	if err != nil {
		return "", err
	}
	openAIBase := cloneURL(base)
	openAIBase.Path = ensureURLPathSuffix(openAIBase.Path, "/v1")
	return appendURLPath(openAIBase, "models"), nil
}

func newAPIRuntimeBaseURL(rawBaseURL string, provider string) (string, error) {
	return newAPIRuntimeBaseURLWithHostAlias(rawBaseURL, provider, true)
}

func newAPIRuntimeBaseURLWithoutHostAlias(rawBaseURL string, provider string) (string, error) {
	return newAPIRuntimeBaseURLWithHostAlias(rawBaseURL, provider, false)
}

func newAPIRuntimeBaseURLWithHostAlias(rawBaseURL string, provider string, useHostAlias bool) (string, error) {
	base, err := parseNewAPIBaseURL(rawBaseURL)
	if err != nil {
		return "", err
	}
	switch provider {
	case newAPIProviderOpenAI, newAPIProviderDeepSeek:
		openAIBase := cloneURL(base)
		openAIBase.Path = ensureURLPathSuffix(openAIBase.Path, "/v1")
		if !useHostAlias {
			return openAIBase.String(), nil
		}
		return newAPIRuntimeReachableURL(openAIBase.String()), nil
	case newAPIProviderAnthropic:
		anthropicBase := cloneURL(base)
		anthropicBase.Path = stripTerminalURLPathSegment(anthropicBase.Path, "v1")
		if !useHostAlias {
			return anthropicBase.String(), nil
		}
		return newAPIRuntimeReachableURL(anthropicBase.String()), nil
	default:
		return "", adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "provider must be openai, anthropic, or deepseek",
		}
	}
}

func parseNewAPIBaseURL(rawBaseURL string) (*url.URL, error) {
	trimmed := strings.TrimSpace(rawBaseURL)
	if trimmed == "" {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API base URL is required",
		}
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API base URL must include http:// or https://",
		}
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API base URL must use http or https",
		}
	}
	if parsed.User != nil {
		return nil, adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "New API base URL must not include credentials",
		}
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed, nil
}

func newAPIRuntimeReachableURL(rawURL string) string {
	// Imported model rows are consumed by gateway/LangGraph containers. A
	// browser-entered localhost URL must therefore be persisted with Docker's
	// host alias; otherwise model calls loop back into the runtime container.
	if aliasURL, ok := dockerHostAliasURL(rawURL); ok {
		return aliasURL
	}
	return rawURL
}

func newAPIComparableRuntimeBaseURLs(rawBaseURL string, provider string) []string {
	urls := []string{}
	currentURL, currentErr := newAPIRuntimeBaseURL(rawBaseURL, provider)
	if currentErr == nil {
		urls = append(urls, currentURL)
	}
	unaliasedURL, unaliasedErr := newAPIRuntimeBaseURLWithoutHostAlias(rawBaseURL, provider)
	if unaliasedErr == nil && unaliasedURL != currentURL {
		// This is a migration-only comparison so a re-sync can find and update
		// rows imported before localhost was rewritten for Docker runtimes.
		urls = append(urls, unaliasedURL)
	}
	return urls
}

func findStoredNewAPIKey(rawBaseURL string, rows []repository.ModelRecord) (string, error) {
	comparableBaseURLs, err := newAPIComparableRuntimeBaseURLSet(rawBaseURL)
	if err != nil {
		return "", err
	}

	for _, row := range rows {
		var config map[string]any
		if err := json.Unmarshal(row.ConfigJSON, &config); err != nil {
			continue
		}
		baseURL := normalizeComparableNewAPIURL(getConfigString(config, "base_url"))
		if _, ok := comparableBaseURLs[baseURL]; !ok {
			continue
		}
		apiKey := strings.TrimSpace(getConfigString(config, "api_key"))
		if apiKey != "" {
			return apiKey, nil
		}
	}
	return "", nil
}

func newAPIComparableRuntimeBaseURLSet(rawBaseURL string) (map[string]struct{}, error) {
	if _, err := parseNewAPIBaseURL(rawBaseURL); err != nil {
		return nil, err
	}

	result := map[string]struct{}{}
	for _, provider := range []string{newAPIProviderOpenAI, newAPIProviderAnthropic, newAPIProviderDeepSeek} {
		for _, baseURL := range newAPIComparableRuntimeBaseURLs(rawBaseURL, provider) {
			result[normalizeComparableNewAPIURL(baseURL)] = struct{}{}
		}
	}
	return result, nil
}

func normalizeComparableNewAPIURL(rawURL string) string {
	return strings.TrimRight(strings.TrimSpace(rawURL), "/")
}

func normalizeNewAPIImportProvider(raw string) (string, error) {
	normalized := normalizeProviderLookupKey(raw)
	switch normalized {
	case "openai", "openai-compatible":
		return newAPIProviderOpenAI, nil
	case "anthropic", "anthorpic", "anthropic-compatible":
		return newAPIProviderAnthropic, nil
	case "deepseek", "deepseek-compatible":
		return newAPIProviderDeepSeek, nil
	default:
		return "", adminNewAPIModelSyncError{
			status:  http.StatusBadRequest,
			message: "provider must be openai, anthropic, or deepseek",
		}
	}
}

func newAPIImportProviderRuntime(provider string) string {
	if provider == newAPIProviderAnthropic {
		return "langchain_anthropic:ChatAnthropic"
	}
	if provider == newAPIProviderDeepSeek {
		return "langchain_deepseek:ChatDeepSeek"
	}
	return "langchain_openai:ChatOpenAI"
}

func newAPIImportedReasoningConfig(provider string, modelID string) map[string]interface{} {
	switch provider {
	case newAPIProviderAnthropic:
		return map[string]interface{}{
			"contract":      model.ReasoningContractAnthropic,
			"default_level": "max",
		}
	case newAPIProviderDeepSeek:
		if !isNewAPIDeepSeekReasoningModel(modelID) {
			return nil
		}
		// DeepSeek reasoning is selected by the model variant itself; sending a
		// generic max-effort payload would use the wrong provider contract.
		return map[string]interface{}{
			"contract":      model.ReasoningContractDeepSeek,
			"default_level": "auto",
		}
	default:
		return map[string]interface{}{
			"contract":      model.ReasoningContractOpenAIResponses,
			"default_level": "max",
		}
	}
}

func buildNewAPIImportedModelName(provider string, modelID string) string {
	trimmedModelID := strings.TrimSpace(modelID)
	if provider == newAPIProviderAnthropic || provider == newAPIProviderDeepSeek {
		// Anthropic and DeepSeek New API models are already provider-distinct in
		// their model ids. Persisting the raw id keeps the user-facing selector
		// aligned with the New API console instead of showing an added prefix.
		return trimmedModelID
	}
	return buildGeneratedModelName(provider, trimmedModelID)
}

func normalizeNewAPIModelCandidates(candidates []adminNewAPIModelCandidate) ([]adminNewAPIModelCandidate, error) {
	seen := map[string]struct{}{}
	result := make([]adminNewAPIModelCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		id := strings.TrimSpace(candidate.ID)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}

		endpointTypes := normalizeNewAPIEndpointTypes(candidate.EndpointTypes)
		provider := strings.TrimSpace(candidate.Provider)
		if provider == "" {
			provider = inferNewAPIImportProvider(id, candidate.Owner, endpointTypes)
		} else if normalized, err := normalizeNewAPIImportProvider(provider); err == nil {
			provider = normalized
		} else {
			return nil, err
		}
		result = append(result, adminNewAPIModelCandidate{
			ID:            id,
			Owner:         strings.TrimSpace(candidate.Owner),
			Provider:      provider,
			EndpointTypes: endpointTypes,
			Created:       candidate.Created,
		})
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].ID < result[j].ID
	})
	return result, nil
}

func normalizeNewAPIModelIDs(modelIDs []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(modelIDs))
	for _, modelID := range modelIDs {
		normalized := strings.TrimSpace(modelID)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	sort.Strings(result)
	return result
}

func newAPIModelIDSet(modelIDs []string) map[string]struct{} {
	normalized := normalizeNewAPIModelIDs(modelIDs)
	result := make(map[string]struct{}, len(normalized))
	for _, modelID := range normalized {
		result[modelID] = struct{}{}
	}
	return result
}

func normalizeNewAPIEndpointTypes(endpointTypes []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(endpointTypes))
	for _, endpointType := range endpointTypes {
		normalized := strings.ToLower(strings.TrimSpace(endpointType))
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}

func parseNewAPIEndpointTypes(raw any) []string {
	switch typed := raw.(type) {
	case nil:
		return nil
	case []string:
		return normalizeNewAPIEndpointTypes(typed)
	case []any:
		values := make([]string, 0, len(typed))
		for _, value := range typed {
			if text, ok := value.(string); ok {
				values = append(values, text)
			}
		}
		return normalizeNewAPIEndpointTypes(values)
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil
		}
		var values []string
		if err := json.Unmarshal([]byte(trimmed), &values); err == nil {
			return normalizeNewAPIEndpointTypes(values)
		}
		return normalizeNewAPIEndpointTypes(strings.Split(trimmed, ","))
	default:
		return nil
	}
}

func hasNewAPIAnthropicChannel(channels []struct {
	Type int `json:"type"`
}) bool {
	for _, channel := range channels {
		// New API's console payload exposes provider identity as a numeric
		// channel type; type 14 is Anthropic in upstream new-api.
		if channel.Type == newAPIChannelTypeAnthropic {
			return true
		}
	}
	return false
}

func inferNewAPIImportProvider(modelID string, owner string, endpointTypes []string) string {
	lookup := strings.ToLower(strings.TrimSpace(owner) + " " + strings.TrimSpace(modelID))
	if strings.Contains(lookup, "deepseek") {
		// DeepSeek is often exposed through New API's OpenAI-compatible endpoint,
		// but its reasoning messages still require DeepSeek-specific round trips.
		return newAPIProviderDeepSeek
	}

	for _, endpointType := range endpointTypes {
		switch normalizeProviderLookupKey(endpointType) {
		case "anthropic":
			return newAPIProviderAnthropic
		case "openai", "openai-response":
			return newAPIProviderOpenAI
		}
	}

	if strings.Contains(lookup, "anthropic") || strings.Contains(lookup, "claude") {
		return newAPIProviderAnthropic
	}
	// Some New API installations omit endpoint metadata for custom models. In
	// that case the broad OpenAI-compatible surface is the safest fallback.
	return newAPIProviderOpenAI
}

func isNewAPIDeepSeekReasoningModel(modelID string) bool {
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	if normalized == "" || strings.HasSuffix(normalized, "-none") {
		return false
	}
	return strings.Contains(normalized, "reasoner") ||
		strings.HasPrefix(normalized, "deepseek-r1") ||
		strings.HasPrefix(normalized, "deepseek-v4")
}

func isMatchingGeneratedNewAPIModelRecord(row repository.ModelRecord, rawBaseURL string, modelID string) bool {
	trimmedModelID := strings.TrimSpace(modelID)
	expectedNames := map[string]struct{}{
		trimmedModelID:                           {},
		slugifyAdminModelSegment(trimmedModelID): {},
		buildGeneratedModelName(newAPIProviderOpenAI, trimmedModelID):    {},
		buildGeneratedModelName(newAPIProviderAnthropic, trimmedModelID): {},
		buildGeneratedModelName(newAPIProviderDeepSeek, trimmedModelID):  {},
	}
	if !newAPIModelNameMatchesAny(row.Name, expectedNames) {
		return false
	}

	var config map[string]any
	if err := json.Unmarshal(row.ConfigJSON, &config); err != nil {
		return false
	}
	if getConfigString(config, "model") != trimmedModelID {
		return false
	}
	if newAPIModelNameMatchesAny(row.Name, map[string]struct{}{
		trimmedModelID:                           {},
		slugifyAdminModelSegment(trimmedModelID): {},
	}) {
		return true
	}
	baseURL := getConfigString(config, "base_url")
	if baseURL == "" {
		return false
	}
	for _, provider := range []string{newAPIProviderOpenAI, newAPIProviderAnthropic, newAPIProviderDeepSeek} {
		for _, expectedBaseURL := range newAPIComparableRuntimeBaseURLs(rawBaseURL, provider) {
			if baseURL == expectedBaseURL {
				return true
			}
		}
	}
	return false
}

func isLegacyGeneratedNewAPIModelRecord(row repository.ModelRecord, rawBaseURL string, modelID string) bool {
	trimmedModelID := strings.TrimSpace(modelID)
	legacyNames := map[string]struct{}{
		buildGeneratedModelName(newAPIProviderOpenAI, trimmedModelID):    {},
		buildGeneratedModelName(newAPIProviderAnthropic, trimmedModelID): {},
		buildGeneratedModelName(newAPIProviderDeepSeek, trimmedModelID):  {},
	}
	if !newAPIModelNameMatchesAny(row.Name, legacyNames) {
		return false
	}

	var config map[string]any
	if err := json.Unmarshal(row.ConfigJSON, &config); err != nil {
		return false
	}
	if getConfigString(config, "model") != trimmedModelID {
		return false
	}

	baseURL := getConfigString(config, "base_url")
	if baseURL == "" {
		return false
	}
	for _, provider := range []string{newAPIProviderOpenAI, newAPIProviderAnthropic, newAPIProviderDeepSeek} {
		for _, expectedBaseURL := range newAPIComparableRuntimeBaseURLs(rawBaseURL, provider) {
			if baseURL == expectedBaseURL {
				return true
			}
		}
	}
	return false
}

func newAPIModelNameMatchesAny(name string, candidates map[string]struct{}) bool {
	for candidate := range candidates {
		if strings.EqualFold(strings.TrimSpace(name), strings.TrimSpace(candidate)) {
			return true
		}
	}
	return false
}

func cloneURL(value *url.URL) *url.URL {
	clone := *value
	return &clone
}

func ensureURLPathSuffix(path string, suffix string) string {
	trimmed := strings.TrimRight(path, "/")
	if trimmed == "" {
		return suffix
	}
	if strings.HasSuffix(trimmed, suffix) {
		return trimmed
	}
	return trimmed + suffix
}

func stripTerminalURLPathSegment(path string, segment string) string {
	trimmed := strings.TrimRight(path, "/")
	if trimmed == "" {
		return ""
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) > 0 && parts[len(parts)-1] == segment {
		return strings.Join(parts[:len(parts)-1], "/")
	}
	return trimmed
}

func appendURLPath(value *url.URL, segment string) string {
	clone := cloneURL(value)
	clone.Path = strings.TrimRight(clone.Path, "/") + "/" + strings.TrimLeft(segment, "/")
	return clone.String()
}

func dockerHostAliasURL(rawURL string) (string, bool) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", false
	}
	host := strings.ToLower(parsed.Hostname())
	if !isDockerHostAliasHost(host) {
		return "", false
	}
	port := parsed.Port()
	parsed.Host = "host.docker.internal"
	if port != "" {
		parsed.Host = parsed.Host + ":" + port
	}
	return parsed.String(), true
}

func isDockerHostAliasHost(host string) bool {
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return true
	}

	addr, err := netip.ParseAddr(host)
	if err != nil || !addr.Is4() {
		return false
	}
	octets := addr.As4()
	// Docker Desktop and WSL often expose the host to the browser as a 172.16/12
	// gateway address ending in .1, while sibling containers reach that same host
	// through Docker's stable `host.docker.internal` alias.
	return octets[0] == 172 &&
		octets[1] >= 16 &&
		octets[1] <= 31 &&
		octets[3] == 1
}

func mapNewAPIModelWriteError(err error, fallback string) error {
	if err == nil {
		return nil
	}
	return adminNewAPIModelSyncError{
		status:  http.StatusInternalServerError,
		message: fallback,
	}
}

func handleAdminNewAPIModelSyncError(c *gin.Context, err error) {
	var syncErr adminNewAPIModelSyncError
	if errors.As(err, &syncErr) {
		c.JSON(syncErr.status, model.ErrorResponse{Error: syncErr.message})
		return
	}
	c.JSON(http.StatusInternalServerError, model.ErrorResponse{Error: "failed to sync New API models"})
}
