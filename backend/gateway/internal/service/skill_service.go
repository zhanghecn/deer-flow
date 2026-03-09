package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/repository"
	"github.com/openagents/gateway/pkg/storage"
)

type SkillService struct {
	repo *repository.SkillRepo
	fs   *storage.FS
}

func NewSkillService(repo *repository.SkillRepo, fs *storage.FS) *SkillService {
	return &SkillService{repo: repo, fs: fs}
}

func (s *SkillService) Create(ctx context.Context, req model.CreateSkillRequest, userID uuid.UUID) (*model.Skill, error) {
	existing, err := s.repo.FindAnyByName(ctx, req.Name)
	if err != nil {
		return nil, fmt.Errorf("check skill existence: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("skill %q already exists", req.Name)
	}

	skill := &model.Skill{
		ID:         uuid.New(),
		Name:       req.Name,
		Description: req.Description,
		Status:     "dev",
		SkillMDRef: s.fs.SkillMDRef(req.Name, "dev"),
		Metadata:   s.mustMarshalMetadata(req.Name, "dev"),
		CreatedBy:  &userID,
	}

	if err := s.fs.WriteGlobalSkillFile("custom", skill.Name, req.SkillMD); err != nil {
		return nil, fmt.Errorf("write skill file: %w", err)
	}
	if err := s.repo.Create(ctx, skill); err != nil {
		return nil, fmt.Errorf("create skill: %w", err)
	}

	return s.hydrateSkill(skill)
}

func (s *SkillService) List(ctx context.Context, status string) ([]model.Skill, error) {
	skills, err := s.repo.List(ctx, status)
	if err != nil {
		return nil, err
	}
	for i := range skills {
		hydrated, err := s.hydrateSkill(&skills[i])
		if err != nil {
			return nil, err
		}
		skills[i] = *hydrated
	}
	return skills, nil
}

func (s *SkillService) Update(ctx context.Context, name string, req model.UpdateSkillRequest) (*model.Skill, error) {
	existing, err := s.repo.FindByName(ctx, name)
	if err != nil || existing == nil {
		return nil, fmt.Errorf("skill %q not found", name)
	}

	if req.Description != nil {
		existing.Description = *req.Description
	}
	skillMDContent, err := s.fs.ReadTextRef(existing.SkillMDRef)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read skill file: %w", err)
	}
	if req.SkillMD != nil {
		skillMDContent = *req.SkillMD
	}

	if existing.Status == "prod" {
		if err := s.fs.WriteGlobalSkillFile("public", name, skillMDContent); err != nil {
			return nil, fmt.Errorf("write skill file: %w", err)
		}
	} else {
		if err := s.fs.WriteGlobalSkillFile("custom", name, skillMDContent); err != nil {
			return nil, fmt.Errorf("write skill file: %w", err)
		}
	}
	existing.SkillMDRef = s.fs.SkillMDRef(name, existing.Status)
	existing.Metadata = s.mustMarshalMetadata(name, existing.Status)

	if err := s.repo.Update(ctx, name, existing); err != nil {
		return nil, fmt.Errorf("update skill: %w", err)
	}

	return s.hydrateSkill(existing)
}

func (s *SkillService) Delete(ctx context.Context, name string) error {
	if err := s.repo.Delete(ctx, name); err != nil {
		return err
	}
	_ = os.RemoveAll(s.fs.GlobalSkillDir("custom", name))
	_ = os.RemoveAll(s.fs.GlobalSkillDir("public", name))
	return nil
}

func (s *SkillService) Publish(ctx context.Context, name string) (*model.Skill, error) {
	existing, err := s.repo.FindByName(ctx, name)
	if err != nil || existing == nil {
		return nil, fmt.Errorf("skill %q not found", name)
	}
	skillMDContent, err := s.fs.ReadTextRef(existing.SkillMDRef)
	if err != nil {
		return nil, fmt.Errorf("read skill file: %w", err)
	}
	if err := s.fs.WriteGlobalSkillFile("public", name, skillMDContent); err != nil {
		return nil, fmt.Errorf("write public skill file: %w", err)
	}

	existing.Status = "prod"
	existing.SkillMDRef = s.fs.SkillMDRef(name, "prod")
	existing.Metadata = s.mustMarshalMetadata(name, "prod")

	if err := s.repo.UpdateStatus(ctx, name, "prod"); err != nil {
		return nil, fmt.Errorf("update status: %w", err)
	}

	return s.hydrateSkill(existing)
}

func (s *SkillService) hydrateSkill(skill *model.Skill) (*model.Skill, error) {
	skillMD, err := s.fs.ReadTextRef(skill.SkillMDRef)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	skill.SkillMD = skillMD
	return skill, nil
}

func (s *SkillService) mustMarshalMetadata(name string, status string) json.RawMessage {
	payload := map[string]interface{}{
		"skill_md_ref": s.fs.SkillMDRef(name, status),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage("{}")
	}
	return data
}
