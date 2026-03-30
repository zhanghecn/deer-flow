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

var defaultRegularAgentSkillScopes = []string{"store/dev", "store/prod"}

func NewAgentService(fs *storage.FS) *AgentService {
	return &AgentService{fs: fs}
}

func isReservedAgentName(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), builtinLeadAgentName)
}

func allowedArchiveSkillScopes(agentName string, agentStatus string) []string {
	if strings.TrimSpace(agentStatus) == "prod" {
		return []string{"store/prod"}
	}
	return append([]string(nil), defaultRegularAgentSkillScopes...)
}

func regularDevAgentRejectsDuplicateSkillNames(agentName string, agentStatus string) bool {
	return strings.TrimSpace(agentStatus) == "dev"
}

func isScopeAllowed(allowedScopes []string, scope string) bool {
	for _, allowed := range allowedScopes {
		if allowed == scope {
			return true
		}
	}
	return false
}

func normalizeMaterializedPath(materializedPath string) (string, error) {
	cleaned := strings.Trim(strings.TrimSpace(materializedPath), "/")
	if cleaned == "" {
		return "", fmt.Errorf("agent-owned skill refs require materialized_path")
	}

	normalized := path.Clean(cleaned)
	if normalized == "." || normalized == "" {
		return "", fmt.Errorf("agent-owned skill refs require materialized_path")
	}
	if strings.HasPrefix(normalized, "../") || normalized == ".." {
		return "", fmt.Errorf("agent-owned skill refs must stay under skills/")
	}
	if !strings.HasPrefix(normalized, "skills/") && normalized != "skills" {
		return "", fmt.Errorf("agent-owned skill refs must stay under skills/")
	}
	if normalized == "skills" {
		return "", fmt.Errorf("agent-owned skill refs must point to a concrete skills/ path")
	}
	return normalized, nil
}

func parseSkillSourcePath(sourcePath string) (string, string, error) {
	cleaned := strings.Trim(strings.TrimSpace(sourcePath), "/")
	if cleaned == "" {
		return "", "", fmt.Errorf("skill source_path is required")
	}

	normalized := path.Clean(cleaned)
	if normalized == "." || normalized == "" || strings.HasPrefix(normalized, "../") || normalized == ".." {
		return "", "", fmt.Errorf("skill source_path must be a safe relative path")
	}

	for _, prefix := range []string{"store/prod/", "store/dev/"} {
		if !strings.HasPrefix(normalized, prefix) {
			continue
		}
		relativePath := strings.TrimPrefix(normalized, prefix)
		if relativePath == "" || relativePath == "." {
			return "", "", fmt.Errorf("skill source_path must point to a concrete skill directory")
		}
		return strings.TrimSuffix(prefix, "/"), relativePath, nil
	}

	return "", "", fmt.Errorf("skill source_path must start with store/dev/ or store/prod/")
}

func deriveMaterializedPathFromSourcePath(sourcePath string) (string, error) {
	_, relativePath, err := parseSkillSourcePath(sourcePath)
	if err != nil {
		return "", err
	}
	return normalizeMaterializedPath(path.Join("skills", relativePath))
}

func normalizeStringList(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		normalized = append(normalized, value)
		seen[key] = struct{}{}
	}
	return normalized
}

func normalizeOptionalStringList(values []string) []string {
	if values == nil {
		return nil
	}
	return normalizeStringList(values)
}

func normalizeToolNames(values []string) []string {
	return normalizeOptionalStringList(values)
}

func defaultAgentSubagentDefaults() model.AgentSubagentDefaults {
	return model.AgentSubagentDefaults{
		GeneralPurposeEnabled: true,
	}
}

func normalizeAgentSubagentDefaults(cfg *model.AgentSubagentDefaults) model.AgentSubagentDefaults {
	normalized := defaultAgentSubagentDefaults()
	if cfg == nil {
		return normalized
	}
	normalized.GeneralPurposeEnabled = cfg.GeneralPurposeEnabled
	normalized.ToolNames = normalizeToolNames(cfg.ToolNames)
	return normalized
}

