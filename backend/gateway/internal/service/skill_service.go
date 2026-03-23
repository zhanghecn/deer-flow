package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/skillfs"
	"github.com/openagents/gateway/pkg/storage"
	"gopkg.in/yaml.v3"
)

type SkillService struct {
	fs *storage.FS
}

func NewSkillService(fs *storage.FS) *SkillService {
	return &SkillService{fs: fs}
}

func (s *SkillService) Create(_ context.Context, req model.CreateSkillRequest, _ uuid.UUID) (*model.Skill, error) {
	name := strings.TrimSpace(req.Name)
	if scopes := s.findSkillScopes(name); len(scopes) > 0 {
		return nil, fmt.Errorf("skill %q already exists in %s", name, strings.Join(scopes, ", "))
	}

	skillMD, err := ensureSkillFrontmatter(name, req.Description, req.SkillMD)
	if err != nil {
		return nil, err
	}
	if err := s.fs.WriteGlobalSkillFile("store/dev", name, skillMD); err != nil {
		return nil, fmt.Errorf("write skill file: %w", err)
	}
	if err := skillfs.WriteDescriptionI18nFile(
		s.fs.GlobalSkillDir("store/dev", name),
		req.DescriptionI18n,
	); err != nil {
		return nil, fmt.Errorf("write skill i18n file: %w", err)
	}

	return s.loadSkillFromScope(name, "store/dev")
}

func (s *SkillService) Update(_ context.Context, name string, req model.UpdateSkillRequest) (*model.Skill, error) {
	scope, err := s.locateUniqueSkillScope(name)
	if err != nil {
		return nil, err
	}

	existing, err := s.loadSkillFromScope(name, scope)
	if err != nil {
		return nil, err
	}

	description := existing.Description
	if req.Description != nil {
		description = *req.Description
	}
	descriptionI18n := existing.DescriptionI18n
	if req.DescriptionI18n != nil {
		descriptionI18n = *req.DescriptionI18n
	}

	skillMD := existing.SkillMD
	if req.SkillMD != nil {
		skillMD = *req.SkillMD
	}
	skillMD, err = ensureSkillFrontmatter(name, description, skillMD)
	if err != nil {
		return nil, err
	}
	if err := s.fs.WriteGlobalSkillFile(scope, name, skillMD); err != nil {
		return nil, fmt.Errorf("write skill file: %w", err)
	}
	if err := skillfs.WriteDescriptionI18nFile(
		s.fs.GlobalSkillDir(scope, name),
		descriptionI18n,
	); err != nil {
		return nil, fmt.Errorf("write skill i18n file: %w", err)
	}

	return s.loadSkillFromScope(name, scope)
}

func (s *SkillService) Delete(_ context.Context, name string) error {
	deleted := false
	for _, scope := range []string{"store/dev", "store/prod", "shared"} {
		targetDir := s.fs.GlobalSkillDir(scope, name)
		if info, err := os.Stat(targetDir); err == nil && info.IsDir() {
			if err := os.RemoveAll(targetDir); err != nil {
				return err
			}
			deleted = true
		}
	}
	if !deleted {
		return fmt.Errorf("skill %q not found", name)
	}
	return nil
}

func (s *SkillService) Publish(_ context.Context, name string) (*model.Skill, error) {
	sourceDir := s.fs.GlobalSkillDir("store/dev", name)
	info, err := os.Stat(sourceDir)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("skill %q not found in store/dev", name)
	}

	targetDir := s.fs.GlobalSkillDir("store/prod", name)
	_ = os.RemoveAll(targetDir)
	if err := s.fs.CopyDir(sourceDir, targetDir); err != nil {
		return nil, fmt.Errorf("copy skill to prod: %w", err)
	}

	return s.loadSkillFromScope(name, "store/prod")
}

func (s *SkillService) findSkillScopes(name string) []string {
	scopes := make([]string, 0, 3)
	for _, scope := range []string{"shared", "store/dev", "store/prod"} {
		info, err := os.Stat(s.fs.GlobalSkillDir(scope, name))
		if err == nil && info.IsDir() {
			scopes = append(scopes, scope)
		}
	}
	return scopes
}

func (s *SkillService) locateUniqueSkillScope(name string) (string, error) {
	scopes := s.findSkillScopes(name)
	switch len(scopes) {
	case 0:
		return "", fmt.Errorf("skill %q not found", name)
	case 1:
		return scopes[0], nil
	default:
		return "", fmt.Errorf("skill %q is ambiguous across %s", name, strings.Join(scopes, ", "))
	}
}

func (s *SkillService) loadSkillFromScope(name string, scope string) (*model.Skill, error) {
	skillPath := filepath.Join(s.fs.GlobalSkillDir(scope, name), "SKILL.md")
	data, err := os.ReadFile(skillPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("skill %q not found", name)
		}
		return nil, err
	}

	meta, err := skillfs.ParseFrontmatter(string(data))
	if err != nil {
		return nil, err
	}
	descriptionI18n, err := skillfs.LoadDescriptionI18nFile(filepath.Dir(skillPath))
	if err != nil {
		descriptionI18n = nil
	}

	status := "shared"
	switch scope {
	case "store/dev":
		status = "dev"
	case "store/prod":
		status = "prod"
	}

	return &model.Skill{
		Name:            name,
		Description:     meta.Description,
		DescriptionI18n: descriptionI18n,
		Status:          status,
		SkillMD:         string(data),
	}, nil
}

func ensureSkillFrontmatter(name string, description string, skillMD string) (string, error) {
	meta, body, hasFrontmatter, err := splitSkillFrontmatter(skillMD)
	if err != nil {
		return "", err
	}
	if meta == nil {
		meta = map[string]interface{}{}
	}
	meta["name"] = strings.TrimSpace(name)
	if strings.TrimSpace(description) != "" {
		meta["description"] = strings.TrimSpace(description)
	}

	data, err := yaml.Marshal(meta)
	if err != nil {
		return "", err
	}

	content := strings.TrimLeft(body, "\n")
	if hasFrontmatter {
		if content == "" {
			return fmt.Sprintf("---\n%s---\n", string(data)), nil
		}
		return fmt.Sprintf("---\n%s---\n\n%s", string(data), content), nil
	}
	if content == "" {
		return fmt.Sprintf("---\n%s---\n", string(data)), nil
	}
	return fmt.Sprintf("---\n%s---\n\n%s", string(data), content), nil
}

func splitSkillFrontmatter(skillMD string) (map[string]interface{}, string, bool, error) {
	if !strings.HasPrefix(skillMD, "---\n") {
		return map[string]interface{}{}, skillMD, false, nil
	}

	rest := strings.TrimPrefix(skillMD, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, "", false, fmt.Errorf("invalid skill frontmatter")
	}

	meta := map[string]interface{}{}
	if err := yaml.Unmarshal([]byte(rest[:end]), &meta); err != nil {
		return nil, "", false, err
	}

	body := strings.TrimPrefix(rest[end:], "\n---")
	body = strings.TrimPrefix(body, "\n")
	return meta, body, true, nil
}
