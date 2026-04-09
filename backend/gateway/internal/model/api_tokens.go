package model

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

const (
	APITokenStatusActive  = "active"
	APITokenStatusRevoked = "revoked"
)

var defaultPublicAPIScopes = []string{
	"responses:create",
	"responses:read",
	"artifacts:read",
}

// DefaultPublicAPIScopes returns the least-privilege baseline for public API
// keys. Callers receive a copy so request-specific normalization cannot mutate
// the shared contract.
func DefaultPublicAPIScopes() []string {
	return slices.Clone(defaultPublicAPIScopes)
}

// NormalizeAPITokenScopes trims, lowercases, deduplicates, and sorts scopes so
// stored keys have a stable authorization shape.
func NormalizeAPITokenScopes(scopes []string) []string {
	normalized := normalizeTokenStringList(scopes)
	if len(normalized) == 0 {
		return DefaultPublicAPIScopes()
	}
	return normalized
}

// NormalizeAPITokenAllowedAgents stores explicit per-key agent allowlists in a
// canonical lowercase form because the public `model` field maps directly to the
// published agent name.
func NormalizeAPITokenAllowedAgents(agentNames []string) []string {
	return normalizeTokenStringList(agentNames)
}

// ValidateAPITokenMetadata ensures token metadata stays a JSON object so later
// policy/audit readers can merge fields without guessing whether the payload was
// an array or scalar.
func ValidateAPITokenMetadata(raw json.RawMessage) (json.RawMessage, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return json.RawMessage(`{}`), nil
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("metadata must be a valid JSON object: %w", err)
	}

	normalized, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("metadata must be a valid JSON object: %w", err)
	}
	return json.RawMessage(normalized), nil
}

func normalizeTokenStringList(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}

	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		candidate := strings.ToLower(strings.TrimSpace(value))
		if candidate == "" {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		normalized = append(normalized, candidate)
	}
	slices.Sort(normalized)
	return normalized
}
