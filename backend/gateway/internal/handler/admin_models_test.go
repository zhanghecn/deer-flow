package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/openagents/gateway/internal/repository"
)

func TestBuildAdminModelRecordNormalizesFields(t *testing.T) {
	t.Parallel()

	displayName := "  Kimi K2.5 #1  "
	record, err := buildAdminModelRecord(adminModelRequest{
		Name:        "  kimi-k2.5-1  ",
		DisplayName: &displayName,
		Provider:    "  anthropic  ",
		Enabled:     boolPtr(false),
		ConfigJSON: map[string]interface{}{
			"use":   "langchain_anthropic:ChatAnthropic",
			"model": "kimi-k2.5",
		},
	})
	if err != nil {
		t.Fatalf("buildAdminModelRecord returned error: %v", err)
	}

	if record.Name != "kimi-k2.5-1" {
		t.Fatalf("expected normalized name, got %q", record.Name)
	}
	if record.Provider != "anthropic" {
		t.Fatalf("expected normalized provider, got %q", record.Provider)
	}
	if record.DisplayName == nil || *record.DisplayName != "Kimi K2.5 #1" {
		t.Fatalf("expected normalized display name, got %#v", record.DisplayName)
	}
	if record.Enabled {
		t.Fatalf("expected disabled record")
	}

	var config map[string]any
	if err := json.Unmarshal(record.ConfigJSON, &config); err != nil {
		t.Fatalf("decode config json: %v", err)
	}
	if config["model"] != "kimi-k2.5" {
		t.Fatalf("expected model field to be preserved, got %#v", config["model"])
	}
}

func TestParseAdminModelListQuery(t *testing.T) {
	t.Parallel()

	query, err := parseAdminModelListQuery(url.Values{
		"page":      {"3"},
		"page_size": {"25"},
		"search":    {"  kimi  "},
	})
	if err != nil {
		t.Fatalf("parseAdminModelListQuery returned error: %v", err)
	}
	if query.Page != 3 || query.PageSize != 25 || query.Offset != 50 {
		t.Fatalf("unexpected pagination: %#v", query)
	}
	if query.Search != "kimi" {
		t.Fatalf("expected trimmed search, got %q", query.Search)
	}
}

func TestParseAdminModelListQueryCapsPageSize(t *testing.T) {
	t.Parallel()

	query, err := parseAdminModelListQuery(url.Values{"page_size": {"500"}})
	if err != nil {
		t.Fatalf("parseAdminModelListQuery returned error: %v", err)
	}
	if query.PageSize != 100 {
		t.Fatalf("expected capped page size, got %d", query.PageSize)
	}
}

func TestParseAdminModelListQueryRejectsInvalidPage(t *testing.T) {
	t.Parallel()

	if _, err := parseAdminModelListQuery(url.Values{"page": {"0"}}); err == nil {
		t.Fatalf("expected invalid page error")
	}
}

func TestBuildAdminModelRecordRejectsMissingConfigFields(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Name:     "kimi-k2.5-1",
		Provider: "anthropic",
		ConfigJSON: map[string]interface{}{
			"use": "langchain_anthropic:ChatAnthropic",
		},
	})
	if err == nil || err.Error() != "config_json.model is required" {
		t.Fatalf("expected missing model error, got %v", err)
	}
}

func TestBuildAdminModelRecordRejectsRuntimeOnlyEffort(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Name:     "gpt-5-mini",
		Provider: "openai",
		ConfigJSON: map[string]interface{}{
			"use":    "langchain_openai:ChatOpenAI",
			"model":  "gpt-5-mini",
			"effort": "high",
		},
	})
	if err == nil || err.Error() != "config_json.effort is runtime-only; remove it from the model profile" {
		t.Fatalf("expected runtime-only effort error, got %v", err)
	}
}

