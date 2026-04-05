package agentfs

import (
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
	"gopkg.in/yaml.v3"
)

const builtinLeadAgentName = "lead_agent"

var ErrAgentAlreadyOwned = errors.New("agent already has an owner")

func isBuiltinLeadAgent(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), builtinLeadAgentName)
}

type manifest struct {
	Name             string                       `yaml:"name"`
	Description      string                       `yaml:"description"`
	Model            *string                      `yaml:"model"`
	ToolGroups       []string                     `yaml:"tool_groups"`
	ToolNames        []string                     `yaml:"tool_names"`
	McpServers       []string                     `yaml:"mcp_servers"`
	Status           string                       `yaml:"status"`
	OwnerUserID      string                       `yaml:"owner_user_id,omitempty"`
	AgentsMD         string                       `yaml:"agents_md_path"`
	Memory           *model.AgentMemoryConfig     `yaml:"memory"`
	SkillRefs        []model.SkillRef             `yaml:"skill_refs"`
	SubagentDefaults *model.AgentSubagentDefaults `yaml:"subagent_defaults"`
}

type subagentsManifest struct {
	Version   int                         `yaml:"version"`
	Subagents map[string]subagentManifest `yaml:"subagents"`
}

type subagentManifest struct {
	Description  string   `yaml:"description"`
	SystemPrompt string   `yaml:"system_prompt"`
	Model        *string  `yaml:"model,omitempty"`
	ToolNames    []string `yaml:"tool_names,omitempty"`
	Enabled      *bool    `yaml:"enabled,omitempty"`
}

func parseSkillRefSourcePath(sourcePath string) (string, string, bool) {
	normalized := strings.Trim(strings.TrimSpace(sourcePath), "/")
	if normalized == "" {
		return "", "", false
	}
	for _, prefix := range []string{
		"system/skills/",
		"custom/skills/",
		"store/dev/",
		"store/prod/",
	} {
		if !strings.HasPrefix(normalized, prefix) {
			continue
		}
		category := strings.TrimSuffix(prefix, "/")
		switch category {
		case "system/skills":
			category = "system"
		case "custom/skills":
			category = "custom"
		}
		return category, strings.TrimPrefix(normalized, prefix), true
	}
	return "", "", false
}

// Older archived manifests may only persist source_path. Derive the scope and
// copied target path at load time so the browser and update APIs see the same
// canonical skill ref shape the save path expects.
func normalizeLoadedSkillRef(ref model.SkillRef) model.SkillRef {
	sourcePath := strings.Trim(strings.TrimSpace(ref.SourcePath), "/")
	if sourcePath == "" {
		return ref
	}

	category := strings.Trim(strings.TrimSpace(ref.Category), "/")
	relativePath := ""
	if derivedCategory, derivedRelativePath, ok := parseSkillRefSourcePath(sourcePath); ok {
		if category == "" {
			category = derivedCategory
		}
		relativePath = derivedRelativePath
	}

	if strings.TrimSpace(ref.MaterializedPath) == "" {
		if relativePath == "" {
			relativePath = ref.Name
		}
		ref.MaterializedPath = path.Join("skills", relativePath)
	}
	if ref.Status == "" {
		switch category {
		case "store/dev":
			ref.Status = "dev"
		case "store/prod":
			ref.Status = "prod"
		}
	}

	ref.Category = category
	ref.SourcePath = sourcePath
	return ref
}

