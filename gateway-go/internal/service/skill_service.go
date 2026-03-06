package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/deer-flow/gateway/internal/model"
	"github.com/deer-flow/gateway/internal/repository"
	"github.com/deer-flow/gateway/pkg/storage"
	"github.com/google/uuid"
)

type SkillService struct {
	repo *repository.SkillRepo
	fs   *storage.FS
}

func NewSkillService(repo *repository.SkillRepo, fs *storage.FS) *SkillService {
	return &SkillService{repo: repo, fs: fs}
}

func (s *SkillService) Create(ctx context.Context, req model.CreateSkillRequest, userID uuid.UUID) (*model.Skill, error) {
	existing, _ := s.repo.FindByName(ctx, req.Name)
	if existing != nil {
		return nil, fmt.Errorf("skill %q already exists", req.Name)
	}

	skill := &model.Skill{
		ID:          uuid.New(),
		Name:        req.Name,
		Description: req.Description,
		Status:      "dev",
		SkillMD:     req.SkillMD,
		Metadata:    json.RawMessage("{}"),
		CreatedBy:   &userID,
	}

	if err := s.repo.Create(ctx, skill); err != nil {
		return nil, fmt.Errorf("create skill: %w", err)
	}

	// Sync to filesystem as global custom skill
	_ = s.fs.WriteGlobalSkillFile("custom", skill.Name, skill.SkillMD)

	return skill, nil
}

func (s *SkillService) Get(ctx context.Context, name string) (*model.Skill, error) {
	return s.repo.FindByName(ctx, name)
}

func (s *SkillService) List(ctx context.Context, status string) ([]model.Skill, error) {
	return s.repo.List(ctx, status)
}

func (s *SkillService) Update(ctx context.Context, name string, req model.UpdateSkillRequest) (*model.Skill, error) {
	existing, err := s.repo.FindByName(ctx, name)
	if err != nil || existing == nil {
		return nil, fmt.Errorf("skill %q not found", name)
	}

	if req.Description != nil {
		existing.Description = *req.Description
	}
	if req.SkillMD != nil {
		existing.SkillMD = *req.SkillMD
	}

	if err := s.repo.Update(ctx, name, existing); err != nil {
		return nil, fmt.Errorf("update skill: %w", err)
	}

	_ = s.fs.WriteGlobalSkillFile("custom", name, existing.SkillMD)
	return existing, nil
}

func (s *SkillService) Delete(ctx context.Context, name string) error {
	if err := s.repo.Delete(ctx, name); err != nil {
		return err
	}
	return nil
}

func (s *SkillService) Publish(ctx context.Context, name string) (*model.Skill, error) {
	existing, err := s.repo.FindByName(ctx, name)
	if err != nil || existing == nil {
		return nil, fmt.Errorf("skill %q not found", name)
	}

	if err := s.repo.UpdateStatus(ctx, name, "prod"); err != nil {
		return nil, fmt.Errorf("update status: %w", err)
	}

	// Sync to public skills directory
	_ = s.fs.WriteGlobalSkillFile("public", name, existing.SkillMD)

	existing.Status = "prod"
	return existing, nil
}