func TestBuildAdminModelRecordRejectsRetiredReasoningEffortKey(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Name:     "gpt-5-mini",
		Provider: "openai",
		ConfigJSON: map[string]interface{}{
			"use":              "langchain_openai:ChatOpenAI",
			"model":            "gpt-5-mini",
			"reasoning_effort": "high",
		},
	})
	if err == nil || err.Error() != "config_json uses retired reasoning keys: reasoning_effort. Use config_json.reasoning instead" {
		t.Fatalf("expected retired reasoning_effort error, got %v", err)
	}
}

func TestBuildAdminModelRecordRejectsRetiredSupportsReasoningEffortKey(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Name:     "gpt-5-mini",
		Provider: "openai",
		ConfigJSON: map[string]interface{}{
			"use":                       "langchain_openai:ChatOpenAI",
			"model":                     "gpt-5-mini",
			"supports_reasoning_effort": true,
		},
	})
	if err == nil || err.Error() != "config_json uses retired reasoning keys: supports_reasoning_effort. Use config_json.reasoning instead" {
		t.Fatalf("expected retired supports_reasoning_effort error, got %v", err)
	}
}

func TestBuildAdminModelRecordAcceptsCanonicalReasoningConfig(t *testing.T) {
	t.Parallel()

	record, err := buildAdminModelRecord(adminModelRequest{
		Name:     "kimi-k2.6",
		Provider: "anthropic",
		ConfigJSON: map[string]interface{}{
			"use":   "langchain_anthropic:ChatAnthropic",
			"model": "kimi-k2.6",
			"reasoning": map[string]interface{}{
				"contract":      "anthropic_thinking",
				"default_level": "max",
			},
		},
	})
	if err != nil {
		t.Fatalf("buildAdminModelRecord returned error: %v", err)
	}

	var config map[string]any
	if err := json.Unmarshal(record.ConfigJSON, &config); err != nil {
		t.Fatalf("decode config json: %v", err)
	}
	reasoning, ok := config["reasoning"].(map[string]any)
	if !ok {
		t.Fatalf("expected canonical reasoning object, got %#v", config["reasoning"])
	}
	if reasoning["contract"] != "anthropic_thinking" {
		t.Fatalf("expected reasoning.contract to be preserved, got %#v", reasoning["contract"])
	}
	if reasoning["default_level"] != "max" {
		t.Fatalf("expected reasoning.default_level to be preserved, got %#v", reasoning["default_level"])
	}
}

func TestBuildAdminModelRecordInfersRuntimeClassAndNameFromKnownProvider(t *testing.T) {
	t.Parallel()

	record, err := buildAdminModelRecord(adminModelRequest{
		Provider: "  openai-compatible  ",
		ConfigJSON: map[string]interface{}{
			"model": "gpt-5-mini",
		},
	})
	if err != nil {
		t.Fatalf("buildAdminModelRecord returned error: %v", err)
	}

	if record.Name != "openai-compatible-gpt-5-mini" {
		t.Fatalf("expected generated name, got %q", record.Name)
	}
	if record.DisplayName == nil || *record.DisplayName != "gpt-5-mini" {
		t.Fatalf("expected generated display name, got %#v", record.DisplayName)
	}

	var config map[string]any
	if err := json.Unmarshal(record.ConfigJSON, &config); err != nil {
		t.Fatalf("decode config json: %v", err)
	}
	if config["use"] != "langchain_openai:ChatOpenAI" {
		t.Fatalf("expected inferred runtime class, got %#v", config["use"])
	}
}

func TestBuildAdminModelRecordInfersProviderFromKnownRuntimeClass(t *testing.T) {
	t.Parallel()

	record, err := buildAdminModelRecord(adminModelRequest{
		ConfigJSON: map[string]interface{}{
			"use":   "langchain_google_genai:ChatGoogleGenerativeAI",
			"model": "gemini-2.5-pro",
		},
	})
	if err != nil {
		t.Fatalf("buildAdminModelRecord returned error: %v", err)
	}

	if record.Provider != "google" {
		t.Fatalf("expected inferred provider, got %q", record.Provider)
	}
	if record.Name != "google-gemini-2-5-pro" {
		t.Fatalf("expected generated name, got %q", record.Name)
	}
}

