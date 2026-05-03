package model

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

const (
	ReasoningContractOpenAIResponses = "openai_responses"
	ReasoningContractAnthropic       = "anthropic_thinking"
	ReasoningContractGeminiBudget    = "gemini_budget"
	ReasoningContractGeminiLevel     = "gemini_level"
	ReasoningContractDeepSeek        = "deepseek_reasoner"

	openAIRuntimeClass    = "langchain_openai:ChatOpenAI"
	anthropicRuntimeClass = "langchain_anthropic:ChatAnthropic"
	geminiRuntimeClass    = "langchain_google_genai:ChatGoogleGenerativeAI"
	deepSeekRuntimeClass  = "langchain_deepseek:ChatDeepSeek"
)

var (
	canonicalReasoningContracts = map[string]struct{}{
		ReasoningContractOpenAIResponses: {},
		ReasoningContractAnthropic:       {},
		ReasoningContractGeminiBudget:    {},
		ReasoningContractGeminiLevel:     {},
		ReasoningContractDeepSeek:        {},
	}
	canonicalReasoningLevels = map[string]struct{}{
		"auto":   {},
		"low":    {},
		"medium": {},
		"high":   {},
		"max":    {},
	}
	legacyReasoningKeys = []string{
		"supports_effort",
		"supports_reasoning_effort",
		"supports_thinking",
		"when_thinking_enabled",
		"reasoning_effort",
	}
)

type CanonicalModelReasoning struct {
	Contract     string
	DefaultLevel string
}

func LegacyReasoningKeys(config map[string]interface{}) []string {
	keys := make([]string, 0, len(legacyReasoningKeys))
	for _, key := range legacyReasoningKeys {
		if _, exists := config[key]; exists {
			keys = append(keys, key)
		}
	}
	return keys
}

func HasLegacyReasoningConfig(config map[string]interface{}) bool {
	return len(LegacyReasoningKeys(config)) > 0
}

func ValidateCanonicalReasoningConfig(value interface{}) (*CanonicalModelReasoning, error) {
	if value == nil {
		return nil, nil
	}

	record, ok := value.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("config_json.reasoning must be an object")
	}

	contract, _ := record["contract"].(string)
	contract = strings.TrimSpace(contract)
	if _, ok := canonicalReasoningContracts[contract]; !ok {
		return nil, fmt.Errorf("config_json.reasoning.contract is invalid")
	}

	defaultLevel, _ := record["default_level"].(string)
	defaultLevel = strings.ToLower(strings.TrimSpace(defaultLevel))
	if defaultLevel == "" {
		defaultLevel = "auto"
	}
	if _, ok := canonicalReasoningLevels[defaultLevel]; !ok {
		return nil, fmt.Errorf("config_json.reasoning.default_level is invalid")
	}
	if contract == ReasoningContractDeepSeek && defaultLevel != "auto" {
		return nil, fmt.Errorf("config_json.reasoning.default_level must be auto for deepseek_reasoner")
	}

	return &CanonicalModelReasoning{
		Contract:     contract,
		DefaultLevel: defaultLevel,
	}, nil
}

func NormalizeLegacyReasoningConfig(config map[string]interface{}) (map[string]interface{}, bool) {
	if !HasLegacyReasoningConfig(config) {
		return config, false
	}

	normalized := cloneModelConfigMap(config)
	reasoning := buildCanonicalReasoningFromLegacy(config)
	for _, key := range legacyReasoningKeys {
		delete(normalized, key)
	}
	if reasoning != nil {
		normalized["reasoning"] = map[string]interface{}{
			"contract":      reasoning.Contract,
			"default_level": reasoning.DefaultLevel,
		}
	} else {
		delete(normalized, "reasoning")
	}
	return normalized, true
}

func SupportsThinking(config map[string]interface{}) bool {
	reasoning, _ := canonicalReasoningFromConfig(config)
	return reasoning != nil
}

func SupportsEffort(config map[string]interface{}) bool {
	reasoning, _ := canonicalReasoningFromConfig(config)
	if reasoning == nil {
		return false
	}
	return reasoning.Contract != ReasoningContractDeepSeek
}

func ReasoningDefaultLevel(config map[string]interface{}) string {
	reasoning, _ := canonicalReasoningFromConfig(config)
	if reasoning == nil {
		return ""
	}
	return reasoning.DefaultLevel
}

func canonicalReasoningFromConfig(config map[string]interface{}) (*CanonicalModelReasoning, bool) {
	if reasoning, err := ValidateCanonicalReasoningConfig(config["reasoning"]); err == nil && reasoning != nil {
		return reasoning, true
	}
	if !HasLegacyReasoningConfig(config) {
		return nil, false
	}
	return buildCanonicalReasoningFromLegacy(config), true
}

func buildCanonicalReasoningFromLegacy(config map[string]interface{}) *CanonicalModelReasoning {
	contract, ok := inferReasoningContract(config)
	if !ok {
		return nil
	}
	return &CanonicalModelReasoning{
		Contract:     contract,
		DefaultLevel: inferDefaultReasoningLevel(config, contract),
	}
}

