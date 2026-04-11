package service

import "testing"

func TestListToolCatalogOmitsRemovedKnowledgeListingTool(t *testing.T) {
	t.Setenv("OPENAGENTS_CONFIG_PATH", t.TempDir()+"/missing-config.yaml")

	items, err := (&AgentService{}).ListToolCatalog()
	if err != nil {
		t.Fatalf("ListToolCatalog() error = %v", err)
	}

	names := make(map[string]bool, len(items))
	for _, item := range items {
		names[item.Name] = true
	}

	if names["list_knowledge_documents"] {
		t.Fatalf("removed tool list_knowledge_documents still exposed in catalog")
	}
	if !names["get_document_tree"] || !names["get_document_evidence"] {
		t.Fatalf("knowledge retrieval tools missing from catalog: %+v", names)
	}
}
