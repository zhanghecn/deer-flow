package service

import (
	"context"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/agentfs"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/pkg/storage"
)

type AgentService struct {
	fs *storage.FS
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
	if agentfs.AgentExists(s.fs, name) {
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
		Description: req.Description,
		Model:       req.Model,
		ToolGroups:  req.ToolGroups,
		McpServers:  req.McpServers,
		Status:      "dev",
		Memory:      &memoryConfig,
	}
	if err := s.syncAgentFilesystem(agent, req.AgentsMD, skillRefs); err != nil {
		return nil, fmt.Errorf("sync agent files: %w", err)
	}
	return s.hydrateFilesystemAgent(agent, req.AgentsMD, skillRefs), nil
}

func (s *AgentService) Update(_ context.Context, name string, status string, req model.UpdateAgentRequest) (*model.Agent, error) {
	existing, err := agentfs.LoadAgent(s.fs, name, status, true)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, fmt.Errorf("agent %q (%s) not found", name, status)
	}

	if req.Description != nil {
		existing.Description = *req.Description
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

	if err := s.syncAgentFilesystem(existing, agentsMDContent, skillRefs); err != nil {
		return nil, fmt.Errorf("sync agent files: %w", err)
	}
	return s.hydrateFilesystemAgent(existing, agentsMDContent, skillRefs), nil
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
	if err := os.MkdirAll(s.fs.AgentSkillsDir(agent.Name, agent.Status), 0o755); err != nil {
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

	agent.AgentsMD = agentsMD
	agent.Skills = append([]model.SkillRef(nil), skillRefs...)
	return nil
}

func (s *AgentService) hydrateFilesystemAgent(agent *model.Agent, agentsMD string, skillRefs []model.SkillRef) *model.Agent {
	agent.AgentsMD = agentsMD
	agent.Skills = append([]model.SkillRef(nil), skillRefs...)
	if agent.Memory == nil {
		normalized := defaultAgentMemoryConfig()
		agent.Memory = &normalized
	}
	return agent
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
