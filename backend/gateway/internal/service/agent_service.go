package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
	"gopkg.in/yaml.v3"
)

type AgentService struct {
	fs *storage.FS
}

type diskAgentConfig struct {
	Name        string                   `yaml:"name"`
	Description string                   `yaml:"description"`
	Model       *string                  `yaml:"model"`
	ToolGroups  []string                 `yaml:"tool_groups"`
	McpServers  []string                 `yaml:"mcp_servers"`
	Status      string                   `yaml:"status"`
	AgentsMD    string                   `yaml:"agents_md_path"`
	Memory      *model.AgentMemoryConfig `yaml:"memory"`
	SkillRefs   []model.SkillRef         `yaml:"skill_refs"`
}

const builtinLeadAgentName = "lead_agent"

func NewAgentService(fs *storage.FS) *AgentService {
	return &AgentService{fs: fs}
}

func isReservedAgentName(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), builtinLeadAgentName)
}

func (s *AgentService) Create(_ context.Context, req model.CreateAgentRequest, _ uuid.UUID) (*model.Agent, error) {
	name := strings.TrimSpace(req.Name)
	if isReservedAgentName(name) {
		return nil, fmt.Errorf("agent %q is reserved for the built-in lead agent", name)
	}
	if s.agentExists(name) {
		return nil, fmt.Errorf("agent %q already exists", name)
	}

	skillRefs, err := s.resolveSkillRefsByNames(req.Skills)
	if err != nil {
		return nil, err
	}

	memoryConfig, err := normalizeAgentMemoryConfig(req.Memory)
	if err != nil {
		return nil, err
	}

	agent := &model.Agent{
		Name:        name,
		DisplayName: strPtr(req.DisplayName),
		Description: req.Description,
		AvatarURL:   req.AvatarURL,
		Model:       req.Model,
		ToolGroups:  req.ToolGroups,
		McpServers:  req.McpServers,
		Status:      "dev",
		Memory:      &memoryConfig,
	}
	agent.ConfigJSON = s.mustMarshalConfig(agent, skillRefs)

	if err := s.syncAgentFilesystem(agent, req.AgentsMD, skillRefs); err != nil {
		return nil, fmt.Errorf("sync agent files: %w", err)
	}
	return s.hydrateFilesystemAgent(agent, req.AgentsMD, skillRefs), nil
}

func (s *AgentService) Update(_ context.Context, name string, status string, req model.UpdateAgentRequest) (*model.Agent, error) {
	existing, err := s.loadAgent(name, status, true)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, fmt.Errorf("agent %q (%s) not found", name, status)
	}

	if req.DisplayName != nil {
		existing.DisplayName = req.DisplayName
	}
	if req.Description != nil {
		existing.Description = *req.Description
	}
	if req.AvatarURL != nil {
		existing.AvatarURL = req.AvatarURL
	}
	if req.Model != nil {
		existing.Model = req.Model
	}
	if req.ToolGroups != nil {
		existing.ToolGroups = req.ToolGroups
	}
	if req.McpServers != nil {
		existing.McpServers = req.McpServers
	}
	if req.Memory != nil {
		memoryConfig, err := normalizeAgentMemoryConfig(req.Memory)
		if err != nil {
			return nil, err
		}
		existing.Memory = &memoryConfig
	}

	skillRefs, err := s.normalizeSkillRefs(existing.Skills)
	if err != nil {
		return nil, err
	}
	if req.Skills != nil {
		skillRefs, err = s.resolveSkillRefsByNames(req.Skills)
		if err != nil {
			return nil, err
		}
	}

	agentsMDContent := existing.AgentsMD
	if req.AgentsMD != nil {
		agentsMDContent = *req.AgentsMD
	}

	existing.ConfigJSON = s.mustMarshalConfig(existing, skillRefs)
	if err := s.syncAgentFilesystem(existing, agentsMDContent, skillRefs); err != nil {
		return nil, fmt.Errorf("sync agent files: %w", err)
	}
	return s.hydrateFilesystemAgent(existing, agentsMDContent, skillRefs), nil
}

