package service

import "testing"

func TestListToolCatalogDefaultSurfaceIsExplicit(t *testing.T) {
	t.Setenv("OPENAGENTS_CONFIG_PATH", t.TempDir()+"/missing-config.yaml")

	items, err := (&AgentService{}).ListToolCatalog()
	if err != nil {
		t.Fatalf("ListToolCatalog() error = %v", err)
	}

	names := make(map[string]bool, len(items))
	for _, item := range items {
		names[item.Name] = true
	}

	expected := map[string]bool{
		"execute":                     true,
		"glob":                        true,
		"grep":                        true,
		"edit_file":                   true,
		"install_skill_from_registry": true,
		"ls":                          true,
		"present_files":               true,
		"push_agent_prod":             true,
		"push_skill_prod":             true,
		"question":                    true,
		"read_file":                   true,
		"save_agent_to_store":         true,
		"save_skill_to_store":         true,
		"setup_agent":                 true,
		"task":                        true,
		"write_file":                  true,
		"write_todos":                 true,
	}
	if len(names) != len(expected) {
		t.Fatalf("default tool catalog names = %+v, want exactly %+v", names, expected)
	}
	for expectedName := range expected {
		if !names[expectedName] {
			t.Fatalf("default tool catalog missing %q: %+v", expectedName, names)
		}
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