func inferReasoningContract(config map[string]interface{}) (string, bool) {
	runtimeClass, _ := config["use"].(string)
	runtimeClass = strings.TrimSpace(runtimeClass)
	modelName, _ := config["model"].(string)
	modelName = strings.ToLower(strings.TrimSpace(modelName))

	supportsThinking := config["supports_thinking"] == true
	supportsEffort := config["supports_effort"] == true
	thinkingPayload := extractLegacyThinkingPayload(config)

	if !supportsThinking && !supportsEffort && thinkingPayload == nil {
		if runtimeClass == deepSeekRuntimeClass && isDeepSeekReasonerModel(modelName) {
			return ReasoningContractDeepSeek, true
		}
		return "", false
	}

	switch runtimeClass {
	case openAIRuntimeClass:
		return ReasoningContractOpenAIResponses, true
	case anthropicRuntimeClass:
		return ReasoningContractAnthropic, true
	case geminiRuntimeClass:
		if usesGeminiLevelContract(modelName) {
			return ReasoningContractGeminiLevel, true
		}
		return ReasoningContractGeminiBudget, true
	case deepSeekRuntimeClass:
		if isDeepSeekReasonerModel(modelName) {
			return ReasoningContractDeepSeek, true
		}
		return "", false
	default:
		return "", false
	}
}

func inferDefaultReasoningLevel(config map[string]interface{}, contract string) string {
	if contract == ReasoningContractDeepSeek {
		return "auto"
	}

	for _, key := range []string{"reasoning_effort", "effort"} {
		if level, ok := normalizeReasoningLevel(config[key]); ok {
			return level
		}
	}

	thinkingPayload := extractLegacyThinkingPayload(config)
	if thinkingPayload != nil {
		thinkingType, _ := thinkingPayload["type"].(string)
		thinkingType = strings.ToLower(strings.TrimSpace(thinkingType))
		if thinkingType == "adaptive" {
			return "auto"
		}
		budget := thinkingPayload["budget_tokens"]
		if budget == nil {
			budget = thinkingPayload["budgetTokens"]
		}
		if level, ok := mapBudgetToReasoningLevel(budget); ok {
			return level
		}
		if thinkingType == "enabled" {
			return "auto"
		}
	}

	// Retire the old implicit "supports_effort => high" behavior. Migrated rows
	// only keep explicit legacy levels; otherwise the runtime falls back to the
	// provider default for thinking-enabled turns.
	return "auto"
}

func extractLegacyThinkingPayload(config map[string]interface{}) map[string]interface{} {
	thinkingConfig, ok := config["when_thinking_enabled"].(map[string]interface{})
	if !ok {
		return nil
	}
	if direct, ok := thinkingConfig["thinking"].(map[string]interface{}); ok {
		return direct
	}
	extraBody, ok := thinkingConfig["extra_body"].(map[string]interface{})
	if !ok {
		return nil
	}
	nested, _ := extraBody["thinking"].(map[string]interface{})
	return nested
}

func mapBudgetToReasoningLevel(value interface{}) (string, bool) {
	budget, ok := toPositiveInt(value)
	if !ok {
		return "", false
	}
	switch {
	case budget <= 2_000:
		return "low", true
	case budget <= 8_000:
		return "medium", true
	case budget <= 16_000:
		return "high", true
	default:
		return "max", true
	}
}

func normalizeReasoningLevel(value interface{}) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	normalized := strings.ToLower(strings.TrimSpace(text))
	_, exists := canonicalReasoningLevels[normalized]
	return normalized, exists
}

func usesGeminiLevelContract(modelName string) bool {
	return strings.HasPrefix(modelName, "gemini-3")
}

func isDeepSeekReasonerModel(modelName string) bool {
	normalized := strings.ToLower(strings.TrimSpace(modelName))
	if normalized == "" || strings.HasSuffix(normalized, "-none") {
		return false
	}
	// New API exposes DeepSeek V4 thinking variants as OpenAI-compatible model
	// ids; the suffix-less and max variants still need DeepSeek reasoning state.
	return strings.Contains(normalized, "reasoner") ||
		strings.HasPrefix(normalized, "deepseek-r1") ||
		strings.HasPrefix(normalized, "deepseek-v4")
}

func cloneModelConfigMap(config map[string]interface{}) map[string]interface{} {
	normalized := make(map[string]interface{}, len(config))
	for key, value := range config {
		normalized[key] = value
	}
	return normalized
}

func toPositiveInt(value interface{}) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, typed > 0
	case float64:
		asInt := int(typed)
		return asInt, typed == float64(asInt) && asInt > 0
	case json.Number:
		asInt64, err := typed.Int64()
		if err != nil || asInt64 <= 0 {
			return 0, false
		}
		return int(asInt64), true
	default:
		return 0, false
	}
}

func SortedLegacyReasoningKeys(config map[string]interface{}) []string {
	keys := LegacyReasoningKeys(config)
	slices.Sort(keys)
	return keys
}
