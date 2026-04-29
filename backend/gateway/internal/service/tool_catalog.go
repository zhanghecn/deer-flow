package service

import (
	"os"
	"slices"
	"strings"

	"github.com/openagents/gateway/internal/bootstrap"
	"github.com/openagents/gateway/internal/model"
	"gopkg.in/yaml.v3"
)

type runtimeConfigTool struct {
	Name        string `yaml:"name"`
	Group       string `yaml:"group"`
	Label       string `yaml:"label"`
	Description string `yaml:"description"`
}

type runtimeConfigManifest struct {
	Tools []runtimeConfigTool `yaml:"tools"`
}

const middlewareInjectedPolicy = "middleware_injected"

var builtinToolCatalog = []model.ToolCatalogItem{
	{
		Name:                     "present_files",
		Group:                    "output",
		Label:                    "Present Files",
		Description:              "Present generated files from the runtime outputs directory.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
		Source:                   "builtin",
	},
	{
		Name:                     "question",
		Group:                    "interaction",
		Label:                    "Question",
		Description:              "Ask the user one or more structured questions before continuing.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "main_agent_only",
		Source:                   "builtin",
	},
	{
		Name:                     "get_document_tree",
		Group:                    "knowledge",
		Label:                    "Get Document Tree",
		Description:              "Browse the indexed tree for a knowledge-base document.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
		Source:                   "builtin",
	},
	{
		Name:                     "get_document_evidence",
		Group:                    "knowledge",
		Label:                    "Get Document Evidence",
		Description:              "Fetch grounded evidence and citations for selected document nodes.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
		Source:                   "builtin",
	},
	{
		Name:                     "get_document_tree_node_detail",
		Group:                    "knowledge",
		Label:                    "Get Tree Node Detail",
		Description:              "Compatibility detail lookup for a single knowledge-tree node.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
		Source:                   "builtin",
	},
	{
		Name:                     "get_document_image",
		Group:                    "knowledge",
		Label:                    "Get Document Image",
		Description:              "Return a rendered image for a knowledge document region.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
		Source:                   "builtin",
	},
	{
		Name:                     "install_skill_from_registry",
		Group:                    "authoring",
		Label:                    "Install Skill From Registry",
		Description:              "Runtime-only authoring helper for installing registry skills.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
		Source:                   "builtin",
	},
	{
		Name:                     "save_agent_to_store",
		Group:                    "authoring",
		Label:                    "Save Agent To Store",
		Description:              "Runtime-only authoring helper for saving an agent archive.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
		Source:                   "builtin",
	},
	{
		Name:                     "save_skill_to_store",
		Group:                    "authoring",
		Label:                    "Save Skill To Store",
		Description:              "Runtime-only authoring helper for saving a skill archive.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
		Source:                   "builtin",
	},
	{
		Name:                     "push_agent_prod",
		Group:                    "authoring",
		Label:                    "Publish Agent",
		Description:              "Runtime-only authoring helper for publishing an agent archive to prod.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
		Source:                   "builtin",
	},
	{
		Name:                     "push_skill_prod",
		Group:                    "authoring",
		Label:                    "Publish Skill",
		Description:              "Runtime-only authoring helper for publishing a skill to prod.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
		Source:                   "builtin",
	},
	{
		Name:                     "setup_agent",
		Group:                    "authoring",
		Label:                    "Setup Agent",
		Description:              "Runtime-only helper for the create-agent authoring flow.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
		Source:                   "builtin",
	},
}

func (s *AgentService) ListToolCatalog() ([]model.ToolCatalogItem, error) {
	tools := make([]model.ToolCatalogItem, 0, len(builtinToolCatalog)+len(middlewareToolCatalog))
	tools = append(tools, builtinToolCatalog...)

	configTools, err := loadConfiguredToolCatalog()
	if err != nil {
		return nil, err
	}
	tools = append(tools, configTools...)
	tools = append(tools, middlewareToolCatalog...)
	tools = dedupeToolCatalogItems(tools)
	slices.SortFunc(tools, func(a, b model.ToolCatalogItem) int {
		if byGroup := strings.Compare(a.Group, b.Group); byGroup != 0 {
			return byGroup
		}
		return strings.Compare(a.Name, b.Name)
	})
	return tools, nil
}