func LoadAgent(fsStore *storage.FS, name string, status string, includeMarkdown bool) (*model.Agent, error) {
	configFile := filepath.Join(fsStore.AgentDir(name, status), "config.yaml")
	info, err := os.Stat(configFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if info.IsDir() {
		return nil, nil
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, err
	}

	var cfg manifest
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	for i := range cfg.SkillRefs {
		cfg.SkillRefs[i] = normalizeLoadedSkillRef(cfg.SkillRefs[i])
	}

	agentName := strings.TrimSpace(cfg.Name)
	if agentName == "" {
		agentName = name
	}

	agent := &model.Agent{
		Name:             agentName,
		Description:      cfg.Description,
		Model:            cfg.Model,
		ToolGroups:       cfg.ToolGroups,
		ToolNames:        cfg.ToolNames,
		McpServers:       cfg.McpServers,
		Status:           status,
		OwnerUserID:      strings.TrimSpace(cfg.OwnerUserID),
		Memory:           cfg.Memory,
		Skills:           cfg.SkillRefs,
		SubagentDefaults: cfg.SubagentDefaults,
	}
	if agent.Memory == nil {
		normalized := defaultMemoryConfig()
		agent.Memory = &normalized
	}
	if agent.SubagentDefaults == nil {
		normalized := defaultSubagentDefaults()
		agent.SubagentDefaults = &normalized
	}
	subagents, err := loadSubagents(fsStore, agentName, status)
	if err != nil {
		return nil, err
	}
	agent.Subagents = subagents

	if includeMarkdown {
		agentsMDPath := strings.TrimSpace(cfg.AgentsMD)
		if agentsMDPath == "" {
			agentsMDPath = "AGENTS.md"
		}
		markdown, err := os.ReadFile(filepath.Join(fsStore.AgentDir(agentName, status), filepath.Clean(agentsMDPath)))
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		agent.AgentsMD = string(markdown)
	}

	return agent, nil
}

func loadSubagents(fsStore *storage.FS, name string, status string) ([]model.AgentSubagent, error) {
	sourcePath := fsStore.AgentSubagentsPath(name, status)
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []model.AgentSubagent{}, nil
		}
		return nil, err
	}

	var payload subagentsManifest
	if err := yaml.Unmarshal(data, &payload); err != nil {
		return nil, err
	}
	if payload.Version == 0 {
		payload.Version = 1
	}
	if payload.Subagents == nil {
		var legacy map[string]subagentManifest
		if err := yaml.Unmarshal(data, &legacy); err == nil && len(legacy) > 0 {
			payload.Subagents = legacy
		}
	}
	subagents := make([]model.AgentSubagent, 0, len(payload.Subagents))
	for name, item := range payload.Subagents {
		enabled := true
		if item.Enabled != nil {
			enabled = *item.Enabled
		}
		subagents = append(subagents, model.AgentSubagent{
			Name:         strings.TrimSpace(name),
			Description:  item.Description,
			SystemPrompt: item.SystemPrompt,
			Model:        item.Model,
			ToolNames:    item.ToolNames,
			Enabled:      enabled,
		})
	}
	slices.SortFunc(subagents, func(a, b model.AgentSubagent) int {
		return strings.Compare(a.Name, b.Name)
	})
	return subagents, nil
}

func ListAgents(fsStore *storage.FS, status string) ([]model.Agent, error) {
	var agents []model.Agent
	seen := make(map[string]struct{})
	for _, root := range statusRoots(fsStore, status) {
		entries, err := os.ReadDir(root)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}

		currentStatus := filepath.Base(root)
		for _, entry := range entries {
			if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			agent, err := LoadAgent(fsStore, entry.Name(), currentStatus, false)
			if err != nil {
				return nil, err
			}
			if agent != nil {
				key := strings.ToLower(agent.Name) + "|" + agent.Status
				if _, ok := seen[key]; ok {
					continue
				}
				agents = append(agents, *agent)
				seen[key] = struct{}{}
			}
		}
	}

	slices.SortFunc(agents, func(a, b model.Agent) int {
		aBuiltin := isBuiltinLeadAgent(a.Name)
		bBuiltin := isBuiltinLeadAgent(b.Name)
		if aBuiltin != bBuiltin {
			if aBuiltin {
				return -1
			}
			return 1
		}
		if byName := strings.Compare(a.Name, b.Name); byName != 0 {
			return byName
		}
		return strings.Compare(a.Status, b.Status)
	})
	return agents, nil
}

func AgentExists(fsStore *storage.FS, name string) bool {
	for _, status := range []string{"dev", "prod"} {
		info, err := os.Stat(fsStore.AgentDir(name, status))
		if err == nil && info.IsDir() {
			return true
		}
	}
	return false
}

func isAgentOwnedSkillRef(ref model.SkillRef) bool {
	return strings.TrimSpace(ref.SourcePath) == "" &&
		strings.TrimSpace(ref.Category) == "" &&
		strings.TrimSpace(ref.MaterializedPath) != ""
}

func normalizeSkillRefScope(ref model.SkillRef) string {
	if category := strings.Trim(strings.TrimSpace(ref.Category), "/"); category != "" {
		return category
	}
	sourcePath := strings.Trim(strings.TrimSpace(ref.SourcePath), "/")
	if sourcePath == "" {
		return ""
	}
	scope := path.Dir(sourcePath)
	if scope == "." || scope == "/" {
		return strings.Trim(sourcePath, "/")
	}
	return scope
}

func validateProdSkillRefs(skillRefs []model.SkillRef) error {
	for _, ref := range skillRefs {
		if isAgentOwnedSkillRef(ref) {
			continue
		}
		scope := normalizeSkillRefScope(ref)
		if scope == "system" || scope == "custom" || scope == "store/prod" {
			continue
		}

		location := strings.TrimSpace(ref.SourcePath)
		if location == "" {
			location = strings.TrimSpace(ref.Category)
		}
		if location == "" {
			location = "unknown source"
		}
		return fmt.Errorf(
			"prod agents can only use system/custom or store/prod skills; skill %q comes from %s",
			ref.Name,
			location,
		)
	}
	return nil
}

