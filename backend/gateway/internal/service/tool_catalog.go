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

var builtinToolCatalog = []model.ToolCatalogItem{
	{
		Name:                     "present_files",
		Group:                    "output",
		Label:                    "Present Files",
		Description:              "Present generated files from the runtime outputs directory.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
	},
	{
		Name:                     "question",
		Group:                    "interaction",
		Label:                    "Question",
		Description:              "Ask the user one or more structured questions before continuing.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "main_agent_only",
	},
	{
		Name:                     "get_document_tree",
		Group:                    "knowledge",
		Label:                    "Get Document Tree",
		Description:              "Browse the indexed tree for a knowledge-base document.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
	},
	{
		Name:                     "get_document_evidence",
		Group:                    "knowledge",
		Label:                    "Get Document Evidence",
		Description:              "Fetch grounded evidence and citations for selected document nodes.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
	},
	{
		Name:                     "get_document_tree_node_detail",
		Group:                    "knowledge",
		Label:                    "Get Tree Node Detail",
		Description:              "Compatibility detail lookup for a single knowledge-tree node.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
	},
	{
		Name:                     "get_document_image",
		Group:                    "knowledge",
		Label:                    "Get Document Image",
		Description:              "Return a rendered image for a knowledge document region.",
		ConfigurableForMainAgent: true,
		ConfigurableForSubagent:  true,
		ReservedPolicy:           "normal",
	},
	{
		Name:                     "install_skill_from_registry",
		Group:                    "authoring",
		Label:                    "Install Skill From Registry",
		Description:              "Runtime-only authoring helper for installing registry skills.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
	},
	{
		Name:                     "save_agent_to_store",
		Group:                    "authoring",
		Label:                    "Save Agent To Store",
		Description:              "Runtime-only authoring helper for saving an agent archive.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
	},
	{
		Name:                     "save_skill_to_store",
		Group:                    "authoring",
		Label:                    "Save Skill To Store",
		Description:              "Runtime-only authoring helper for saving a skill archive.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
	},
	{
		Name:                     "push_agent_prod",
		Group:                    "authoring",
		Label:                    "Publish Agent",
		Description:              "Runtime-only authoring helper for publishing an agent archive to prod.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
	},
	{
		Name:                     "push_skill_prod",
		Group:                    "authoring",
		Label:                    "Publish Skill",
		Description:              "Runtime-only authoring helper for publishing a skill to prod.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
	},
	{
		Name:                     "setup_agent",
		Group:                    "authoring",
		Label:                    "Setup Agent",
		Description:              "Runtime-only helper for the create-agent authoring flow.",
		ConfigurableForMainAgent: false,
		ConfigurableForSubagent:  false,
		ReservedPolicy:           "runtime_only",
	},
}

func (s *AgentService) ListToolCatalog() ([]model.ToolCatalogItem, error) {
	tools := make([]model.ToolCatalogItem, 0, len(builtinToolCatalog))
	tools = append(tools, builtinToolCatalog...)

	configTools, err := loadConfiguredToolCatalog()
	if err != nil {
		return nil, err
	}
	tools = append(tools, configTools...)
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
