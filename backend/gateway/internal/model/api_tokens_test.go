package model

import "testing"

func TestDefaultPublicAPIScopesIncludeKnowledgeRead(t *testing.T) {
	t.Parallel()

	scopes := DefaultPublicAPIScopes()
	for _, scope := range scopes {
		if scope == "knowledge:read" {
			return
		}
	}
	t.Fatalf("expected default public API scopes to include knowledge:read, got %#v", scopes)
}
