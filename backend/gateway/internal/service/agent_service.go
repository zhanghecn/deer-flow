package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type AgentService struct {
	repo      *repository.AgentRepo
	skillRepo *repository.SkillRepo
	fs        *storage.FS
}

const builtinLeadAgentName = "lead_agent"

func NewAgentService(repo *repository.AgentRepo, skillRepo *repository.SkillRepo, fs *storage.FS) *AgentService {
	return &AgentService{repo: repo, skillRepo: skillRepo, fs: fs}
}

func isReservedAgentName(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), builtinLeadAgentName)
}

func (s *AgentService) ExistsName(ctx context.Context, name string) (bool, error) {
	if isReservedAgentName(name) {
		return true, nil
	}
	return s.repo.ExistsName(ctx, name)
}

func (s *AgentService) Create(ctx context.Context, req model.CreateAgentRequest, userID uuid.UUID) (*model.Agent, error) {
	if isReservedAgentName(req.Name) {
		return nil, fmt.Errorf("agent %q is reserved for the built-in lead agent", req.Name)
	}
	exists, err := s.repo.ExistsName(ctx, req.Name)
	if err != nil {
		return nil, fmt.Errorf("check agent existence: %w", err)
	}
	if exists {
		return nil, fmt.Errorf("agent %q already exists", req.Name)
	}

	selectedSkills, err := s.resolveSkills(ctx, req.Skills)
	if err != nil {
		return nil, err
	}

	agent := &model.Agent{
		ID:          uuid.New(),
		Name:        req.Name,
		DisplayName: strPtr(req.DisplayName),
		Description: req.Description,
		AvatarURL:   req.AvatarURL,
		Model:       req.Model,
		ToolGroups:  req.ToolGroups,
		McpServers:  req.McpServers,
		Status:      "dev",
		AgentsMDRef: s.fs.AgentMDRef(req.Name, "dev"),
		CreatedBy:   &userID,
	}
	agent.ConfigJSON = s.mustMarshalConfig(agent, selectedSkills)

	if err := s.syncAgentFilesystem(agent, req.AgentsMD, selectedSkills); err != nil {
		return nil, fmt.Errorf("sync agent files: %w", err)
	}
	if err := s.repo.Create(ctx, agent); err != nil {
		return nil, fmt.Errorf("create agent: %w", err)
	}
	if err := s.repo.ReplaceSkills(ctx, agent.ID, collectSkillIDs(selectedSkills)); err != nil {
		return nil, fmt.Errorf("replace agent skills: %w", err)
	}

	return s.hydrateAgent(ctx, agent)
}

func (s *AgentService) Get(ctx context.Context, name string, status string) (*model.Agent, error) {
	agent, err := s.repo.FindByName(ctx, name, status)
	if err != nil {
		return nil, err
	}
	if agent == nil {
		return nil, nil
	}
	return s.hydrateAgent(ctx, agent)
}

func (s *AgentService) List(ctx context.Context, status string) ([]model.Agent, error) {
	agents, err := s.repo.List(ctx, status)
	if err != nil {
		return nil, err
	}
	for i := range agents {
		hydrated, err := s.hydrateAgent(ctx, &agents[i])
		if err != nil {
			return nil, err
		}
		agents[i] = *hydrated
	}
	return agents, nil
}

func (s *AgentService) Update(ctx context.Context, name string, status string, req model.UpdateAgentRequest) (*model.Agent, error) {
	existing, err := s.repo.FindByName(ctx, name, status)
	if err != nil || existing == nil {
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

	selectedSkillNames, err := s.currentSkillNames(ctx, existing)
	if err != nil {
		return nil, err
	}
	if req.Skills != nil {
		selectedSkillNames = req.Skills
	}

	selectedSkills, err := s.resolveSkills(ctx, selectedSkillNames)
	if err != nil {
		return nil, err
	}

	agentsMDContent, err := s.fs.ReadTextRef(existing.AgentsMDRef)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read agent markdown: %w", err)
	}
	if req.AgentsMD != nil {
		agentsMDContent = *req.AgentsMD
	}

	existing.ConfigJSON = s.mustMarshalConfig(existing, selectedSkills)

	if err := s.syncAgentFilesystem(existing, agentsMDContent, selectedSkills); err != nil {
		return nil, fmt.Errorf("sync agent files: %w", err)
	}
	if err := s.repo.Update(ctx, name, status, existing); err != nil {
		return nil, fmt.Errorf("update agent: %w", err)
	}
	if err := s.repo.ReplaceSkills(ctx, existing.ID, collectSkillIDs(selectedSkills)); err != nil {
		return nil, fmt.Errorf("replace agent skills: %w", err)
	}

	return s.hydrateAgent(ctx, existing)
}