func (s *AgentService) agentExists(name string) bool {
	for _, status := range []string{"dev", "prod"} {
		info, err := os.Stat(s.fs.AgentDir(name, status))
		if err == nil && info.IsDir() {
			return true
		}
	}
	return false
}

func (s *AgentService) loadAgent(name string, status string, includeMarkdown bool) (*model.Agent, error) {
	configFile := filepath.Join(s.fs.AgentDir(name, status), "config.yaml")
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

	var cfg diskAgentConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	agentName := strings.TrimSpace(cfg.Name)
	if agentName == "" {
		agentName = name
	}

	skillRefs, err := s.normalizeSkillRefs(cfg.SkillRefs)
	if err != nil {
		return nil, err
	}

	agent := &model.Agent{
		Name:        agentName,
		DisplayName: nil,
		Description: cfg.Description,
		Model:       cfg.Model,
		ToolGroups:  cfg.ToolGroups,
		McpServers:  cfg.McpServers,
		Status:      status,
		Memory:      cfg.Memory,
		AgentsMDRef: s.fs.AgentMDRef(agentName, status),
		Skills:      skillRefs,
	}
	if agent.Memory == nil {
		normalized := defaultAgentMemoryConfig()
		agent.Memory = &normalized
	}
	agent.ConfigJSON = s.mustMarshalConfig(agent, skillRefs)

	if includeMarkdown {
		agentsMDPath := strings.TrimSpace(cfg.AgentsMD)
		if agentsMDPath == "" {
			agentsMDPath = "AGENTS.md"
		}
		markdownPath := filepath.Join(s.fs.AgentDir(agentName, status), filepath.Clean(agentsMDPath))
		markdown, err := os.ReadFile(markdownPath)
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		agent.AgentsMD = string(markdown)
	}

	return agent, nil
}

func (s *AgentService) resolveSkillRefsByNames(names []string) ([]model.SkillRef, error) {
	resolved := make([]model.SkillRef, 0, len(names))
	seen := make(map[string]struct{}, len(names))
	for _, name := range names {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		ref, err := s.resolveSkillRefByName(trimmed)
		if err != nil {
			return nil, err
		}
		resolved = append(resolved, ref)
		seen[key] = struct{}{}
	}
	return resolved, nil
}

func (s *AgentService) resolveSkillRefByName(name string) (model.SkillRef, error) {
	matches := make([]model.SkillRef, 0, 3)
	for _, scope := range []string{"shared", "store/dev", "store/prod"} {
		if ref, ok := s.skillRefFromScope(name, scope); ok {
			matches = append(matches, ref)
		}
	}

	switch len(matches) {
	case 0:
		return model.SkillRef{}, fmt.Errorf("skill %q not found", name)
	case 1:
		return matches[0], nil
	default:
		scopes := make([]string, 0, len(matches))
		for _, match := range matches {
			scopes = append(scopes, match.Category)
		}
		return model.SkillRef{}, fmt.Errorf("skill %q is ambiguous across %s", name, strings.Join(scopes, ", "))
	}
}

func (s *AgentService) normalizeSkillRefs(refs []model.SkillRef) ([]model.SkillRef, error) {
	normalized := make([]model.SkillRef, 0, len(refs))
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		norm, err := s.normalizeSkillRef(ref)
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(norm.Name)
		if _, ok := seen[key]; ok {
			continue
		}
		normalized = append(normalized, norm)
		seen[key] = struct{}{}
	}
	return normalized, nil
}

