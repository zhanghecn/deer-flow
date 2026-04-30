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

func TestListToolCatalogIncludesFilesystemMiddlewareTools(t *testing.T) {
	t.Setenv("OPENAGENTS_CONFIG_PATH", t.TempDir()+"/missing-config.yaml")

	items, err := (&AgentService{}).ListToolCatalog()
	if err != nil {
		t.Fatalf("ListToolCatalog() error = %v", err)
	}

	byName := make(map[string]struct {
		middlewareName         string
		middlewareConfigurable bool
		configurableMain       bool
		reservedPolicy         string
	}, len(items))
	for _, item := range items {
		byName[item.Name] = struct {
			middlewareName         string
			middlewareConfigurable bool
			configurableMain       bool
			reservedPolicy         string
		}{
			middlewareName:         item.MiddlewareName,
			middlewareConfigurable: item.MiddlewareConfigurable,
			configurableMain:       item.ConfigurableForMainAgent,
			reservedPolicy:         item.ReservedPolicy,
		}
	}

	for _, name := range []string{"ls", "read_file", "write_file", "edit_file", "glob", "grep", "execute"} {
		item, ok := byName[name]
		if !ok {
			t.Fatalf("filesystem middleware tool %q missing from catalog", name)
		}
		if item.middlewareName != "filesystem" || !item.middlewareConfigurable {
			t.Fatalf("tool %q metadata = %+v, want configurable filesystem middleware", name, item)
		}
		if item.configurableMain || item.reservedPolicy != middlewareInjectedPolicy {
			t.Fatalf("tool %q policy = %+v, want read-only middleware injected", name, item)
		}
	}
}

func TestListToolCatalogMarksTaskAndTodoMiddlewareConfigurable(t *testing.T) {
	t.Setenv("OPENAGENTS_CONFIG_PATH", t.TempDir()+"/missing-config.yaml")

	items, err := (&AgentService{}).ListToolCatalog()
	if err != nil {
		t.Fatalf("ListToolCatalog() error = %v", err)
	}

	byName := make(map[string]struct {
		middlewareName         string
		middlewareConfigurable bool
		reservedPolicy         string
	}, len(items))
	for _, item := range items {
		byName[item.Name] = struct {
			middlewareName         string
			middlewareConfigurable bool
			reservedPolicy         string
		}{
			middlewareName:         item.MiddlewareName,
			middlewareConfigurable: item.MiddlewareConfigurable,
			reservedPolicy:         item.ReservedPolicy,
		}
	}

	for _, expectation := range []struct {
		toolName       string
		middlewareName string
	}{
		{toolName: "task", middlewareName: "subagents"},
		{toolName: "write_todos", middlewareName: "todo"},
	} {
		item, ok := byName[expectation.toolName]
		if !ok {
			t.Fatalf("middleware tool %q missing from catalog", expectation.toolName)
		}
		if item.middlewareName != expectation.middlewareName || !item.middlewareConfigurable {
			t.Fatalf("tool %q metadata = %+v, want configurable %s middleware", expectation.toolName, item, expectation.middlewareName)
		}
		if item.reservedPolicy != middlewareInjectedPolicy {
			t.Fatalf("tool %q policy = %+v, want middleware injected", expectation.toolName, item)
		}
	}
}
