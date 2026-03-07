package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
	"github.com/google/uuid"
)

type AgentService struct {
	repo *repository.AgentRepo
	fs   *storage.FS
}

func NewAgentService(repo *repository.AgentRepo, fs *storage.FS) *AgentService {
	return &AgentService{repo: repo, fs: fs}
}

func (s *AgentService) Create(ctx context.Context, req model.CreateAgentRequest, userID uuid.UUID) (*model.Agent, error) {
	existing, _ := s.repo.FindByName(ctx, req.Name)
	if existing != nil {
		return nil, fmt.Errorf("agent %q already exists", req.Name)
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
		AgentsMD:    req.AgentsMD,
		ConfigJSON:  json.RawMessage("{}"),
		CreatedBy:   &userID,
	}

	if err := s.repo.Create(ctx, agent); err != nil {
		return nil, fmt.Errorf("create agent: %w", err)
	}

	// Sync to filesystem
	config := map[string]interface{}{
		"name":        agent.Name,
		"model":       agent.Model,
		"tool_groups": agent.ToolGroups,
		"mcp_servers": agent.McpServers,
	}
	if err := s.fs.WriteAgentFiles(agent.Name, "dev", agent.AgentsMD, config); err != nil {
		return nil, fmt.Errorf("sync agent files: %w", err)
	}

	return agent, nil
}

func (s *AgentService) Get(ctx context.Context, name string) (*model.AgentResponse, error) {
	agent, err := s.repo.FindByName(ctx, name)
	if err != nil {
		return nil, err
	}
	if agent == nil {
		return nil, nil
	}

	skills, _ := s.repo.GetSkills(ctx, agent.ID)
	return &model.AgentResponse{Agent: *agent, Skills: skills}, nil
}

func (s *AgentService) List(ctx context.Context, status string) ([]model.Agent, error) {
	return s.repo.List(ctx, status)
}

func (s *AgentService) Update(ctx context.Context, name string, req model.UpdateAgentRequest) (*model.Agent, error) {
	existing, err := s.repo.FindByName(ctx, name)
	if err != nil || existing == nil {
		return nil, fmt.Errorf("agent %q not found", name)
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
	if req.AgentsMD != nil {
		existing.AgentsMD = *req.AgentsMD
	}

	if err := s.repo.Update(ctx, name, existing); err != nil {
		return nil, fmt.Errorf("update agent: %w", err)
	}

	// Sync to filesystem
	config := map[string]interface{}{
		"name":        existing.Name,
		"model":       existing.Model,
		"tool_groups": existing.ToolGroups,
		"mcp_servers": existing.McpServers,
	}
	_ = s.fs.WriteAgentFiles(existing.Name, existing.Status, existing.AgentsMD, config)

	return existing, nil
}

func (s *AgentService) Delete(ctx context.Context, name string) error {
	existing, _ := s.repo.FindByName(ctx, name)
	if existing == nil {
		return fmt.Errorf("agent %q not found", name)
	}

	if err := s.repo.Delete(ctx, name); err != nil {
		return err
	}

	// Remove from filesystem (both dev and prod)
	_ = s.fs.DeleteAgentDir(name, "dev")
	_ = s.fs.DeleteAgentDir(name, "prod")
	return nil
}

func (s *AgentService) Publish(ctx context.Context, name string) (*model.Agent, error) {
	existing, err := s.repo.FindByName(ctx, name)
	if err != nil || existing == nil {
		return nil, fmt.Errorf("agent %q not found", name)
	}

	// Copy dev → prod in filesystem
	devDir := s.fs.AgentDir(name, "dev")
	prodDir := s.fs.AgentDir(name, "prod")
	if err := s.fs.CopyDir(devDir, prodDir); err != nil {
		return nil, fmt.Errorf("copy to prod: %w", err)
	}

	if err := s.repo.UpdateStatus(ctx, name, "prod"); err != nil {
		return nil, fmt.Errorf("update status: %w", err)
	}

	existing.Status = "prod"
	return existing, nil
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