func (s *AgentService) normalizeSkillRef(ref model.SkillRef) (model.SkillRef, error) {
	name := strings.TrimSpace(ref.Name)
	if name == "" {
		return model.SkillRef{}, fmt.Errorf("skill ref name is required")
	}

	category := strings.Trim(strings.TrimSpace(ref.Category), "/")
	sourcePath := strings.Trim(strings.TrimSpace(ref.SourcePath), "/")

	switch {
	case category == "" && sourcePath != "":
		if path.Base(sourcePath) == name {
			category = path.Dir(sourcePath)
		} else {
			category = sourcePath
		}
	case category == "" && ref.Status != "":
		if ref.Status == "prod" {
			category = "store/prod"
		} else {
			category = "store/dev"
		}
	case category == "":
		return s.resolveSkillRefByName(name)
	}

	if sourcePath == "" {
		sourcePath = path.Join(category, name)
	}

	normalized := model.SkillRef{
		Name:             name,
		Status:           ref.Status,
		Category:         category,
		SourcePath:       path.Clean(sourcePath),
		MaterializedPath: ref.MaterializedPath,
	}
	if normalized.MaterializedPath == "" {
		normalized.MaterializedPath = path.Join("skills", name)
	}
	if normalized.Status == "" {
		switch category {
		case "store/dev":
			normalized.Status = "dev"
		case "store/prod":
			normalized.Status = "prod"
		}
	}
	if _, ok := s.skillRefFromScope(name, category); !ok {
		return model.SkillRef{}, fmt.Errorf("skill %q not found in %s", name, category)
	}
	return normalized, nil
}

func (s *AgentService) skillRefFromScope(name string, scope string) (model.SkillRef, bool) {
	skillMD := filepath.Join(s.fs.GlobalSkillDir(scope, name), "SKILL.md")
	info, err := os.Stat(skillMD)
	if err != nil || info.IsDir() {
		return model.SkillRef{}, false
	}

	status := ""
	switch scope {
	case "store/dev":
		status = "dev"
	case "store/prod":
		status = "prod"
	}

	return model.SkillRef{
		Name:             name,
		Status:           status,
		Category:         scope,
		SourcePath:       path.Join(scope, name),
		MaterializedPath: path.Join("skills", name),
	}, true
}

func (s *AgentService) syncAgentFilesystem(agent *model.Agent, agentsMD string, skillRefs []model.SkillRef) error {
	config := map[string]interface{}{
		"name":           agent.Name,
		"description":    agent.Description,
		"status":         agent.Status,
		"agents_md_path": "AGENTS.md",
		"skill_refs":     skillRefs,
		"memory":         agentMemoryPayload(agent.Memory),
	}
	if agent.Model != nil {
		config["model"] = *agent.Model
	}
	if agent.ToolGroups != nil {
		config["tool_groups"] = agent.ToolGroups
	}
	if agent.McpServers != nil {
		config["mcp_servers"] = agent.McpServers
	}

	if err := s.fs.WriteAgentFiles(agent.Name, agent.Status, agentsMD, config); err != nil {
		return err
	}
	if err := s.fs.DeleteAgentSkillsDir(agent.Name, agent.Status); err != nil {
		return err
	}
	if err := os.MkdirAll(s.fs.AgentSkillsDir(agent.Name, agent.Status), 0755); err != nil {
		return err
	}

	for _, ref := range skillRefs {
		sourceDir := s.fs.GlobalSkillDir(ref.Category, ref.Name)
		info, err := os.Stat(sourceDir)
		if err != nil || !info.IsDir() {
			return fmt.Errorf("skill %q not found in %s", ref.Name, ref.Category)
		}
		targetDir := filepath.Join(s.fs.AgentSkillsDir(agent.Name, agent.Status), ref.Name)
		if err := s.fs.CopyDir(sourceDir, targetDir); err != nil {
			return err
		}
	}

	agent.AgentsMDRef = s.fs.AgentMDRef(agent.Name, agent.Status)
	agent.AgentsMD = agentsMD
	agent.Skills = append([]model.SkillRef(nil), skillRefs...)
	return nil
}

func (s *AgentService) hydrateFilesystemAgent(agent *model.Agent, agentsMD string, skillRefs []model.SkillRef) *model.Agent {
	agent.AgentsMDRef = s.fs.AgentMDRef(agent.Name, agent.Status)
	agent.AgentsMD = agentsMD
	agent.Skills = append([]model.SkillRef(nil), skillRefs...)
	if agent.Memory == nil {
		normalized := defaultAgentMemoryConfig()
		agent.Memory = &normalized
	}
	agent.ConfigJSON = s.mustMarshalConfig(agent, skillRefs)
	return agent
}