func (s *AgentService) toolCatalogByName() (map[string]model.ToolCatalogItem, error) {
	items, err := s.ListToolCatalog()
	if err != nil {
		return nil, err
	}
	index := make(map[string]model.ToolCatalogItem, len(items))
	for _, item := range items {
		index[item.Name] = item
	}
	return index, nil
}

var middlewareToolCatalog = []model.ToolCatalogItem{
	filesystemMiddlewareTool("ls", "filesystem", "List directory entries in the runtime workspace."),
	filesystemMiddlewareTool("read_file", "filesystem", "Read a file from the runtime workspace."),
	filesystemMiddlewareTool("write_file", "filesystem", "Write a file in the runtime workspace."),
	filesystemMiddlewareTool("edit_file", "filesystem", "Apply targeted edits to a runtime workspace file."),
	filesystemMiddlewareTool("glob", "filesystem", "Find files by glob pattern in the runtime workspace."),
	filesystemMiddlewareTool("grep", "filesystem", "Search file contents in the runtime workspace."),
	filesystemMiddlewareTool("execute", "execution", "Run a shell command through the runtime filesystem middleware."),
	{
		Name:                     "write_todos",
		Group:                    "planning",
		Label:                    "Write Todos",
		Description:              "Update the runtime todo list when plan-mode middleware is enabled.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           middlewareInjectedPolicy,
		Source:                   "middleware",
		MiddlewareName:           "todo",
		MiddlewareConfigurable:   false,
		ReadOnlyReason:           "Injected only for plan-mode runs by TodoListMiddleware; archive tool_names do not control it.",
	},
	{
		Name:                     "task",
		Group:                    "delegation",
		Label:                    "Task",
		Description:              "Delegate a complex, independent task to an isolated subagent when subagents are enabled.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           middlewareInjectedPolicy,
		Source:                   "middleware",
		MiddlewareName:           "subagents",
		MiddlewareConfigurable:   false,
		ReadOnlyReason:           "Injected by SubAgentMiddleware when delegation is enabled; explicit normal-tool whitelists disable this default task surface.",
	},
}

func filesystemMiddlewareTool(name string, group string, description string) model.ToolCatalogItem {
	return model.ToolCatalogItem{
		Name:                     name,
		Group:                    group,
		Label:                    titleizeToolName(name),
		Description:              description,
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           middlewareInjectedPolicy,
		Source:                   "middleware",
		MiddlewareName:           "filesystem",
		MiddlewareConfigurable:   true,
		ReadOnlyReason:           "Injected by FilesystemMiddleware when the agent runtime middleware switch is enabled.",
	}
}

func dedupeToolCatalogItems(items []model.ToolCatalogItem) []model.ToolCatalogItem {
	deduped := make([]model.ToolCatalogItem, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		item.Name = name
		deduped = append(deduped, item)
		seen[name] = struct{}{}
	}
	return deduped
}

func loadConfiguredToolCatalog() ([]model.ToolCatalogItem, error) {
	data, err := os.ReadFile(bootstrap.MainConfigPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []model.ToolCatalogItem{}, nil
		}
		return nil, err
	}

	var manifest runtimeConfigManifest
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}

	items := make([]model.ToolCatalogItem, 0, len(manifest.Tools))
	for _, tool := range manifest.Tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		group := strings.TrimSpace(tool.Group)
		if group == "" {
			group = "custom"
		}
		label := strings.TrimSpace(tool.Label)
		if label == "" {
			label = titleizeToolName(name)
		}
		description := strings.TrimSpace(tool.Description)
		if description == "" {
			description = "Configured runtime tool from config.yaml."
		}
		items = append(items, model.ToolCatalogItem{
			Name:                     name,
			Group:                    group,
			Label:                    label,
			Description:              description,
			ConfigurableForMainAgent: true,
			ConfigurableForSubagent:  true,
			ReservedPolicy:           "normal",
			Source:                   "config",
		})
	}
	return items, nil
}

func titleizeToolName(name string) string {
	parts := strings.Fields(strings.NewReplacer("-", " ", "_", " ").Replace(name))
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
	}
	return strings.Join(parts, " ")
}