func PublishAgent(fsStore *storage.FS, name string) (*model.Agent, error) {
	sourceDir := fsStore.AgentDir(name, "dev")
	info, err := os.Stat(sourceDir)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("agent %q not found", name)
	}

	if !isBuiltinLeadAgent(name) {
		devAgent, err := LoadAgent(fsStore, name, "dev", false)
		if err != nil {
			return nil, err
		}
		if devAgent == nil {
			return nil, fmt.Errorf("agent %q not found", name)
		}
		if err := validateProdSkillRefs(devAgent.Skills); err != nil {
			return nil, err
		}
	}

	targetDir := fsStore.AgentDir(name, "prod")
	_ = os.RemoveAll(targetDir)
	if err := fsStore.CopyDir(sourceDir, targetDir); err != nil {
		return nil, err
	}
	if err := rewriteStatus(targetDir, "prod"); err != nil {
		return nil, err
	}
	return LoadAgent(fsStore, name, "prod", true)
}

func SetAgentOwner(fsStore *storage.FS, name string, ownerUserID string) error {
	if isBuiltinLeadAgent(name) {
		return fmt.Errorf("agent %q is reserved and cannot be claimed", builtinLeadAgentName)
	}

	trimmedOwnerUserID := strings.TrimSpace(ownerUserID)
	if trimmedOwnerUserID == "" {
		return fmt.Errorf("owner user id is required")
	}

	found := false
	// Claim both archives together so a legacy custom agent cannot keep a
	// split-brain ownerless prod/dev pair after the first explicit ownership
	// assignment.
	for _, status := range []string{"dev", "prod"} {
		configFile := filepath.Join(fsStore.AgentDir(name, status), "config.yaml")
		data, err := os.ReadFile(configFile)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		found = true

		var payload map[string]any
		if err := yaml.Unmarshal(data, &payload); err != nil {
			return err
		}
		existingOwnerUserID := strings.TrimSpace(fmt.Sprint(payload["owner_user_id"]))
		switch {
		case existingOwnerUserID == "" || existingOwnerUserID == "<nil>":
			payload["owner_user_id"] = trimmedOwnerUserID
		case existingOwnerUserID == trimmedOwnerUserID:
			continue
		default:
			return ErrAgentAlreadyOwned
		}

		updated, err := yaml.Marshal(payload)
		if err != nil {
			return err
		}
		if err := os.WriteFile(configFile, updated, 0o644); err != nil {
			return err
		}
	}

	if !found {
		return fmt.Errorf("agent %q not found", name)
	}
	return nil
}

func DeleteAgent(fsStore *storage.FS, name string, status string) error {
	if isBuiltinLeadAgent(name) {
		return fmt.Errorf("agent %q is reserved and cannot be deleted", builtinLeadAgentName)
	}

	targetStatuses := []string{"dev", "prod"}
	if status != "" {
		targetStatuses = []string{status}
	}

	deleted := false
	for _, item := range targetStatuses {
		targetDir := fsStore.AgentDir(name, item)
		if info, err := os.Stat(targetDir); err == nil && info.IsDir() {
			if err := os.RemoveAll(targetDir); err != nil {
				return err
			}
			deleted = true
		}
	}
	if !deleted {
		return fmt.Errorf("agent %q not found", name)
	}
	return nil
}

func statusRoots(fsStore *storage.FS, status string) []string {
	switch strings.TrimSpace(status) {
	case "dev":
		return []string{
			fsStore.SystemAgentsDir("dev"),
			fsStore.CustomAgentsDir("dev"),
		}
	case "prod":
		return []string{
			fsStore.SystemAgentsDir("prod"),
			fsStore.CustomAgentsDir("prod"),
		}
	default:
		return []string{
			fsStore.SystemAgentsDir("dev"),
			fsStore.CustomAgentsDir("dev"),
			fsStore.SystemAgentsDir("prod"),
			fsStore.CustomAgentsDir("prod"),
		}
	}
}

func rewriteStatus(agentDir string, status string) error {
	configFile := filepath.Join(agentDir, "config.yaml")
	data, err := os.ReadFile(configFile)
	if err != nil {
		return err
	}
	var payload map[string]any
	if err := yaml.Unmarshal(data, &payload); err != nil {
		return err
	}
	payload["status"] = status
	updated, err := yaml.Marshal(payload)
	if err != nil {
		return err
	}
	return os.WriteFile(configFile, updated, 0o644)
}

func defaultMemoryConfig() model.AgentMemoryConfig {
	return model.AgentMemoryConfig{
		Enabled:                 false,
		DebounceSeconds:         30,
		MaxFacts:                100,
		FactConfidenceThreshold: 0.7,
		InjectionEnabled:        true,
		MaxInjectionTokens:      2000,
	}
}

func defaultSubagentDefaults() model.AgentSubagentDefaults {
	return model.AgentSubagentDefaults{
		GeneralPurposeEnabled: true,
	}
}