func (s *AgentService) mustMarshalConfig(agent *model.Agent, skillRefs []model.SkillRef) json.RawMessage {
	payload := map[string]interface{}{
		"name":            agent.Name,
		"description":     agent.Description,
		"status":          agent.Status,
		"agents_md_ref":   s.fs.AgentMDRef(agent.Name, agent.Status),
		"agents_md_path":  "AGENTS.md",
		"selected_skills": collectSkillRefNames(skillRefs),
		"skill_refs":      skillRefs,
		"memory":          agentMemoryPayload(agent.Memory),
	}
	if agent.Model != nil {
		payload["model"] = *agent.Model
	}
	if agent.ToolGroups != nil {
		payload["tool_groups"] = agent.ToolGroups
	}
	if agent.McpServers != nil {
		payload["mcp_servers"] = agent.McpServers
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage("{}")
	}
	return data
}

func collectSkillRefNames(skills []model.SkillRef) []string {
	names := make([]string, 0, len(skills))
	for _, skill := range skills {
		names = append(names, skill.Name)
	}
	return names
}

func collectSkillNames(skills []model.Skill) []string {
	names := make([]string, 0, len(skills))
	for _, skill := range skills {
		names = append(names, skill.Name)
	}
	return names
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func defaultAgentMemoryConfig() model.AgentMemoryConfig {
	return model.AgentMemoryConfig{
		Enabled:                 false,
		DebounceSeconds:         30,
		MaxFacts:                100,
		FactConfidenceThreshold: 0.7,
		InjectionEnabled:        true,
		MaxInjectionTokens:      2000,
	}
}

func normalizeAgentMemoryConfig(cfg *model.AgentMemoryConfig) (model.AgentMemoryConfig, error) {
	normalized := defaultAgentMemoryConfig()
	if cfg == nil {
		return normalized, nil
	}

	normalized.Enabled = cfg.Enabled
	normalized.ModelName = cfg.ModelName
	if cfg.DebounceSeconds != 0 {
		normalized.DebounceSeconds = cfg.DebounceSeconds
	}
	if cfg.MaxFacts != 0 {
		normalized.MaxFacts = cfg.MaxFacts
	}
	if cfg.FactConfidenceThreshold != 0 {
		normalized.FactConfidenceThreshold = cfg.FactConfidenceThreshold
	}
	normalized.InjectionEnabled = cfg.InjectionEnabled
	if cfg.MaxInjectionTokens != 0 {
		normalized.MaxInjectionTokens = cfg.MaxInjectionTokens
	}

	if normalized.Enabled && (normalized.ModelName == nil || strings.TrimSpace(*normalized.ModelName) == "") {
		return model.AgentMemoryConfig{}, fmt.Errorf("agent memory requires memory.model_name when memory.enabled is true")
	}
	return normalized, nil
}

func agentMemoryPayload(cfg *model.AgentMemoryConfig) map[string]interface{} {
	normalized := defaultAgentMemoryConfig()
	if cfg != nil {
		var err error
		normalized, err = normalizeAgentMemoryConfig(cfg)
		if err != nil {
			panic(err)
		}
	}

	payload := map[string]interface{}{
		"enabled":                   normalized.Enabled,
		"debounce_seconds":          normalized.DebounceSeconds,
		"max_facts":                 normalized.MaxFacts,
		"fact_confidence_threshold": normalized.FactConfidenceThreshold,
		"injection_enabled":         normalized.InjectionEnabled,
		"max_injection_tokens":      normalized.MaxInjectionTokens,
	}
	if normalized.ModelName != nil && strings.TrimSpace(*normalized.ModelName) != "" {
		payload["model_name"] = strings.TrimSpace(*normalized.ModelName)
	}
	return payload
}

func parseAgentMemoryConfig(configJSON json.RawMessage) (model.AgentMemoryConfig, error) {
	normalized := defaultAgentMemoryConfig()
	if len(configJSON) == 0 {
		return normalized, nil
	}

	var payload struct {
		Memory *model.AgentMemoryConfig `json:"memory"`
	}
	if err := json.Unmarshal(configJSON, &payload); err != nil {
		return model.AgentMemoryConfig{}, err
	}
	if payload.Memory == nil {
		return normalized, nil
	}
	return normalizeAgentMemoryConfig(payload.Memory)
}