func (s *AgentService) Delete(ctx context.Context, name string, status string) error {
	targetStatuses := []string{status}
	if status == "" {
		targetStatuses = []string{"dev", "prod"}
	}

	deletedAny := false
	for _, targetStatus := range targetStatuses {
		existing, err := s.repo.FindByName(ctx, name, targetStatus)
		if err != nil {
			return err
		}
		if existing == nil {
			continue
		}
		if err := s.repo.Delete(ctx, name, targetStatus); err != nil {
			return err
		}
		_ = s.fs.DeleteAgentDir(name, targetStatus)
		deletedAny = true
	}

	if !deletedAny {
		return fmt.Errorf("agent %q not found", name)
	}
	return nil
}

func (s *AgentService) Publish(ctx context.Context, name string) (*model.Agent, error) {
	devAgent, err := s.repo.FindByName(ctx, name, "dev")
	if err != nil || devAgent == nil {
		return nil, fmt.Errorf("agent %q not found", name)
	}

	devSkills, err := s.repo.GetSkills(ctx, devAgent.ID)
	if err != nil {
		return nil, fmt.Errorf("load dev agent skills: %w", err)
	}
	skillNames := make([]string, 0, len(devSkills))
	for _, skill := range devSkills {
		skillNames = append(skillNames, skill.Name)
	}
	selectedSkills, err := s.resolveSkills(ctx, skillNames)
	if err != nil {
		return nil, err
	}

	agentsMDContent, err := s.fs.ReadTextRef(devAgent.AgentsMDRef)
	if err != nil {
		return nil, fmt.Errorf("read dev AGENTS.md: %w", err)
	}

	prodAgent, err := s.repo.FindByName(ctx, name, "prod")
	if err != nil {
		return nil, err
	}
	if prodAgent == nil {
		prodAgent = &model.Agent{
			ID:          uuid.New(),
			Name:        devAgent.Name,
			DisplayName: devAgent.DisplayName,
			Description: devAgent.Description,
			AvatarURL:   devAgent.AvatarURL,
			Model:       devAgent.Model,
			ToolGroups:  devAgent.ToolGroups,
			McpServers:  devAgent.McpServers,
			Status:      "prod",
			CreatedBy:   devAgent.CreatedBy,
		}
	} else {
		prodAgent.DisplayName = devAgent.DisplayName
		prodAgent.Description = devAgent.Description
		prodAgent.AvatarURL = devAgent.AvatarURL
		prodAgent.Model = devAgent.Model
		prodAgent.ToolGroups = devAgent.ToolGroups
		prodAgent.McpServers = devAgent.McpServers
	}
	prodAgent.AgentsMDRef = s.fs.AgentMDRef(name, "prod")
	prodAgent.ConfigJSON = s.mustMarshalConfig(prodAgent, selectedSkills)

	if err := s.syncAgentFilesystem(prodAgent, agentsMDContent, selectedSkills); err != nil {
		return nil, fmt.Errorf("sync prod agent files: %w", err)
	}
	if existing, _ := s.repo.FindByName(ctx, name, "prod"); existing == nil {
		if err := s.repo.Create(ctx, prodAgent); err != nil {
			return nil, fmt.Errorf("create prod agent: %w", err)
		}
	} else {
		if err := s.repo.Update(ctx, name, "prod", prodAgent); err != nil {
			return nil, fmt.Errorf("update prod agent: %w", err)
		}
	}
	if err := s.repo.ReplaceSkills(ctx, prodAgent.ID, collectSkillIDs(selectedSkills)); err != nil {
		return nil, fmt.Errorf("replace prod agent skills: %w", err)
	}

	return s.hydrateAgent(ctx, prodAgent)
}