func normalizeAgentSubagents(subagents []model.AgentSubagent) ([]model.AgentSubagent, error) {
	if subagents == nil {
		return []model.AgentSubagent{}, nil
	}

	normalized := make([]model.AgentSubagent, 0, len(subagents))
	seen := make(map[string]struct{}, len(subagents))
	for _, subagent := range subagents {
		name := strings.TrimSpace(subagent.Name)
		if name == "" {
			return nil, fmt.Errorf("subagent name is required")
		}
		if strings.EqualFold(name, "general-purpose") {
			return nil, fmt.Errorf("subagent name %q is reserved", name)
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return nil, fmt.Errorf("duplicate subagent name %q", name)
		}
		description := strings.TrimSpace(subagent.Description)
		if description == "" {
			return nil, fmt.Errorf("subagent %q requires description", name)
		}
		systemPrompt := strings.TrimSpace(subagent.SystemPrompt)
		if systemPrompt == "" {
			return nil, fmt.Errorf("subagent %q requires system_prompt", name)
		}

		var modelName *string
		if subagent.Model != nil {
			trimmed := strings.TrimSpace(*subagent.Model)
			if trimmed != "" {
				modelName = &trimmed
			}
		}

		normalized = append(normalized, model.AgentSubagent{
			Name:         name,
			Description:  description,
			SystemPrompt: systemPrompt,
			Model:        modelName,
			ToolNames:    normalizeToolNames(subagent.ToolNames),
			Enabled:      subagent.Enabled,
		})
		seen[key] = struct{}{}
	}
	return normalized, nil
}

func (s *AgentService) validateMainToolNames(toolNames []string) ([]string, error) {
	normalized := normalizeToolNames(toolNames)
	if normalized == nil {
		return nil, nil
	}

	index, err := s.toolCatalogByName()
	if err != nil {
		return nil, err
	}
	for _, toolName := range normalized {
		item, ok := index[toolName]
		if !ok {
			return nil, fmt.Errorf("unknown tool %q", toolName)
		}
		if !item.ConfigurableForMainAgent || item.ReservedPolicy == "runtime_only" {
			return nil, fmt.Errorf("tool %q is not configurable for archived agents", toolName)
		}
	}
	return normalized, nil
}

func (s *AgentService) validateSubagentToolNames(toolNames []string) ([]string, error) {
	normalized := normalizeToolNames(toolNames)
	if normalized == nil {
		return nil, nil
	}

	index, err := s.toolCatalogByName()
	if err != nil {
		return nil, err
	}
	for _, toolName := range normalized {
		item, ok := index[toolName]
		if !ok {
			return nil, fmt.Errorf("unknown tool %q", toolName)
		}
		if !item.ConfigurableForSubagent || item.ReservedPolicy != "normal" {
			return nil, fmt.Errorf("tool %q is not allowed for subagents", toolName)
		}
	}
	return normalized, nil
}

func (s *AgentService) validateToolScopes(
	toolNames []string,
	subagentDefaults model.AgentSubagentDefaults,
	subagents []model.AgentSubagent,
) (model.AgentSubagentDefaults, []model.AgentSubagent, error) {
	normalizedDefaults := normalizeAgentSubagentDefaults(&subagentDefaults)
	validatedToolNames, err := s.validateMainToolNames(toolNames)
	if err != nil {
		return model.AgentSubagentDefaults{}, nil, err
	}
	_ = validatedToolNames

	validatedDefaultTools, err := s.validateSubagentToolNames(normalizedDefaults.ToolNames)
	if err != nil {
		return model.AgentSubagentDefaults{}, nil, err
	}
	normalizedDefaults.ToolNames = validatedDefaultTools

	normalizedSubagents, err := normalizeAgentSubagents(subagents)
	if err != nil {
		return model.AgentSubagentDefaults{}, nil, err
	}
	for i := range normalizedSubagents {
		validatedSubagentTools, err := s.validateSubagentToolNames(normalizedSubagents[i].ToolNames)
		if err != nil {
			return model.AgentSubagentDefaults{}, nil, fmt.Errorf("subagent %q: %w", normalizedSubagents[i].Name, err)
		}
		normalizedSubagents[i].ToolNames = validatedSubagentTools
	}
	return normalizedDefaults, normalizedSubagents, nil
}