func TestBuildAdminModelRecordRejectsUnknownProviderWithoutRuntimeClass(t *testing.T) {
	t.Parallel()

	_, err := buildAdminModelRecord(adminModelRequest{
		Provider: "custom-provider",
		ConfigJSON: map[string]interface{}{
			"model": "custom-model",
		},
	})
	if err == nil || err.Error() != "config_json.use is required" {
		t.Fatalf("expected missing runtime class error, got %v", err)
	}
}

func TestScanNewAPIModelsUsesOpenAICompatibleListEndpoint(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("expected /v1/models path, got %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("expected bearer token header, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"object": "list",
			"data": [
				{"id": "gpt-5", "owned_by": "openai", "created": 1700000000},
				{"id": "claude-sonnet-4-5", "owner": "anthropic"},
				{"id": "glm-5.1", "owned_by": "custom", "supported_endpoint_types": ["anthropic", "openai"]},
				{"id": "gpt-5"}
			]
		}`))
	}))
	defer server.Close()

	items, err := scanNewAPIModels(
		context.Background(),
		server.Client(),
		server.URL,
		" test-token ",
	)
	if err != nil {
		t.Fatalf("scanNewAPIModels returned error: %v", err)
	}

	if len(items) != 3 {
		t.Fatalf("expected deduped models, got %#v", items)
	}
	if items[0].ID != "claude-sonnet-4-5" || items[0].Owner != "anthropic" {
		t.Fatalf("expected sorted anthropic model first, got %#v", items[0])
	}
	if items[0].Provider != newAPIProviderAnthropic {
		t.Fatalf("expected claude model to import as anthropic, got %q", items[0].Provider)
	}
	if items[1].ID != "glm-5.1" || items[1].Provider != newAPIProviderAnthropic {
		t.Fatalf("expected endpoint metadata to prefer anthropic, got %#v", items[1])
	}
	if items[2].ID != "gpt-5" || items[2].Owner != "openai" || items[2].Created != 1700000000 {
		t.Fatalf("expected openai model metadata, got %#v", items[2])
	}
	if items[2].Provider != newAPIProviderOpenAI {
		t.Fatalf("expected gpt model to import as openai, got %q", items[2].Provider)
	}
}

func TestInferNewAPIImportProviderUsesEndpointTypes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		modelID       string
		owner         string
		endpointTypes []string
		want          string
	}{
		{
			name:    "claude model name",
			modelID: "claude-sonnet-4-5",
			want:    newAPIProviderAnthropic,
		},
		{
			name:    "anthropic owner",
			modelID: "custom-router-model",
			owner:   "anthropic",
			want:    newAPIProviderAnthropic,
		},
		{
			name:          "custom model with anthropic endpoint",
			modelID:       "glm-5.1",
			endpointTypes: []string{"anthropic", "openai"},
			want:          newAPIProviderAnthropic,
		},
		{
			name:          "deepseek model with openai endpoint",
			modelID:       "deepseek-v4-pro",
			endpointTypes: []string{"openai"},
			want:          newAPIProviderDeepSeek,
		},
		{
			name:    "unknown compatible model",
			modelID: "glm-5.1",
			want:    newAPIProviderOpenAI,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := inferNewAPIImportProvider(tt.modelID, tt.owner, tt.endpointTypes); got != tt.want {
				t.Fatalf("inferNewAPIImportProvider(%q, %q, %#v) = %q, want %q", tt.modelID, tt.owner, tt.endpointTypes, got, tt.want)
			}
		})
	}
}

func TestParseNewAPIModelCandidatesSupportsAdminModelEnvelope(t *testing.T) {
	t.Parallel()

	items, err := parseNewAPIModelCandidates([]byte(`{
		"data": {
			"items": [
				{
					"model_name": "kimi-k2.6",
					"endpoints": "[\"anthropic\",\"openai\"]",
					"bound_channels": [{"name": "kimi", "type": 14}]
				},
				{
					"model_name": "deepseek-v4-pro",
					"endpoints": "[\"openai\"]",
					"bound_channels": [{"name": "deepseek", "type": 1}]
				}
			]
		},
		"success": true
	}`))
	if err != nil {
		t.Fatalf("parse admin envelope: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected two models, got %#v", items)
	}
	if items[1].ID != "kimi-k2.6" || items[1].Provider != newAPIProviderAnthropic {
		t.Fatalf("expected kimi to use anthropic endpoint, got %#v", items[1])
	}
	if items[0].ID != "deepseek-v4-pro" || items[0].Provider != newAPIProviderDeepSeek {
		t.Fatalf("expected deepseek to use deepseek runtime, got %#v", items[0])
	}
}

func TestIsMatchingGeneratedNewAPIModelRecordMatchesReclassifiedRows(t *testing.T) {
	t.Parallel()

	configJSON, err := json.Marshal(map[string]any{
		"use":      "langchain_openai:ChatOpenAI",
		"model":    "kimi-k2.6",
		"base_url": "http://localhost:13000/v1",
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	row := repository.ModelRecord{
		Name:       "openai-kimi-k2-6",
		Provider:   newAPIProviderOpenAI,
		ConfigJSON: configJSON,
	}
	if !isMatchingGeneratedNewAPIModelRecord(row, "http://localhost:13000/", "kimi-k2.6") {
		t.Fatalf("expected old generated openai row to match same New API model")
	}

	existingNoPrefixRow := repository.ModelRecord{
		Name:       "KIMI-K2.6",
		Provider:   newAPIProviderAnthropic,
		ConfigJSON: configJSON,
	}
	if !isMatchingGeneratedNewAPIModelRecord(existingNoPrefixRow, "http://localhost:13000/", "kimi-k2.6") {
		t.Fatalf("expected existing no-prefix row to match same New API model")
	}
	if isLegacyGeneratedNewAPIModelRecord(existingNoPrefixRow, "http://localhost:13000/", "kimi-k2.6") {
		t.Fatalf("expected no-prefix row not to be treated as legacy generated duplicate")
	}
}

func TestFindStoredNewAPIKeyMatchesDockerReachableBaseURL(t *testing.T) {
	t.Parallel()

	configJSON, err := json.Marshal(map[string]any{
		"use":      "langchain_openai:ChatOpenAI",
		"model":    "deepseek-v4-pro",
		"api_key":  "stored-token",
		"base_url": "http://host.docker.internal:13000/v1",
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	key, err := findStoredNewAPIKey("http://localhost:13000/", []repository.ModelRecord{
		{
			Name:       "openai-deepseek-v4-pro",
			Provider:   newAPIProviderOpenAI,
			ConfigJSON: configJSON,
		},
	})
	if err != nil {
		t.Fatalf("find stored key: %v", err)
	}
	if key != "stored-token" {
		t.Fatalf("expected stored key, got %q", key)
	}
}

func TestFindStoredNewAPIKeyMatchesWSLGatewayBaseURL(t *testing.T) {
	t.Parallel()

	configJSON, err := json.Marshal(map[string]any{
		"use":      "langchain_openai:ChatOpenAI",
		"model":    "deepseek-v4-pro",
		"api_key":  "stored-token",
		"base_url": "http://host.docker.internal:13000/v1",
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	key, err := findStoredNewAPIKey("http://172.31.16.1:13000/", []repository.ModelRecord{
		{
			Name:       "openai-deepseek-v4-pro",
			Provider:   newAPIProviderOpenAI,
			ConfigJSON: configJSON,
		},
	})
	if err != nil {
		t.Fatalf("find stored key: %v", err)
	}
	if key != "stored-token" {
		t.Fatalf("expected stored key, got %q", key)
	}
}

func TestFindStoredNewAPIKeyIgnoresUnrelatedRows(t *testing.T) {
	t.Parallel()

	configJSON, err := json.Marshal(map[string]any{
		"use":      "langchain_openai:ChatOpenAI",
		"model":    "unrelated-model",
		"api_key":  "other-token",
		"base_url": "http://other-newapi.example/v1",
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	key, err := findStoredNewAPIKey("http://localhost:13000/", []repository.ModelRecord{
		{
			Name:       "openai-unrelated-model",
			Provider:   newAPIProviderOpenAI,
			ConfigJSON: configJSON,
		},
	})
	if err != nil {
		t.Fatalf("find stored key: %v", err)
	}
	if key != "" {
		t.Fatalf("expected no reusable key, got %q", key)
	}
}

func TestDockerHostAliasURLMapsWSLGatewayAddress(t *testing.T) {
	t.Parallel()

	aliasURL, ok := dockerHostAliasURL("http://172.31.16.1:13000/v1/models")
	if !ok {
		t.Fatalf("expected WSL gateway address to map to Docker host alias")
	}
	if aliasURL != "http://host.docker.internal:13000/v1/models" {
		t.Fatalf("unexpected alias URL: %q", aliasURL)
	}
}

func TestBuildNewAPIImportedModelRecordUsesProviderBaseURLContracts(t *testing.T) {
	t.Parallel()

	openAIRecord, err := buildNewAPIImportedModelRecord(
		newAPIProviderOpenAI,
		"gpt-5",
		"http://localhost:13000/",
		"test-token",
		true,
	)
	if err != nil {
		t.Fatalf("build openai record: %v", err)
	}
	var openAIConfig map[string]any
	if err := json.Unmarshal(openAIRecord.ConfigJSON, &openAIConfig); err != nil {
		t.Fatalf("decode openai config: %v", err)
	}
	if openAIRecord.Name != "openai-gpt-5" {
		t.Fatalf("expected openai generated name, got %q", openAIRecord.Name)
	}
	if openAIConfig["base_url"] != "http://host.docker.internal:13000/v1" {
		t.Fatalf("expected openai /v1 base URL, got %#v", openAIConfig["base_url"])
	}
	if openAIConfig["supports_vision"] != true {
		t.Fatalf("expected imported openai model to default vision on")
	}
	if openAIConfig["max_input_tokens"] != float64(newAPIImportedModelMaxInputTokens) {
		t.Fatalf("expected imported openai model to set max_input_tokens, got %#v", openAIConfig["max_input_tokens"])
	}
	openAIReasoning, ok := openAIConfig["reasoning"].(map[string]any)
	if !ok {
		t.Fatalf("expected openai reasoning object, got %#v", openAIConfig["reasoning"])
	}
	if openAIReasoning["contract"] != "openai_responses" || openAIReasoning["default_level"] != "max" {
		t.Fatalf("expected max openai reasoning, got %#v", openAIReasoning)
	}

	anthropicRecord, err := buildNewAPIImportedModelRecord(
		newAPIProviderAnthropic,
		"claude-sonnet-4-5",
		"http://localhost:13000/v1",
		"test-token",
		true,
	)
	if err != nil {
		t.Fatalf("build anthropic record: %v", err)
	}
	var anthropicConfig map[string]any
	if err := json.Unmarshal(anthropicRecord.ConfigJSON, &anthropicConfig); err != nil {
		t.Fatalf("decode anthropic config: %v", err)
	}
	if anthropicRecord.Name != "claude-sonnet-4-5" {
		t.Fatalf("expected anthropic import to preserve model id as row name, got %q", anthropicRecord.Name)
	}
	if anthropicConfig["base_url"] != "http://host.docker.internal:13000" {
		t.Fatalf("expected anthropic root base URL, got %#v", anthropicConfig["base_url"])
	}
	if anthropicConfig["max_input_tokens"] != float64(newAPIImportedModelMaxInputTokens) {
		t.Fatalf("expected imported anthropic model to set max_input_tokens, got %#v", anthropicConfig["max_input_tokens"])
	}
	anthropicReasoning, ok := anthropicConfig["reasoning"].(map[string]any)
	if !ok {
		t.Fatalf("expected anthropic reasoning object, got %#v", anthropicConfig["reasoning"])
	}
	if anthropicReasoning["contract"] != "anthropic_thinking" || anthropicReasoning["default_level"] != "max" {
		t.Fatalf("expected max anthropic reasoning, got %#v", anthropicReasoning)
	}

	deepSeekRecord, err := buildNewAPIImportedModelRecord(
		newAPIProviderDeepSeek,
		"deepseek-v4-pro",
		"http://localhost:13000/",
		"test-token",
		true,
	)
	if err != nil {
		t.Fatalf("build deepseek record: %v", err)
	}
	var deepSeekConfig map[string]any
	if err := json.Unmarshal(deepSeekRecord.ConfigJSON, &deepSeekConfig); err != nil {
		t.Fatalf("decode deepseek config: %v", err)
	}
	if deepSeekRecord.Name != "deepseek-v4-pro" {
		t.Fatalf("expected deepseek import to preserve model id as row name, got %q", deepSeekRecord.Name)
	}
	if deepSeekConfig["use"] != "langchain_deepseek:ChatDeepSeek" {
		t.Fatalf("expected deepseek runtime, got %#v", deepSeekConfig["use"])
	}
	if deepSeekConfig["base_url"] != "http://host.docker.internal:13000/v1" {
		t.Fatalf("expected deepseek /v1 base URL, got %#v", deepSeekConfig["base_url"])
	}
	if deepSeekConfig["api_base"] != "http://host.docker.internal:13000/v1" {
		t.Fatalf("expected deepseek api_base for ChatDeepSeek, got %#v", deepSeekConfig["api_base"])
	}
	deepSeekReasoning, ok := deepSeekConfig["reasoning"].(map[string]any)
	if !ok {
		t.Fatalf("expected deepseek reasoning object, got %#v", deepSeekConfig["reasoning"])
	}
	if deepSeekReasoning["contract"] != "deepseek_reasoner" || deepSeekReasoning["default_level"] != "auto" {
		t.Fatalf("expected auto deepseek reasoning, got %#v", deepSeekReasoning)
	}

	deepSeekNoneRecord, err := buildNewAPIImportedModelRecord(
		newAPIProviderDeepSeek,
		"deepseek-v4-pro-none",
		"http://localhost:13000/",
		"test-token",
		true,
	)
	if err != nil {
		t.Fatalf("build deepseek none record: %v", err)
	}
	var deepSeekNoneConfig map[string]any
	if err := json.Unmarshal(deepSeekNoneRecord.ConfigJSON, &deepSeekNoneConfig); err != nil {
		t.Fatalf("decode deepseek none config: %v", err)
	}
	if _, ok := deepSeekNoneConfig["reasoning"]; ok {
		t.Fatalf("expected deepseek none variant to omit reasoning, got %#v", deepSeekNoneConfig["reasoning"])
	}
}

func TestBuildNewAPIImportedModelRecordUsesWSLGatewayAlias(t *testing.T) {
	t.Parallel()

	record, err := buildNewAPIImportedModelRecord(
		newAPIProviderDeepSeek,
		"deepseek-v4-pro",
		"http://172.31.16.1:13000/",
		"test-token",
		true,
	)
	if err != nil {
		t.Fatalf("build openai record: %v", err)
	}
	var config map[string]any
	if err := json.Unmarshal(record.ConfigJSON, &config); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if config["base_url"] != "http://host.docker.internal:13000/v1" {
		t.Fatalf("expected docker host alias base URL, got %#v", config["base_url"])
	}
}

func boolPtr(value bool) *bool {
	return &value
}