func (s *AgentService) resolveSkills(ctx context.Context, names []string) ([]model.Skill, error) {
	uniqueNames := make([]string, 0, len(names))
	for _, name := range names {
		trimmed := name
		if trimmed == "" || slices.Contains(uniqueNames, trimmed) {
			continue
		}
		uniqueNames = append(uniqueNames, trimmed)
	}
	resolved, err := s.skillRepo.FindByNames(ctx, uniqueNames)
	if err != nil {
		return nil, fmt.Errorf("load selected skills: %w", err)
	}
	if len(resolved) != len(uniqueNames) {
		found := map[string]struct{}{}
		for _, skill := range resolved {
			found[skill.Name] = struct{}{}
		}
		for _, name := range uniqueNames {
			if _, ok := found[name]; !ok {
				return nil, fmt.Errorf("skill %q not found", name)
			}
		}
	}
	slices.SortFunc(resolved, func(a, b model.Skill) int {
		if a.Name < b.Name {
			return -1
		}
		if a.Name > b.Name {
			return 1
		}
		return 0
	})
	return resolved, nil
}

func (s *AgentService) currentSkillNames(ctx context.Context, agent *model.Agent) ([]string, error) {
	skillRefs, err := s.repo.GetSkills(ctx, agent.ID)
	if err != nil {
		return nil, fmt.Errorf("load agent skills: %w", err)
	}
	names := make([]string, 0, len(skillRefs))
	for _, ref := range skillRefs {
		names = append(names, ref.Name)
	}
	return names, nil
}

func (s *AgentService) syncAgentFilesystem(agent *model.Agent, agentsMD string, skills []model.Skill) error {
	config := map[string]interface{}{
		"name":           agent.Name,
		"description":    agent.Description,
		"status":         agent.Status,
		"agents_md_path": "AGENTS.md",
		"skill_refs":     s.manifestSkillRefs(skills),
	}
	if agent.Model != nil {
		config["model"] = agent.Model
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
	for _, skill := range skills {
		srcDir := filepath.Dir(s.fs.ResolveRef(skill.SkillMDRef))
		dstDir := filepath.Join(s.fs.AgentSkillsDir(agent.Name, agent.Status), skill.Name)
		if err := s.fs.CopyDir(srcDir, dstDir); err != nil {
			return err
		}
	}

	agent.AgentsMDRef = s.fs.AgentMDRef(agent.Name, agent.Status)
	return nil
}

func (s *AgentService) manifestSkillRefs(skills []model.Skill) []map[string]string {
	refs := make([]map[string]string, 0, len(skills))
	for _, skill := range skills {
		category := "custom"
		if skill.Status == "prod" {
			category = "public"
		}
		refs = append(refs, map[string]string{
			"name":              skill.Name,
			"category":          category,
			"source_path":       filepath.ToSlash(filepath.Join(category, skill.Name)),
			"materialized_path": filepath.ToSlash(filepath.Join("skills", skill.Name)),
		})
	}
	return refs
}

func (s *AgentService) hydrateAgent(ctx context.Context, agent *model.Agent) (*model.Agent, error) {
	agentsMD, err := s.fs.ReadTextRef(agent.AgentsMDRef)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read agent markdown: %w", err)
	}
	agent.AgentsMD = agentsMD

	skillRefs, err := s.repo.GetSkills(ctx, agent.ID)
	if err != nil {
		return nil, fmt.Errorf("load agent skills: %w", err)
	}
	for i := range skillRefs {
		skillRefs[i].MaterializedPath = filepath.ToSlash(filepath.Join("skills", skillRefs[i].Name))
	}
	agent.Skills = skillRefs
	return agent, nil
}

func (s *AgentService) mustMarshalConfig(agent *model.Agent, skills []model.Skill) json.RawMessage {
	payload := map[string]interface{}{
		"name":            agent.Name,
		"description":     agent.Description,
		"status":          agent.Status,
		"agents_md_ref":   s.fs.AgentMDRef(agent.Name, agent.Status),
		"agents_md_path":  "AGENTS.md",
		"selected_skills": collectSkillNames(skills),
		"skill_refs":      s.manifestSkillRefs(skills),
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

func collectSkillIDs(skills []model.Skill) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(skills))
	for _, skill := range skills {
		ids = append(ids, skill.ID)
	}
	return ids
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