func (s *AgentService) Create(_ context.Context, req model.CreateAgentRequest, _ uuid.UUID) (*model.Agent, error) {
	name := strings.TrimSpace(req.Name)
	if isReservedAgentName(name) {
		return nil, fmt.Errorf("agent %q is reserved for the built-in lead agent", name)
	}
	if agentfs.AgentExists(s.fs, name) {
		return nil, fmt.Errorf("agent %q already exists", name)
	}

	var skillRefs []model.SkillRef
	var err error
	if req.SkillRefs != nil {
		skillRefs, err = s.normalizeSkillRefs(req.SkillRefs, name, "dev")
	} else {
		skillRefs, err = s.resolveSkillRefsByNames(req.Skills, name, "dev")
	}
	if err != nil {
		return nil, err
	}

	memoryConfig, err := normalizeAgentMemoryConfig(req.Memory)
	if err != nil {
		return nil, err
	}
	mainToolNames, err := s.validateMainToolNames(req.ToolNames)
	if err != nil {
		return nil, err
	}
	subagentDefaults := normalizeAgentSubagentDefaults(req.SubagentDefaults)
	subagentDefaults.ToolNames, err = s.validateSubagentToolNames(subagentDefaults.ToolNames)
	if err != nil {
		return nil, err
	}
	subagents, err := normalizeAgentSubagents(req.Subagents)
	if err != nil {
		return nil, err
	}
	for i := range subagents {
		subagents[i].ToolNames, err = s.validateSubagentToolNames(subagents[i].ToolNames)
		if err != nil {
			return nil, fmt.Errorf("subagent %q: %w", subagents[i].Name, err)
		}
	}

	agent := &model.Agent{
		Name:             name,
		Description:      req.Description,
		Model:            req.Model,
		ToolGroups:       normalizeOptionalStringList(req.ToolGroups),
		ToolNames:        mainToolNames,
		McpServers:       normalizeOptionalStringList(req.McpServers),
		Status:           "dev",
		Memory:           &memoryConfig,
		SubagentDefaults: &subagentDefaults,
		Subagents:        subagents,
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
		existing.ToolGroups = normalizeOptionalStringList(req.ToolGroups)
	}
	if req.ToolNames != nil {
		existing.ToolNames, err = s.validateMainToolNames(req.ToolNames)
		if err != nil {
			return nil, err
		}
	}
	if req.McpServers != nil {
		existing.McpServers = normalizeOptionalStringList(req.McpServers)
	}
	if req.Memory != nil {
		memoryConfig, err := normalizeAgentMemoryConfig(req.Memory)
		if err != nil {
			return nil, err
		}
		existing.Memory = &memoryConfig
	}
	if existing.SubagentDefaults == nil {
		normalizedDefaults := defaultAgentSubagentDefaults()
		existing.SubagentDefaults = &normalizedDefaults
	}
	if req.SubagentDefaults != nil {
		normalizedDefaults := normalizeAgentSubagentDefaults(req.SubagentDefaults)
		normalizedDefaults.ToolNames, err = s.validateSubagentToolNames(normalizedDefaults.ToolNames)
		if err != nil {
			return nil, err
		}
		existing.SubagentDefaults = &normalizedDefaults
	}
	if req.Subagents != nil {
		subagents, err := normalizeAgentSubagents(req.Subagents)
		if err != nil {
			return nil, err
		}
		for i := range subagents {
			subagents[i].ToolNames, err = s.validateSubagentToolNames(subagents[i].ToolNames)
			if err != nil {
				return nil, fmt.Errorf("subagent %q: %w", subagents[i].Name, err)
			}
		}
		existing.Subagents = subagents
	}

	skillRefs, err := s.normalizeSkillRefs(existing.Skills, name, status)
	if err != nil {
		return nil, err
	}
	if req.SkillRefs != nil {
		skillRefs, err = s.normalizeSkillRefs(req.SkillRefs, name, status)
		if err != nil {
			return nil, err
		}
	} else if req.Skills != nil {
		skillRefs, err = s.resolveSkillRefsByNames(req.Skills, name, status)
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

func (s *AgentService) resolveSkillRefsByNames(names []string, agentName string, agentStatus string) ([]model.SkillRef, error) {
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
		ref, err := s.resolveSkillRefByName(trimmed, agentName, agentStatus)
		if err != nil {
			return nil, err
		}
		resolved = append(resolved, ref)
		seen[key] = struct{}{}
	}
	return resolved, nil
}

func (s *AgentService) resolveSkillRefByName(name string, agentName string, agentStatus string) (model.SkillRef, error) {
	allowedScopes := allowedArchiveSkillScopes(agentName, agentStatus)
	matches := make([]model.SkillRef, 0, 3)
	for _, scope := range allowedScopes {
		if ref, ok := s.skillRefFromScope(name, scope); ok {
			matches = append(matches, ref)
		}
	}

	switch len(matches) {
	case 0:
		return model.SkillRef{}, fmt.Errorf("skill %q not found in %s", name, strings.Join(allowedScopes, ", "))
	case 1:
		return matches[0], nil
	default:
		if regularDevAgentRejectsDuplicateSkillNames(agentName, agentStatus) {
			return model.SkillRef{}, fmt.Errorf(
				"skill %q exists in both store/dev and store/prod; attach it with an explicit source_path",
				name,
			)
		}
		scopes := make([]string, 0, len(matches))
		for _, match := range matches {
			scopes = append(scopes, match.Category)
		}
		return model.SkillRef{}, fmt.Errorf("skill %q is ambiguous across %s", name, strings.Join(scopes, ", "))
	}
}

func (s *AgentService) normalizeSkillRefs(refs []model.SkillRef, agentName string, agentStatus string) ([]model.SkillRef, error) {
	normalized := make([]model.SkillRef, 0, len(refs))
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		norm, err := s.normalizeSkillRef(ref, agentName, agentStatus)
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

func (s *AgentService) normalizeSkillRef(ref model.SkillRef, agentName string, agentStatus string) (model.SkillRef, error) {
	name := strings.TrimSpace(ref.Name)
	if name == "" {
		return model.SkillRef{}, fmt.Errorf("skill ref name is required")
	}

	category := strings.Trim(strings.TrimSpace(ref.Category), "/")
	sourcePath := strings.Trim(strings.TrimSpace(ref.SourcePath), "/")
	materializedPath := strings.Trim(strings.TrimSpace(ref.MaterializedPath), "/")

	if category == "" && sourcePath == "" && materializedPath != "" {
		normalizedPath, err := normalizeMaterializedPath(materializedPath)
		if err != nil {
			return model.SkillRef{}, fmt.Errorf("skill %q: %w", name, err)
		}
		return model.SkillRef{
			Name:             name,
			MaterializedPath: normalizedPath,
		}, nil
	}

	if sourcePath != "" {
		derivedCategory, derivedRelativePath, err := parseSkillSourcePath(sourcePath)
		if err != nil {
			return model.SkillRef{}, fmt.Errorf("skill %q: %w", name, err)
		}
		category = derivedCategory
		materializedPath = path.Join("skills", derivedRelativePath)
	}

	switch {
	case category == "" && ref.Status != "":
		if ref.Status == "prod" {
			category = "store/prod"
		} else {
			category = "store/dev"
		}
	case category == "":
		return s.resolveSkillRefByName(name, agentName, agentStatus)
	}

	allowedScopes := allowedArchiveSkillScopes(agentName, agentStatus)
	if !isScopeAllowed(allowedScopes, category) {
		return model.SkillRef{}, fmt.Errorf(
			"skill %q from %s is not allowed for %s agent archives",
			name,
			category,
			strings.TrimSpace(agentStatus),
		)
	}
	if sourcePath == "" {
		sourcePath = path.Join(category, name)
	}

	normalized := model.SkillRef{
		Name:             name,
		Status:           ref.Status,
		Category:         category,
		SourcePath:       path.Clean(sourcePath),
		MaterializedPath: materializedPath,
	}
	if normalized.MaterializedPath == "" {
		if normalized.SourcePath != "" {
			derivedPath, err := deriveMaterializedPathFromSourcePath(normalized.SourcePath)
			if err != nil {
				return model.SkillRef{}, fmt.Errorf("skill %q: %w", name, err)
			}
			normalized.MaterializedPath = derivedPath
		} else {
			normalized.MaterializedPath = path.Join("skills", name)
		}
	} else {
		normalizedPath, err := normalizeMaterializedPath(normalized.MaterializedPath)
		if err != nil {
			return model.SkillRef{}, fmt.Errorf("skill %q: %w", name, err)
		}
		normalized.MaterializedPath = normalizedPath
	}
	if normalized.Status == "" {
		switch category {
		case "store/dev":
			normalized.Status = "dev"
		case "store/prod":
			normalized.Status = "prod"
		}
	}

	if sourcePath != "" {
		sourceDir := filepath.Join(s.fs.SkillsDir(), filepath.FromSlash(sourcePath))
		info, err := os.Stat(sourceDir)
		if err != nil || !info.IsDir() {
			return model.SkillRef{}, fmt.Errorf("skill %q not found in %s", name, sourcePath)
		}
		return normalized, nil
	}

	if _, ok := s.skillRefFromScope(name, category); !ok && strings.TrimSpace(ref.SourcePath) == "" {
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

func isAgentOwnedSkillRef(ref model.SkillRef) bool {
	return strings.TrimSpace(ref.SourcePath) == "" &&
		strings.TrimSpace(ref.Category) == "" &&
		strings.TrimSpace(ref.MaterializedPath) != ""
}

func skillRefStageKey(ref model.SkillRef) string {
	return strings.ToLower(strings.TrimSpace(ref.Name)) + "|" + strings.TrimSpace(ref.MaterializedPath)
}

func (s *AgentService) stageAgentOwnedSkillSources(agent *model.Agent, skillRefs []model.SkillRef) (map[string]string, []string, error) {
	staged := make(map[string]string)
	cleanupDirs := make([]string, 0)
	for _, ref := range skillRefs {
		if !isAgentOwnedSkillRef(ref) {
			continue
		}

		sourceDir := filepath.Join(
			s.fs.AgentDir(agent.Name, agent.Status),
			filepath.FromSlash(strings.TrimSpace(ref.MaterializedPath)),
		)
		info, err := os.Stat(sourceDir)
		if err != nil || !info.IsDir() {
			return nil, cleanupDirs, fmt.Errorf(
				"agent-owned skill %q is missing copied files: %s",
				ref.Name,
				ref.MaterializedPath,
			)
		}

		stageRoot, err := os.MkdirTemp("", "openagents-agent-skill-*")
		if err != nil {
			return nil, cleanupDirs, err
		}
		stageDir := filepath.Join(stageRoot, "skill")
		if err := s.fs.CopyDir(sourceDir, stageDir); err != nil {
			_ = os.RemoveAll(stageRoot)
			return nil, cleanupDirs, err
		}
		staged[skillRefStageKey(ref)] = stageDir
		cleanupDirs = append(cleanupDirs, stageRoot)
	}
	return staged, cleanupDirs, nil
}

func (s *AgentService) resolveSkillSourceDir(agent *model.Agent, ref model.SkillRef, stagedAgentSkills map[string]string) string {
	if isAgentOwnedSkillRef(ref) {
		return stagedAgentSkills[skillRefStageKey(ref)]
	}
	sourcePath := strings.Trim(strings.TrimSpace(ref.SourcePath), "/")
	if sourcePath != "" {
		return filepath.Join(s.fs.SkillsDir(), filepath.FromSlash(sourcePath))
	}
	return s.fs.GlobalSkillDir(ref.Category, ref.Name)
}

func (s *AgentService) resolveSkillTargetDir(agent *model.Agent, ref model.SkillRef) string {
	materializedPath := strings.TrimSpace(ref.MaterializedPath)
	if materializedPath == "" {
		materializedPath = path.Join("skills", ref.Name)
	}
	return filepath.Join(s.fs.AgentDir(agent.Name, agent.Status), filepath.FromSlash(materializedPath))
}

func (s *AgentService) syncAgentFilesystem(agent *model.Agent, agentsMD string, skillRefs []model.SkillRef) error {
	stagedAgentSkills, cleanupDirs, err := s.stageAgentOwnedSkillSources(agent, skillRefs)
	if err != nil {
		return err
	}
	defer func() {
		for _, cleanupDir := range cleanupDirs {
			_ = os.RemoveAll(cleanupDir)
		}
	}()

	config := map[string]interface{}{
		"name":              agent.Name,
		"description":       agent.Description,
		"status":            agent.Status,
		"agents_md_path":    "AGENTS.md",
		"skill_refs":        skillRefs,
		"memory":            agentMemoryPayload(agent.Memory),
		"subagent_defaults": agentSubagentDefaultsPayload(agent.SubagentDefaults),
	}
	if agent.Model != nil {
		config["model"] = *agent.Model
	}
	if agent.ToolGroups != nil {
		config["tool_groups"] = agent.ToolGroups
	}
	if agent.ToolNames != nil {
		config["tool_names"] = agent.ToolNames
	}
	if agent.McpServers != nil {
		config["mcp_servers"] = agent.McpServers
	}

	if err := s.fs.WriteAgentFiles(agent.Name, agent.Status, agentsMD, config); err != nil {
		return err
	}
	if len(agent.Subagents) > 0 {
		if err := s.fs.WriteAgentSubagentsFile(agent.Name, agent.Status, agentSubagentsPayload(agent.Subagents)); err != nil {
			return err
		}
	} else if err := s.fs.DeleteAgentSubagentsFile(agent.Name, agent.Status); err != nil {
		return err
	}
	if err := s.fs.DeleteAgentSkillsDir(agent.Name, agent.Status); err != nil {
		return err
	}
	if err := os.MkdirAll(s.fs.AgentSkillsDir(agent.Name, agent.Status), 0o755); err != nil {
		return err
	}

	for _, ref := range skillRefs {
		sourceDir := s.resolveSkillSourceDir(agent, ref, stagedAgentSkills)
		info, err := os.Stat(sourceDir)
		if err != nil || !info.IsDir() {
			location := ref.Category
			if strings.TrimSpace(ref.SourcePath) != "" {
				location = ref.SourcePath
			} else if strings.TrimSpace(ref.MaterializedPath) != "" {
				location = ref.MaterializedPath
			}
			return fmt.Errorf("skill %q not found in %s", ref.Name, location)
		}
		targetDir := s.resolveSkillTargetDir(agent, ref)
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
	if agent.SubagentDefaults == nil {
		normalized := defaultAgentSubagentDefaults()
		agent.SubagentDefaults = &normalized
	}
	if agent.Subagents == nil {
		agent.Subagents = []model.AgentSubagent{}
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

func agentSubagentDefaultsPayload(cfg *model.AgentSubagentDefaults) map[string]interface{} {
	normalized := defaultAgentSubagentDefaults()
	if cfg != nil {
		normalized = normalizeAgentSubagentDefaults(cfg)
	}

	payload := map[string]interface{}{
		"general_purpose_enabled": normalized.GeneralPurposeEnabled,
	}
	if normalized.ToolNames != nil {
		payload["tool_names"] = normalized.ToolNames
	}
	return payload
}

func agentSubagentsPayload(subagents []model.AgentSubagent) map[string]interface{} {
	payload := map[string]interface{}{
		"version":   1,
		"subagents": map[string]interface{}{},
	}
	items := make(map[string]interface{}, len(subagents))
	for _, subagent := range subagents {
		item := map[string]interface{}{
			"description":   subagent.Description,
			"system_prompt": subagent.SystemPrompt,
			"enabled":       subagent.Enabled,
		}
		if subagent.Model != nil && strings.TrimSpace(*subagent.Model) != "" {
			item["model"] = strings.TrimSpace(*subagent.Model)
		}
		if subagent.ToolNames != nil {
			item["tool_names"] = subagent.ToolNames
		}
		items[subagent.Name] = item
	}
	payload["subagents"] = items
	return payload
}
